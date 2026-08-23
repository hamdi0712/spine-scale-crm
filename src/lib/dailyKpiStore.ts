// Reading the four daily KPIs off the records, and reading and writing the one
// goals row.
//
// Server-only, and deliberately not a "use server" module — the page reads
// through it and nothing in the browser is allowed to call it. The goals form's
// save action lives in src/lib/actions/dailyKpi.ts and comes through here too.
// Same split as src/lib/pipelineSettingsStore.ts.
//
// Every count is scoped to one day read in UTC, matching the daily checklist's
// reading of a day (src/lib/dailyChecklist.ts) so the two pages are always
// talking about the same twenty-four hours. The counts are "what happened on
// that day" rather than "what is true now", which is what lets a past day show
// the numbers it actually had: the marks they are read off are instants that
// stay where they were put.

import { prisma } from "@/lib/prisma";
import { addDays, toChecklistDay } from "@/lib/dailyChecklist";
import { leadTier } from "@/lib/icp";
import {
  DAILY_KPI_SETTINGS_ID,
  DailyKpiCounts,
  DailyKpiDay,
  DailyKpiGoals,
  DailyKpiKey,
  dailyKpiGoalsRow,
  emptyCounts,
  readDailyKpiGoals,
} from "@/lib/dailyKpi";

// ─── The goals row ─────────────────────────────────────────────────────────

export async function loadDailyKpiGoals(): Promise<DailyKpiGoals> {
  const row = await prisma.dailyKpiSettings.findUnique({
    where: { id: DAILY_KPI_SETTINGS_ID },
  });
  return readDailyKpiGoals(row);
}

// An upsert on the fixed id, so saving from a fresh install creates the row and
// saving again updates it. There is no delete: the way back to the defaults is
// the form's Reset, which saves the defaults rather than removing the row.
export async function saveDailyKpiGoals(goals: DailyKpiGoals): Promise<void> {
  const data = dailyKpiGoalsRow(goals);
  await prisma.dailyKpiSettings.upsert({
    where: { id: DAILY_KPI_SETTINGS_ID },
    create: { id: DAILY_KPI_SETTINGS_ID, ...data },
    update: data,
  });
}

// ─── The counts ────────────────────────────────────────────────────────────

