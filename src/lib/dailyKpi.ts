// The four KPIs — what they are, what timeframe each is judged over, what a
// goal may be, and how a day, a month, a week and a streak are read off them.
//
// Two of the four are yours to do and two are somebody else's to give. A
// message goes out because you sent it; a reply arrives because a
// clinic owner felt like answering that afternoon. Holding the second pair to
// a daily number scores you on other people's inboxes, so they carry a monthly
// goal and are read month to date — the timeframe over which a reply rate is
// actually a fact about the work rather than about one quiet Tuesday.
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
  "messagesSent",
  "repliesReceived",
  "meetingsBooked",
] as const;

export type DailyKpiKey = (typeof DAILY_KPI_KEYS)[number];

export const DAILY_KPI_LABELS: Record<DailyKpiKey, string> = {
  qualifiedLeads: "Qualified Leads",
  messagesSent: "Messages Sent",
  repliesReceived: "Replies Received",
  meetingsBooked: "Meetings Booked",
};

// What each number is counted off, said in the same spirit DailyNumbers says
// it: a count with no stated source invites the question every time it looks
// wrong.
//
// It rides under the goals form's fields and no longer under the cards. On a
// card it was a fourth line of small grey type on a tile whose whole job is
// one number, and the four of them together turned the row into a paragraph.
// Under a field it is doing real work — it says what the goal you are typing
// will be measured against.
export const DAILY_KPI_BLURBS: Record<DailyKpiKey, string> = {
  qualifiedLeads: "Scored A or B tier",
  messagesSent: "Leads that reached Contacted",
  repliesReceived: "Marked replied on the lead",
  meetingsBooked: "Discovery calls booked",
};

// The KPI row's four hues, the same set and the same order the dashboard's
// headline row runs in (src/components/KpiCard.tsx): blue, teal, purple, pink.
// One palette for "the four numbers of a day", wherever they are drawn.
export const DAILY_KPI_HUES: Record<DailyKpiKey, string> = {
  qualifiedLeads: "#3B82F6",
  messagesSent: "#14B8A6",
  repliesReceived: "#7C3AED",
  meetingsBooked: "#EC4899",
};

// ─── Timeframes ────────────────────────────────────────────────────────────

// Which timeframe a metric is judged over. "daily" is counted and scored a day
// at a time; "monthly" is counted month to date against a monthly goal and
// never scored against a single day.
export type DailyKpiCadence = "daily" | "monthly";

export const DAILY_KPI_CADENCE: Record<DailyKpiKey, DailyKpiCadence> = {
  qualifiedLeads: "daily",
  messagesSent: "daily",
  repliesReceived: "monthly",
  meetingsBooked: "monthly",
};

// The two lists the page actually iterates. Derived from the record above so
// there is one statement of which metric is which, not three.
export const DAILY_GOAL_KEYS = DAILY_KPI_KEYS.filter(
  (key) => DAILY_KPI_CADENCE[key] === "daily",
);

export const MONTHLY_GOAL_KEYS = DAILY_KPI_KEYS.filter(
  (key) => DAILY_KPI_CADENCE[key] === "monthly",
);

export function isMonthly(key: DailyKpiKey): boolean {
  return DAILY_KPI_CADENCE[key] === "monthly";
}

export type DailyKpiCounts = Record<DailyKpiKey, number>;

