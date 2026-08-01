// Client health — the single status that replaces the flat "Active" badge for
// clients that are actually live.
//
// Two rules shape everything below.
//
// 1. Show rate is the core metric. Nothing reads Healthy while show rate is
//    trending under target, and CPL never drives the status on its own — a
//    cheap lead that never turns up is not a healthy account. CPL is reported
//    beside the status as context, never inside it. Lead-to-booked is a
//    secondary signal: it can pull a clean week down to Needs attention, never
//    to At risk by itself.
//
// 2. Small numbers are read as counts, not percentages. Three booked consults
//    with one no-show is 67%, which says nothing; the same window with two
//    booked and one no-show is 50%, which says even less. Below
//    MIN_BOOKED_FOR_RATE the window is judged on how many shows it is short
//    of target, and below MIN_BOOKED_TO_SCORE it is not judged at all — it
//    comes back Ramping rather than defaulting to green or red.

import { SHOW_RATE_BAND, LEAD_TO_BOOKED_BAND } from "@/lib/kpi";

export const HEALTH_STATUSES = [
  "HEALTHY",
  "NEEDS_ATTENTION",
  "AT_RISK",
  "RAMPING",
] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  HEALTHY: "Healthy",
  NEEDS_ATTENTION: "Needs attention",
  AT_RISK: "At risk",
  RAMPING: "Ramping",
};

// What each status is asking of you. Needs attention is deliberately a
// self-serve state — it means look at the account, not phone the client.
export const HEALTH_ACTIONS: Record<HealthStatus, string> = {
  HEALTHY: "On target. Nothing to do.",
  NEEDS_ATTENTION: "Soft dip — check the account. No client conversation needed yet.",
  AT_RISK: "Reach out proactively — the core metric has been missed repeatedly or delivery is broken.",
  RAMPING: "Not enough reported volume to score yet.",
};

// The only manual override. Set when something operational has broken (ad
// account down, tracking dead, access revoked) and the numbers have not caught
// up with reality yet.
export const HEALTH_OVERRIDE_AT_RISK = "at_risk";

export const HEALTH_OVERRIDE_LABEL = "Flagged — operational break";

// ─── Tuning ────────────────────────────────────────────────────────────────

// How many recent weeks the status is read from.
export const HEALTH_WINDOW_WEEKS = 3;

// Fewer full reporting weeks than this since going Active and there is nothing
// to trend against yet.
export const MIN_WEEKS_TO_SCORE = 2;

// Booked consults across the window, below which the window says nothing at
// all and the client stays unscored.
export const MIN_BOOKED_TO_SCORE = 5;

// Booked consults across the window, at or above which a percentage is a fair
// read. Between the two thresholds the weeks are judged on raw counts.
export const MIN_BOOKED_FOR_RATE = 8;

// A hard miss twice or more inside the window is At risk.
export const HARD_MISSES_FOR_AT_RISK = 2;

// A week's show rate has to move by more than this for the trend arrow to
// point anywhere but sideways.
const TREND_EPSILON = 0.05;

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface HealthReportLike {
  weekStart: Date;
  leads: number;
  booked: number;
  shows: number;
}

export interface HealthClientLike {
  status: string;
  activeSince: Date | null;
  healthOverride: string | null;
}

export type Trend = "up" | "down" | "flat";

export interface HealthWeek {
  weekStart: Date;
  showRate: number | null; // null when nothing was booked that week
  result: "ok" | "soft" | "fail" | "empty";
}

export interface ClientHealth {
  status: HealthStatus;
  // Why it landed there, in the words the badge's tooltip uses.
  reason: string;
  trend: Trend | null; // null when there is not enough history to trend
  weeks: HealthWeek[]; // oldest → newest, the window that was judged
  booked: number; // booked consults across the window
  overridden: boolean;
  // True when the window was too small to read as a percentage, so the weeks
  // above were judged on raw counts instead.
  countBased: boolean;
}

// ─── Computation ───────────────────────────────────────────────────────────

// Only live clients carry a health status. Onboarding clients show delivery
// progress instead, and paused/churned ones keep their plain status badge —
// scoring an account nobody is running would be noise.
export function isHealthScored(status: string): boolean {
  return status === "ACTIVE";
}

function showRateOf(week: HealthReportLike): number | null {
  return week.booked > 0 ? week.shows / week.booked : null;
}

// How a single week did against the show-rate target.
//
// With enough booked consults that is the percentage bands straight out of the
// weekly report. Without them it is a count: how many shows short of target is
// this week? One short is a dip, two or more is a miss — which is the same
// judgement a person makes reading "4 booked, 2 showed" off a report.
function weekResult(week: HealthReportLike, countBased: boolean): HealthWeek["result"] {
  if (week.booked === 0) return "empty";
  if (!countBased) {
    const rate = week.shows / week.booked;
    if (rate >= SHOW_RATE_BAND.green[0]) return "ok";
    if (rate >= SHOW_RATE_BAND.yellow[0]) return "soft";
    return "fail";
  }
  const target = Math.ceil(week.booked * SHOW_RATE_BAND.green[0]);
  const short = target - week.shows;
  if (short <= 0) return "ok";
  return short === 1 ? "soft" : "fail";
}

