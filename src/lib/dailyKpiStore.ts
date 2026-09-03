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
import { addDays } from "@/lib/dailyChecklist";
import { CONTACTED_STAGES } from "@/lib/constants";
import { leadTier } from "@/lib/icp";
import {
  DAILY_KPI_SETTINGS_ID,
  DailyKpiCounts,
  DailyKpiDay,
  DailyKpiGoals,
  dailyKpiGoalsRow,
  DailyKpiKey,
  DailyKpiSkips,
  DailyKpiSkipsByDay,
  emptyCounts,
  isSkippable,
  monthStart,
  readDailyKpiGoals,
  sumCounts,
  toUtcDay,
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
  const start = toUtcDay(from);
  const end = addDays(toUtcDay(through), 1); // exclusive
  const inRange = { gte: start, lt: end };

  const [candidates, scoredLeads, messaged, replies, discoveryCalls, booked] =
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
      // Messages sent — leads that have reached the Contacted stage
      // (CONTACTED_STAGES in src/lib/constants.ts), filed under the day they
      // moved there.
      //
      // The stage is the record of the approach rather than
      // connectionRequestSentAt, which was one optional field on the lead that
      // only counted what somebody remembered to tick.
      //
      // The day comes off stageChangedAt, which is written only when the stage
      // value actually changes (src/lib/leadStage.ts). It was updatedAt until
      // that column existed, and that was an approximation with a real cost: a
      // lead approached three weeks ago and edited this morning counted as
      // this morning's outreach.
      prisma.lead.findMany({
        where: {
          stage: { in: [...CONTACTED_STAGES] },
          stageChangedAt: inRange,
        },
        select: { stageChangedAt: true },
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
      // Meetings — the stage half: a lead that moved to Discovery Call Booked
      // on that day, read off stageChangedAt (src/lib/leadStage.ts) rather
      // than off updatedAt, which used to stand in for it and moved for any
      // edit at all. It is only ever used to catch a booking that was recorded
      // as a stage move with no call logged behind it. Anything that does have
      // a call on the same day is dropped below rather than counted twice.
      prisma.lead.findMany({
        where: { stage: "DISCOVERY", stageChangedAt: inRange },
        select: { id: true, stageChangedAt: true },
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

  // Which day's counts a record belongs to, read the same way the bounds above
  // were, so a row the range returned always has a bucket waiting for it.
  //
  // It still returns null rather than asserting. Bucketing and fetching agree
  // now, but a lookup that cannot be answered should fail as a record quietly
  // uncounted rather than as a page that will not render — the crash this
  // replaced was a non-null assertion on exactly this call.
  const bucket = (at: Date | null): DailyKpiCounts | null =>
    at ? byKey.get(toUtcDay(at).getTime()) ?? null : null;

  // One record, into one metric, if it lands anywhere. Every count below goes
  // through this, so there is one place that decides what happens to a row
  // that cannot be filed rather than four that each assume it cannot happen.
  const count = (at: Date | null, key: DailyKpiKey): void => {
    const counts = bucket(at);
    if (counts) counts[key]++;
  };

  for (const c of candidates) count(c.processedAt, "qualifiedLeads");
  for (const lead of scoredLeads) {
    const tier = leadTier({ ...lead, icpScoredAt: lead.icpScoredAt });
    if (tier === "A" || tier === "B") count(lead.icpScoredAt, "qualifiedLeads");
  }
  for (const l of messaged) count(l.stageChangedAt, "messagesSent");
  for (const l of replies) count(l.repliedAt, "repliesReceived");

  // The two halves of a meeting, deduplicated by lead and day: a call logged
  // against a lead is the booking, and the lead's stage move on that same day
  // is the same event seen from the other side.
  //
  // The dedupe key is recorded for every call, including one that could not be
  // counted: a call outside the window must still suppress the stage move
  // behind it, or a booking dropped at an edge would come back through the
  // other half as a second one.
  const callDays = new Set<string>();
  for (const call of discoveryCalls) {
    count(call.createdAt, "meetingsBooked");
    if (call.leadId) {
      callDays.add(`${call.leadId}:${toUtcDay(call.createdAt).getTime()}`);
    }
  }
  for (const lead of booked) {
    const key = `${lead.id}:${toUtcDay(lead.stageChangedAt).getTime()}`;
    if (callDays.has(key)) continue;
    count(lead.stageChangedAt, "meetingsBooked");
  }

  return days;
}

// One day's counts — the same pass over a window of one.
export async function loadDailyKpiCounts(day: Date): Promise<DailyKpiCounts> {
  const [only] = await loadDailyKpiRange(day, day);
  return only.counts;
}

// Month to date, up to and including the day given — what the two monthly
// metrics are read against. The same pass over the days of one month, summed,
// so a month total and a day total can never be counted two different ways.
export async function loadMonthToDate(day: Date): Promise<DailyKpiCounts> {
  const days = await loadDailyKpiRange(monthStart(day), day);
  return sumCounts(days.map((d) => d.counts));
}

// ─── Skipped days ──────────────────────────────────────────────────────────
//
// The one stored thing on this page: a day the operator has declared fulfilled
// for a metric, whatever that day's count was (model DailyKpiSkip in
// prisma/schema.prisma). Presence is the flag, so a read is "which rows exist
// in this window" and nothing has to be defaulted.

// Every skip in a window, keyed by the day's timestamp — the same key the page
// looks a day up by everywhere else.
//
// One query over the same range the counts are read from, rather than a lookup
// per day: the page already walks ninety days for the streak.
export async function loadDailyKpiSkips(
  from: Date,
  through: Date,
): Promise<DailyKpiSkipsByDay> {
  const start = toUtcDay(from);
  const end = addDays(toUtcDay(through), 1); // exclusive
  const rows = await prisma.dailyKpiSkip.findMany({
    where: { date: { gte: start, lt: end } },
    select: { date: true, metric: true },
  });

  const skips: DailyKpiSkipsByDay = new Map();
  for (const row of rows) {
    // A row written for a metric that is no longer skippable — or by a build
    // that spelled one differently — is ignored rather than trusted into a
    // count that would then be lifted to a goal it never met.
    if (!isSkippable(row.metric as DailyKpiKey)) continue;
    const key = toUtcDay(row.date).getTime();
    const set: DailyKpiSkips = skips.get(key) ?? new Set();
    set.add(row.metric as DailyKpiKey);
    skips.set(key, set);
  }
  return skips;
}

// Flip one day's skip for one metric, and say which way it went.
//
// A delete rather than a stored `false`, so "not skipped" has exactly one
// representation and un-skipping leaves no trace to reason about later.
export async function toggleDailyKpiSkip(
  day: Date,
  metric: DailyKpiKey,
): Promise<boolean> {
  const date = toUtcDay(day);
  const existing = await prisma.dailyKpiSkip.findUnique({
    where: { date_metric: { date, metric } },
    select: { id: true },
  });
  if (existing) {
    await prisma.dailyKpiSkip.delete({ where: { id: existing.id } });
    return false;
  }
  await prisma.dailyKpiSkip.create({ data: { date, metric } });
  return true;
}