// A window of days, counted in one pass.
//
// It is one pass rather than one query per day because a week of trend, a
// fortnight of week-on-week and a stretch of streak are all the same records
// bucketed differently: five queries over the whole range, then every row
// dropped into the day it belongs to. Asking the database once per metric per
// day would be sixty round trips for one page.
//
// `from` and `through` are both days (midnight UTC), inclusive at each end.
export async function loadDailyKpiRange(
  from: Date,
  through: Date,
): Promise<DailyKpiDay[]> {
  const start = toChecklistDay(from);
  const end = addDays(toChecklistDay(through), 1); // exclusive
  const inRange = { gte: start, lt: end };

  const [candidates, scoredLeads, connections, replies, discoveryCalls, booked] =
    await Promise.all([
      // Qualified — the discovery half. A candidate that came out of the queue
      // at A or B tier on that day cleared the bar, whether or not anybody has
      // promoted it since.
      prisma.discoveryCandidate.findMany({
        where: { processedAt: inRange, icpTier: { in: ["A", "B"] } },
        select: { processedAt: true },
      }),
      // Qualified — the pipeline half: a lead somebody scored by hand. Leads
      // promoted out of Discovery are excluded (`candidate: { is: null }`)
      // because promotion carries the candidate's scorecard across and stamps
      // it scored on the same day — counting both would count one clinic
      // twice. The tier is derived rather than stored, the way it is
      // everywhere else in the app (src/lib/icp.ts).
      prisma.lead.findMany({
        where: { icpScoredAt: inRange, candidate: { is: null } },
        select: {
          icpScoredAt: true,
          icpDqSurgicalPractice: true,
          icpDqSoloNoStaff: true,
          icpDqFranchiseLocked: true,
          icpDqSystemComplete: true,
          icpDqOutOfRegion: true,
          icpStaffSize: true,
          icpPackageEconomics: true,
          icpBudgetSignal: true,
          icpGapBooking: true,
          icpGapReviews: true,
          icpGapRemarketing: true,
        },
      }),
      prisma.lead.findMany({
        where: { connectionRequestSentAt: inRange },
        select: { connectionRequestSentAt: true },
      }),
      prisma.lead.findMany({
        where: { repliedAt: inRange },
        select: { repliedAt: true },
      }),
      // Meetings — the booking half. Counted off when the call was booked
      // (createdAt) rather than when it is due: this is a record of the work
      // done that day, and a call booked on Monday for Friday was Monday's
      // win. A cancelled call is not a booking that stands, the same reading
      // the dashboard's discovery card takes.
      prisma.call.findMany({
        where: {
          type: "DISCOVERY",
          status: { not: "CANCELLED" },
          createdAt: inRange,
        },
        select: { createdAt: true, leadId: true },
      }),
      // Meetings — the stage half: a lead sitting at Discovery Call Booked
      // that was last touched on that day. Lead carries no stage-change
      // timestamp, so updatedAt is the closest honest reading of when it got
      // there, and it is only ever used to catch a booking that was recorded
      // as a stage move with no call logged behind it. Anything that does have
      // a call on the same day is dropped below rather than counted twice.
      prisma.lead.findMany({
        where: { stage: "DISCOVERY", updatedAt: inRange },
        select: { id: true, updatedAt: true },
      }),
    ]);

  // One bucket per day in the window, in order, so a day nothing happened on
  // is a row of zeroes rather than a gap.
  const days: DailyKpiDay[] = [];
  const byKey = new Map<number, DailyKpiCounts>();
  for (let day = start; day < end; day = addDays(day, 1)) {
    const counts = emptyCounts();
    byKey.set(day.getTime(), counts);
    days.push({ day, counts });
  }

  // Which day's counts a record belongs to, or null when it belongs to none.
  //
  // A record read back from a range query is normally inside that range, but
  // "normally" is not "always": the day a timestamp is filed under is its UTC
  // midnight read off the server's local calendar (toChecklistDay), and near
  // either edge of the window that reading can land a row one day outside the
  // buckets the range built. A row that cannot be filed is dropped rather than
  // counted somewhere it does not belong — which is also the only honest thing
  // to do with it, since the day it belongs to is not on screen.
  const bucket = (at: Date | null): DailyKpiCounts | null =>
    at ? byKey.get(toChecklistDay(at).getTime()) ?? null : null;

  // One record, into one metric, if it lands anywhere. Every count below goes
  // through this, so there is one place where an unbucketable row is ignored
  // rather than four assertions that each assume it cannot happen.
  const count = (at: Date | null, key: DailyKpiKey): void => {
    const counts = bucket(at);
    if (counts) counts[key]++;
  };

  for (const c of candidates) count(c.processedAt, "qualifiedLeads");
  for (const lead of scoredLeads) {
    const tier = leadTier({ ...lead, icpScoredAt: lead.icpScoredAt });
    if (tier === "A" || tier === "B") count(lead.icpScoredAt, "qualifiedLeads");
  }
  for (const l of connections) {
    count(l.connectionRequestSentAt, "connectionsSent");
  }
  for (const l of replies) count(l.repliedAt, "repliesReceived");

  // The two halves of a meeting, deduplicated by lead and day: a call logged
  // against a lead is the booking, and the lead's stage move on that same day
  // is the same event seen from the other side.
  //
  // The dedupe key is recorded for every call, including one that fell outside
  // the window: a call that could not be counted must still suppress the stage
  // move behind it, or a booking dropped at one edge would come back through
  // the other half as a second one.
  const callDays = new Set<string>();
  for (const call of discoveryCalls) {
    count(call.createdAt, "meetingsBooked");
    if (call.leadId) {
      callDays.add(`${call.leadId}:${toChecklistDay(call.createdAt).getTime()}`);
    }
  }
  for (const lead of booked) {
    const key = `${lead.id}:${toChecklistDay(lead.updatedAt).getTime()}`;
    if (callDays.has(key)) continue;
    count(lead.updatedAt, "meetingsBooked");
  }

  return days;
}

// One day's counts — the same pass over a window of one.
export async function loadDailyKpiCounts(day: Date): Promise<DailyKpiCounts> {
  const [only] = await loadDailyKpiRange(day, day);
  return only.counts;
}