// Direction of travel across the window's last two scoreable weeks.
function trendOf(weeks: HealthWeek[]): Trend | null {
  const rates = weeks.filter((w) => w.showRate !== null);
  if (rates.length < 2) return null;
  const latest = rates[rates.length - 1].showRate as number;
  const previous = rates[rates.length - 2].showRate as number;
  const delta = latest - previous;
  if (delta > TREND_EPSILON) return "up";
  if (delta < -TREND_EPSILON) return "down";
  return "flat";
}

function ramping(reason: string, weeks: HealthWeek[], booked: number): ClientHealth {
  return {
    status: "RAMPING",
    reason,
    trend: trendOf(weeks),
    weeks,
    booked,
    overridden: false,
    countBased: false,
  };
}

/**
 * Reports come in newest-first from Prisma; order does not matter here, the
 * window is sorted before it is read.
 */
export function computeHealth(
  client: HealthClientLike,
  reports: HealthReportLike[],
): ClientHealth {
  // Only weeks that fall inside the active engagement count. A report filed
  // while the client was still onboarding describes a different thing.
  const eligible = [...reports]
    .filter((r) => !client.activeSince || r.weekStart >= startOfWeek(client.activeSince))
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
  const window = eligible.slice(-HEALTH_WINDOW_WEEKS);
  const booked = window.reduce((s, r) => s + r.booked, 0);
  const countBased = booked < MIN_BOOKED_FOR_RATE;

  const weeks: HealthWeek[] = window.map((r) => ({
    weekStart: r.weekStart,
    showRate: showRateOf(r),
    result: weekResult(r, countBased),
  }));

  // The override wins outright — it exists precisely for the case where the
  // numbers have not caught up with what is actually broken.
  if (client.healthOverride === HEALTH_OVERRIDE_AT_RISK) {
    return {
      status: "AT_RISK",
      reason: "Manually flagged — operational break.",
      trend: trendOf(weeks),
      weeks,
      booked,
      overridden: true,
      countBased,
    };
  }

  if (window.length < MIN_WEEKS_TO_SCORE) {
    return ramping(
      `Only ${window.length} full reporting ${window.length === 1 ? "week" : "weeks"} since going active — needs ${MIN_WEEKS_TO_SCORE}.`,
      weeks,
      booked,
    );
  }
  if (booked < MIN_BOOKED_TO_SCORE) {
    return ramping(
      `Only ${booked} booked ${booked === 1 ? "consult" : "consults"} across the last ${window.length} weeks — too few to score.`,
      weeks,
      booked,
    );
  }

  const hardMisses = weeks.filter((w) => w.result === "fail").length;
  const softMisses = weeks.filter((w) => w.result === "soft").length;
  const basis = countBased ? "shows against booked" : "show rate";

  if (hardMisses >= HARD_MISSES_FOR_AT_RISK) {
    return {
      status: "AT_RISK",
      reason: `Show rate missed target in ${hardMisses} of the last ${weeks.length} weeks.`,
      trend: trendOf(weeks),
      weeks,
      booked,
      overridden: false,
      countBased,
    };
  }

  if (hardMisses + softMisses > 0) {
    return {
      status: "NEEDS_ATTENTION",
      reason: `${basis[0].toUpperCase()}${basis.slice(1)} dipped below target in ${hardMisses + softMisses} of the last ${weeks.length} weeks.`,
      trend: trendOf(weeks),
      weeks,
      booked,
      overridden: false,
      countBased,
    };
  }

  // Show rate is clean. Lead-to-booked is the only thing that can still pull
  // the status down, and only as far as Needs attention.
  const windowLeads = window.reduce((s, r) => s + r.leads, 0);
  const leadToBooked = windowLeads > 0 ? booked / windowLeads : null;
  if (leadToBooked !== null && leadToBooked < LEAD_TO_BOOKED_BAND.yellow[0]) {
    return {
      status: "NEEDS_ATTENTION",
      reason: `Show rate on target, but only ${Math.round(leadToBooked * 100)}% of leads are booking.`,
      trend: trendOf(weeks),
      weeks,
      booked,
      overridden: false,
      countBased,
    };
  }

  return {
    status: "HEALTHY",
    reason: `${basis[0].toUpperCase()}${basis.slice(1)} on target across the last ${weeks.length} weeks.`,
    trend: trendOf(weeks),
    weeks,
    booked,
    overridden: false,
    countBased,
  };
}

// Weekly reports are keyed to a week-start date. Comparing a report's week
// against the exact instant a client went active would drop the week the
// engagement started in, so activeSince is rounded back to its own week first.
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
