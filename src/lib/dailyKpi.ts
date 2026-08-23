// The four daily KPIs — what they are, what a goal may be, and how a day,
// a week and a streak are read off them.
//
// Pure. No database and no clock beyond what it is handed; the counting lives
// in src/lib/dailyKpiStore.ts and the page hands everything through here so
// the server and the goals form agree on one set of rules.
//
// Nothing here is a stored count. Every one of the four is read off a record
// that already carries the instant it happened, which is what makes yesterday,
// last week and the streak the same question asked about a different day —
// see the DailyKpiSettings comment in prisma/schema.prisma.

// The one row's id, same fixed-string singleton as PIPELINE_SETTINGS_ID.
export const DAILY_KPI_SETTINGS_ID = "singleton";

// ─── The metrics ───────────────────────────────────────────────────────────

// In the order the day runs through them: a clinic is qualified, approached,
// answers, and books. Every card row, table row and chart series is built from
// this array, so the four always appear in the same order.
export const DAILY_KPI_KEYS = [
  "qualifiedLeads",
  "connectionsSent",
  "repliesReceived",
  "meetingsBooked",
] as const;

export type DailyKpiKey = (typeof DAILY_KPI_KEYS)[number];

export const DAILY_KPI_LABELS: Record<DailyKpiKey, string> = {
  qualifiedLeads: "Qualified Leads",
  connectionsSent: "Connections Sent",
  repliesReceived: "Replies Received",
  meetingsBooked: "Meetings Booked",
};

// The one line under each name — what the number is counted off, said in the
// same spirit DailyNumbers says it: a count with no stated source invites the
// question every time it looks wrong.
export const DAILY_KPI_BLURBS: Record<DailyKpiKey, string> = {
  qualifiedLeads: "Scored A or B tier",
  connectionsSent: "Marked sent on the lead",
  repliesReceived: "Marked replied on the lead",
  meetingsBooked: "Discovery calls booked",
};

// The KPI row's four hues, the same set and the same order the dashboard's
// headline row runs in (src/components/KpiCard.tsx): blue, teal, purple, pink.
// One palette for "the four numbers of a day", wherever they are drawn.
export const DAILY_KPI_HUES: Record<DailyKpiKey, string> = {
  qualifiedLeads: "#3B82F6",
  connectionsSent: "#14B8A6",
  repliesReceived: "#7C3AED",
  meetingsBooked: "#EC4899",
};

export type DailyKpiCounts = Record<DailyKpiKey, number>;

export function emptyCounts(): DailyKpiCounts {
  return {
    qualifiedLeads: 0,
    connectionsSent: 0,
    repliesReceived: 0,
    meetingsBooked: 0,
  };
}

export function sumCounts(days: DailyKpiCounts[]): DailyKpiCounts {
  return days.reduce((total, day) => {
    for (const key of DAILY_KPI_KEYS) total[key] += day[key];
    return total;
  }, emptyCounts());
}

// ─── Goals ─────────────────────────────────────────────────────────────────

export type DailyKpiGoals = Record<DailyKpiKey, number>;

export const DEFAULT_DAILY_KPI_GOALS: DailyKpiGoals = {
  qualifiedLeads: 20,
  connectionsSent: 50,
  repliesReceived: 10,
  meetingsBooked: 3,
};

// A goal is a whole number of things to do in a day. Zero is allowed — it is
// how a metric is taken out of the score and out of the streak without being
// taken off the page — and the ceiling is there so a mistyped goal cannot make
// every percentage on the page round to nothing.
export const DAILY_KPI_GOAL_MAX = 999;

// Read a posted goal the way the pipeline settings read a posted threshold:
// clamped to the scale it is measured on, and falling back to the default
// rather than to zero when it is not a number at all.
export function readGoal(value: unknown, key: DailyKpiKey): number {
  const n =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : NaN;
  if (!Number.isFinite(n)) return DEFAULT_DAILY_KPI_GOALS[key];
  return Math.min(Math.max(Math.round(n), 0), DAILY_KPI_GOAL_MAX);
}

// Every read of the row goes through this, so a row written by an older build,
// hand-edited, or missing entirely lands on a working set of goals.
export function readDailyKpiGoals(
  row: Partial<Record<`${DailyKpiKey}Goal`, number | null>> | null,
): DailyKpiGoals {
  if (!row) return { ...DEFAULT_DAILY_KPI_GOALS };
  return {
    qualifiedLeads: readGoal(row.qualifiedLeadsGoal, "qualifiedLeads"),
    connectionsSent: readGoal(row.connectionsSentGoal, "connectionsSent"),
    repliesReceived: readGoal(row.repliesReceivedGoal, "repliesReceived"),
    meetingsBooked: readGoal(row.meetingsBookedGoal, "meetingsBooked"),
  };
}

