// The eight numbers beside the checklist — what actually happened today,
// counted off the records rather than typed in.
//
// The checklist asks whether you did the work; this says how much of it landed.
// Nothing here is entered by hand, which is the point: a routine you tick and a
// tally you also type are two accounts of the same day that can disagree, and
// the one nobody can fudge is the useful one.
//
// Every count is scoped to one day read in UTC, matching the checklist's own
// reading of a day (src/lib/dailyChecklist.ts) so the panel and the ticks
// beside it are always talking about the same twenty-four hours.
//
// The counts are deliberately all "today", including on a past day: opening
// yesterday shows yesterday's numbers, because the marks they are read off
// (connectionRequestSentAt, sentAt, repliedAt) are instants that stay where
// they were put.

import { prisma } from "@/lib/prisma";
import { addDays, toChecklistDay } from "@/lib/dailyChecklist";

// The eight counts, named. The keys are what the bonus tally reads the panel
// by (src/lib/dailyBonus.ts) — a label is wording and can be reworded, a key
// is the identity of the count.
export const DAILY_NUMBER_KEYS = [
  "NEW_CLINICS",
  "CONNECTION_REQUESTS",
  "ACCEPTED",
  "FIRST_MESSAGES",
  "REPLIES",
  "AUDIT_OFFERS",
  "LOOMS",
  "FOLLOW_UPS",
] as const;

export type DailyNumberKey = (typeof DAILY_NUMBER_KEYS)[number];

export interface DailyNumber {
  key: DailyNumberKey;
  label: string;
  value: number;
  // What the number is read off, shown under it. Present because a count with
  // no stated source invites the question every time it looks wrong.
  source: string;
}

export async function loadDailyNumbers(day: Date): Promise<DailyNumber[]> {
  const start = toChecklistDay(day);
  const end = addDays(start, 1);
  const onDay = { gte: start, lt: end };

  // One step's sent messages. The four message counts differ only by step, so
  // they are built rather than written out four times.
  const sentStep = (step: string) =>
    prisma.outreachMessage.count({ where: { step, sentAt: onDay } });

  const [
    newLeads,
    newCandidates,
    requests,
    accepted,
    firstMessages,
    replies,
    auditOffers,
    looms,
    followUps,
  ] = await Promise.all([
    // New clinics is both halves of the top of the funnel: a lead typed
    // straight in and a candidate that arrived on an import are each a clinic
    // that was not on the books this morning. Counting only one of them would
    // read as a quiet day whenever the work went through the other.
    prisma.lead.count({ where: { createdAt: onDay } }),
    prisma.discoveryCandidate.count({ where: { createdAt: onDay } }),
    prisma.lead.count({ where: { connectionRequestSentAt: onDay } }),
    prisma.lead.count({ where: { connectionAcceptedAt: onDay } }),
    sentStep("FIRST_MESSAGE"),
    prisma.lead.count({ where: { repliedAt: onDay } }),
    sentStep("AUDIT_OFFER"),
    sentStep("LOOM_DELIVERY"),
    sentStep("FOLLOW_UP"),
  ]);

  return [
    {
      key: "NEW_CLINICS",
      label: "New clinics",
      value: newLeads + newCandidates,
      source: "Leads and discovery candidates created",
    },
    {
      key: "CONNECTION_REQUESTS",
      label: "Connection requests",
      value: requests,
      source: "Marked sent on the lead",
    },
    {
      key: "ACCEPTED",
      label: "Accepted",
      value: accepted,
      source: "Marked accepted on the lead",
    },
    {
      key: "FIRST_MESSAGES",
      label: "First messages",
      value: firstMessages,
      source: "Sequence step 2, marked sent",
    },
    {
      key: "REPLIES",
      label: "Replies",
      value: replies,
      source: "Marked replied on the lead",
    },
    {
      key: "AUDIT_OFFERS",
      label: "Audit offers",
      value: auditOffers,
      source: "Sequence step 3, marked sent",
    },
    {
      key: "LOOMS",
      label: "Looms",
      value: looms,
      source: "Sequence step 4, marked sent",
    },
    {
      key: "FOLLOW_UPS",
      label: "Follow-ups",
      value: followUps,
      source: "Sequence step 5, marked sent",
    },
  ];
}