export function emptyCounts(): DailyKpiCounts {
  return {
    qualifiedLeads: 0,
    messagesSent: 0,
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

// A goal is read in its metric's own timeframe: the daily pair is what a full
// day looks like, the monthly pair what a full month looks like. The monthly
// defaults are the daily ones they replace multiplied by a working month —
// ten replies and three meetings a day were the old targets, and 20 working
// days is what a month of them comes to — so an install that never opens the
// form is held to the same standard over a timeframe that can carry it.
export const DEFAULT_DAILY_KPI_GOALS: DailyKpiGoals = {
  qualifiedLeads: 20,
  messagesSent: 50,
  repliesReceived: 200,
  meetingsBooked: 60,
};

// A goal is a whole number of things to do in its timeframe. Zero is allowed — it is
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
// The column names carry the timeframe — a bare "goal" on a monthly metric
// would read as a daily one, which is the mistake this change exists to undo.
export interface DailyKpiGoalsRow {
  qualifiedLeadsGoal?: number | null;
  messagesSentGoal?: number | null;
  repliesReceivedMonthlyGoal?: number | null;
  meetingsBookedMonthlyGoal?: number | null;
}

export function readDailyKpiGoals(row: DailyKpiGoalsRow | null): DailyKpiGoals {
  if (!row) return { ...DEFAULT_DAILY_KPI_GOALS };
  return {
    qualifiedLeads: readGoal(row.qualifiedLeadsGoal, "qualifiedLeads"),
    messagesSent: readGoal(row.messagesSentGoal, "messagesSent"),
    repliesReceived: readGoal(row.repliesReceivedMonthlyGoal, "repliesReceived"),
    meetingsBooked: readGoal(row.meetingsBookedMonthlyGoal, "meetingsBooked"),
  };
}

export function dailyKpiGoalsRow(goals: DailyKpiGoals): Record<string, number> {
  return {
    qualifiedLeadsGoal: goals.qualifiedLeads,
    messagesSentGoal: goals.messagesSent,
    repliesReceivedMonthlyGoal: goals.repliesReceived,
    meetingsBookedMonthlyGoal: goals.meetingsBooked,
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

// Today's score: the average of the daily metrics' percentages, each capped at
// 100 first. Capping before the average is what stops one runaway metric — three
// hundred leads moved to Contacted on an import day — from covering one that never
// moved. A score is a reading of the day's balance, not a total.
//
// The monthly pair is deliberately not in it. A day where the outreach got
// done and nobody happened to reply is a good day's work, and a score that
// marked it down would be scoring the prospect's inbox rather than the work.
// Their pace is shown beside the score instead — see monthlyPace below.
export function dailyScore(
  counts: DailyKpiCounts,
  goals: DailyKpiGoals,
): number {
  const total = DAILY_GOAL_KEYS.reduce(
    (sum, key) => sum + progressPct(counts[key], goals[key]),
    0,
  );
  return Math.round(total / DAILY_GOAL_KEYS.length);
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
    detail: "The day is still open — the first message out starts it.",
  };
}

// ─── Days, weeks, streaks ──────────────────────────────────────────────────

// The day an instant belongs to, read in UTC.
//
// Deliberately not toChecklistDay (src/lib/dailyChecklist.ts), which builds a
// UTC midnight out of the *local* calendar fields of the instant it is handed.
// That is right for the thing it was written for — a day the person in front
// of the app is living through, keyed the same way whichever page asks — but
// it is wrong for filing a stored timestamp: run anywhere east of UTC, an
// instant at 23:30 UTC on the 21st reads as the 22nd, so a record files under
// a day the range that fetched it never built a bucket for.
//
// Every day on this page — the viewed day, the range bounds, and the day each
// record is filed under — is read through this one function, so the three can
// no longer disagree.
export function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

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

// A day was "hit" when the daily metrics were hit. The monthly pair cannot be
// met or missed in a day — that is what makes it monthly — so the streak is
// read off the two that can.
export function allGoalsMet(
  counts: DailyKpiCounts,
  goals: DailyKpiGoals,
): boolean {
  return DAILY_GOAL_KEYS.every((key) => goalMet(counts[key], goals[key]));
}

// Consecutive days, ending at the most recent day given, on which both daily
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

// ─── Months and pace ───────────────────────────────────────────────────────

// The first day of the month a day falls in, read in UTC like every other day
// on this page.
export function monthStart(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

export function daysInMonth(day: Date): number {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

// Where a monthly metric stands, and where it is heading.
//
// The projection is the plainest one there is: what has arrived so far,
// spread evenly over the days elapsed, run to the end of the month. It is
// shown as a reference and never scored — a straight-line pace is a fair
// reading of a month in progress and a poor prediction of one, and the page
// says "on pace for" rather than "will be" for exactly that reason.
export interface MonthlyPace {
  monthToDate: number;
  goal: number;
  pct: number; // month to date against the goal, 0–100
  projected: number; // month to date, run out at today's rate
  onTrack: boolean; // is the pace enough to land on the goal
  daysElapsed: number;
  daysTotal: number;
}

export function monthlyPace(
  monthToDate: number,
  goal: number,
  day: Date,
): MonthlyPace {
  const daysElapsed = day.getUTCDate();
  const daysTotal = daysInMonth(day);
  const projected = Math.round((monthToDate / daysElapsed) * daysTotal);
  return {
    monthToDate,
    goal,
    pct: progressPct(monthToDate, goal),
    projected,
    onTrack: projected >= goal,
    daysElapsed,
    daysTotal,
  };
}