export function dailyKpiGoalsRow(goals: DailyKpiGoals): Record<string, number> {
  return {
    qualifiedLeadsGoal: goals.qualifiedLeads,
    connectionsSentGoal: goals.connectionsSent,
    repliesReceivedGoal: goals.repliesReceived,
    meetingsBookedGoal: goals.meetingsBooked,
  };
}

export function isDefaultDailyKpiGoals(goals: DailyKpiGoals): boolean {
  return DAILY_KPI_KEYS.every(
    (key) => goals[key] === DEFAULT_DAILY_KPI_GOALS[key],
  );
}

// ─── Progress ──────────────────────────────────────────────────────────────

// How far through a goal a count is, as 0–100. A goal of zero is "nothing
// asked for", which is met the moment the day starts rather than divided by.
export function progressPct(count: number, goal: number): number {
  if (goal <= 0) return 100;
  return Math.min(Math.round((count / goal) * 100), 100);
}

export function goalMet(count: number, goal: number): boolean {
  return count >= goal;
}

// Today's score: the average of the four percentages, each capped at 100
// first. Capping before the average is what stops one runaway metric — three
// hundred connection requests on an import day — from covering three that
// never moved. A score is a reading of the day's balance, not a total.
export function dailyScore(
  counts: DailyKpiCounts,
  goals: DailyKpiGoals,
): number {
  const total = DAILY_KPI_KEYS.reduce(
    (sum, key) => sum + progressPct(counts[key], goals[key]),
    0,
  );
  return Math.round(total / DAILY_KPI_KEYS.length);
}

// The line under the score. Encouragement, and never congratulation for a day
// that has not happened: the bands are read off the score itself, so a quiet
// morning gets the sentence a quiet morning deserves.
export function scoreNote(score: number): { headline: string; detail: string } {
  if (score >= 90)
    return {
      headline: "Outstanding day 🚀",
      detail: "Every goal is in reach. Bank it and do it again tomorrow.",
    };
  if (score >= 70)
    return {
      headline: "Strong day 🚀",
      detail: "You're building momentum. Keep stacking consistent action.",
    };
  if (score >= 40)
    return {
      headline: "Halfway there",
      detail: "Pick the metric furthest from its goal and close the gap.",
    };
  if (score > 0)
    return {
      headline: "Getting started",
      detail: "Small actions compound. One more block of outreach moves this.",
    };
  return {
    headline: "Nothing logged yet",
    detail: "The day is still open — the first connection request starts it.",
  };
}

// ─── Days, weeks, streaks ──────────────────────────────────────────────────

// One day's counts with the day they belong to. The order is always oldest
// first, which is the order the chart and the breakdown table both read in.
export interface DailyKpiDay {
  day: Date;
  counts: DailyKpiCounts;
}

// How many days the trend chart and the average column cover.
export const DAILY_KPI_TREND_DAYS = 7;

// The mean of a metric across the days given, to one decimal — the breakdown
// table's "7-day avg" column. An empty list averages to zero rather than NaN.
export function averageFor(days: DailyKpiDay[], key: DailyKpiKey): number {
  if (days.length === 0) return 0;
  const total = days.reduce((sum, d) => sum + d.counts[key], 0);
  return Math.round((total / days.length) * 10) / 10;
}

// Change between two totals as a whole percentage, or null where there is no
// base to change from: last week's zero makes "up 100%" meaningless, and a
// dash says so honestly.
export function pctChange(now: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}

export function allGoalsMet(
  counts: DailyKpiCounts,
  goals: DailyKpiGoals,
): boolean {
  return DAILY_KPI_KEYS.every((key) => goalMet(counts[key], goals[key]));
}

// Consecutive days, ending at the most recent day given, on which all four
// goals were met.
//
// Today counts while it is still in progress: a day that has already hit every
// goal is a day that was hit, and waiting until midnight to say so would show
// a zero to somebody who has just finished. A today that has not hit them yet
// does not break the run behind it either — it simply has not joined it — so
// the count carries on from yesterday.
//
// `days` is oldest first, as everything in this module is.
export function streakLength(
  days: DailyKpiDay[],
  goals: DailyKpiGoals,
): number {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const met = allGoalsMet(days[i].counts, goals);
    if (met) {
      streak++;
      continue;
    }
    // The most recent day is the one exception: unfinished is not failed.
    if (i === days.length - 1) continue;
    break;
  }
  return streak;
}
