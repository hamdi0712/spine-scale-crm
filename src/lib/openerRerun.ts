// "Re-run openers" (Settings → Email): which leads it touches, in what order,
// and what it is estimated to cost. Server-only; the job is startOpenerRerun
// in src/lib/actions/jobs.ts.
//
//   1. Every email lead not yet sent with an approved email (Ready, or
//      approved and waiting on something else): unapproved, its old opener
//      kept as a lead note, regenerated.
//   2. Every A-tier lead in Needs opener, then every B-tier one.
// Nothing is approved: each new opener waits for approval by hand.

import { prisma } from "@/lib/prisma";
import { PIPELINE_DEFAULT_WHERE } from "@/lib/liveLeadWhere";
import { leadTier } from "@/lib/leadScore";
import { emailWorkflowStatus } from "@/lib/emailWorkflow";

// One DeepSeek call for an opener (about 3k tokens in, 300 out), and up to
// two per lead when the first is rejected by the screen. A worst-case guess,
// rounded up.
export const OPENER_CALL_USD = 0.002;
export const OPENER_MAX_CALLS_PER_LEAD = 2;

export interface RerunLead {
  id: string;
  name: string;
  reset: boolean;
}

export async function openerRerunLeads(): Promise<RerunLead[]> {
  const leads = await prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, channel: "email" },
    include: { emailSends: { select: { step: true, sentAt: true } } },
    orderBy: { clinicName: "asc" },
  });
  const rank = (t: string | null) => (t === "A" ? 0 : t === "B" ? 1 : 2);
  const unsent = leads.filter((l) => l.emailSends.length === 0 && !l.suppressedAt && !l.emailUnsubscribedAt && !l.emailRepliedAt);
  const reset = unsent
    .filter((l) => l.emailApprovedAt !== null)
    .sort((a, b) => rank(leadTier(a)) - rank(leadTier(b)));
  const needs = unsent
    .filter((l) => l.emailApprovedAt === null && (leadTier(l) === "A" || leadTier(l) === "B"))
    .filter((l) => emailWorkflowStatus(l, leadTier(l), l.emailSends) === "needs_opener")
    .sort((a, b) => rank(leadTier(a)) - rank(leadTier(b)));
  return [
    ...reset.map((l) => ({ id: l.id, name: l.clinicName, reset: true })),
    ...needs.map((l) => ({ id: l.id, name: l.clinicName, reset: false })),
  ];
}

export interface RerunEstimate {
  reset: number;
  needs: number;
  maxUsd: number;
}

export async function openerRerunEstimate(): Promise<RerunEstimate> {
  const list = await openerRerunLeads();
  const reset = list.filter((l) => l.reset).length;
  return { reset, needs: list.length - reset, maxUsd: list.length * OPENER_CALL_USD * OPENER_MAX_CALLS_PER_LEAD };
}
