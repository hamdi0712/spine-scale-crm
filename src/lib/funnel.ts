// The dashboard's four headline numbers, back when there was a first client to
// count.
//
// There isn't yet, and that is the whole reason this module exists. The row
// used to read Active clients, MRR, Pipeline value, Follow-ups due — three
// numbers that are zero before the first clinic signs, and one that is a
// forecast of leads nobody has spoken to. Four cards saying nothing is worse
// than no cards: it makes the page look broken on the exact days it is supposed
// to be encouraging.
//
// What replaces them is the work actually happening at this stage: how many
// leads are worth talking to, how many were approached this week, how many of
// them wrote back, and how many got as far as a call. Every one of those moves
// the day you do the work, which is what a headline number is for.
//
// Pure. Nothing here touches the database — the page runs the queries and hands
// the rows in, the same arrangement src/lib/health.ts and src/lib/focus.ts have.
// The KPI card component is untouched: this changes what the four cards say,
// not what they look like.

import { LeadStage } from "@/lib/constants";
import { IcpAnswers, leadTier } from "@/lib/icp";

// ─── Windows ───────────────────────────────────────────────────────────────

// A week for activity, a month for a rate. The activity number answers "did I
// do the work this week", so it is short enough that a quiet week shows;
// the rate needs more than a week of replies before a percentage means
// anything, and a month is the shortest window that usually has some.
export const CONNECTIONS_WINDOW_DAYS = 7;
export const REPLY_RATE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

// ─── Card 1 — Qualified leads ──────────────────────────────────────────────

// Scored A or B, and nothing else. C-tier is a lead the framework says is not
// worth the time, and an unscored lead is one nobody has judged — counting
// either would turn "leads worth talking to" back into "rows in a table",
// which is the number this card exists not to be.
export interface QualifiedLeads {
  total: number;
  // Not yet approached: no connection request has gone out. This is the
  // actionable half of the number, which is why it leads the subtitle.
  untouched: number;
  // Approached, and past the New stage — the ones in play.
  contacted: number;
}

export function qualifiedLeads(
  leads: (IcpAnswers & {
    stage: string;
    connectionRequestSentAt: Date | null;
  })[],
): QualifiedLeads {
  const qualified = leads.filter((lead) => {
    const tier = leadTier(lead);
    return tier === "A" || tier === "B";
  });
  return {
    total: qualified.length,
    untouched: qualified.filter((l) => l.connectionRequestSentAt === null)
      .length,
    contacted: qualified.filter((l) => l.connectionRequestSentAt !== null)
      .length,
  };
}

export function qualifiedSubtitle(q: QualifiedLeads): string {
  if (q.total === 0) return "Score a lead A or B to see it here";
  if (q.untouched === 0) return `all ${q.total} approached`;
  if (q.contacted === 0)
    return `${q.untouched} not approached yet`;
  return `${q.untouched} to approach, ${q.contacted} in play`;
}

// ─── Card 2 — Connections sent ─────────────────────────────────────────────

// This week against the week before it. Both windows are the same length and
// the second sits immediately behind the first, so the comparison is like for
// like — the one claim a "+3 vs last week" has to earn.
export interface ConnectionsSent {
  thisWeek: number;
  lastWeek: number;
}

export function connectionsSent(
  leads: { connectionRequestSentAt: Date | null }[],
  now: Date,
): ConnectionsSent {
  const weekAgo = daysAgo(now, CONNECTIONS_WINDOW_DAYS);
  const twoWeeksAgo = daysAgo(now, CONNECTIONS_WINDOW_DAYS * 2);
  const sent = leads
    .map((l) => l.connectionRequestSentAt)
    .filter((d): d is Date => d !== null);
  return {
    thisWeek: sent.filter((d) => d >= weekAgo).length,
    lastWeek: sent.filter((d) => d >= twoWeeksAgo && d < weekAgo).length,
  };
}

export function connectionsSubtitle(c: ConnectionsSent): string {
  const diff = c.thisWeek - c.lastWeek;
  // A first week has nothing behind it, so it says what it is rather than
  // claiming a rise from a week that never happened.
  if (c.lastWeek === 0 && c.thisWeek === 0) return "None sent this week";
  if (c.lastWeek === 0) return "Connection requests sent";
  if (diff === 0) return "Same as last week";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs last week`;
}

// ─── Card 3 — Reply rate ───────────────────────────────────────────────────

// Replies over requests, among leads approached in the last 30 days.
//
// Scoped by when the request went out rather than when the reply came in,
// because that is the cohort the rate is about: of the people approached
// recently, how many answered. A lead approached in March who replied
// yesterday would otherwise lift a number that is meant to describe this
// month's outreach.
export interface ReplyRate {
  replied: number;
  contacted: number;
  // Null when nobody has been approached in the window. The card shows an em
  // dash for this — a 0% off no attempts reads as "nobody replies to you",
  // which is a claim the data has not made.
  percent: number | null;
}

export function replyRate(
  leads: { connectionRequestSentAt: Date | null; repliedAt: Date | null }[],
  now: Date,
): ReplyRate {
  const since = daysAgo(now, REPLY_RATE_WINDOW_DAYS);
  const contacted = leads.filter(
    (l) => l.connectionRequestSentAt !== null && l.connectionRequestSentAt >= since,
  );
  const replied = contacted.filter((l) => l.repliedAt !== null);
  return {
    replied: replied.length,
    contacted: contacted.length,
    percent:
      contacted.length === 0
        ? null
        : Math.round((replied.length / contacted.length) * 100),
  };
}

export function replyRateValue(r: ReplyRate): string {
  return r.percent === null ? "—" : `${r.percent}%`;
}

export function replyRateSubtitle(r: ReplyRate): string {
  if (r.contacted === 0) {
    return `No requests sent in ${REPLY_RATE_WINDOW_DAYS} days`;
  }
  return `${r.replied} replied of ${r.contacted} contacted`;
}

// ─── Card 4 — Discovery calls booked ───────────────────────────────────────

// Everything at or past the Discovery Call Booked stage. A lead at Proposal got
// there through a call, so counting only the leads sitting on that stage today
// would report a number that goes down when things go well.
export const DISCOVERY_REACHED_STAGES: LeadStage[] = [
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATING",
  "WON",
];

export interface DiscoveryBooked {
  total: number;
  // Sitting on the stage right now, as opposed to past it.
  atStage: number;
  // Discovery calls in the call log with a date this month. This is the only
  // honest timeframe available: no stage change is timestamped anywhere, so
  // "booked this month" cannot be read off a stage — but a call somebody
  // logged carries the date they booked it for.
  scheduledThisMonth: number;
}

export function discoverySubtitle(d: DiscoveryBooked): string {
  if (d.scheduledThisMonth > 0) {
    return `${d.scheduledThisMonth} on the calendar this month`;
  }
  if (d.total === 0) return "None booked yet";
  if (d.atStage === d.total) return "waiting on the call";
  if (d.atStage === 0) return "all progressed past the call";
  return `${d.atStage} upcoming, ${d.total - d.atStage} past it`;
}
