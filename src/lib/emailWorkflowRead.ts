// The Email view's rows and the Email panel's state, read for a page.
// Server-only. Every judgement is made by src/lib/emailWorkflow.ts.

import { Lead, EmailSend } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PIPELINE_DEFAULT_WHERE } from "@/lib/liveLeadWhere";
import { leadScore, leadTier, leadVerdictBadge } from "@/lib/leadScore";
import { emailDetailLine } from "@/lib/emailChannel";
import {
  EmailSettingsValues,
  EmailToSend,
  EmailWorkflowStatus,
  contactCheck,
  defaultEmailVersion,
  emailToSend,
  emailWorkflowStatus,
  unfilledPlaceholders,
  isDueBy,
  nextFollowUp,
  sequenceLabel,
  startersRemaining,
} from "@/lib/emailWorkflow";
import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { countSentToday } from "@/lib/actions/emailWorkflow";
import type { EmailPanelProps } from "@/components/EmailPanel";

export interface EmailLeadState {
  status: EmailWorkflowStatus;
  toSend: EmailToSend | null;
  followUpDueToday: boolean;
  sequence: string;
}

export function emailLeadState(
  lead: Lead & { emailSends: EmailSend[] },
  settings: EmailSettingsValues,
  now: Date,
): EmailLeadState {
  const tier = leadTier(lead);
  const status = emailWorkflowStatus(lead, tier, lead.emailSends);
  const next = status === "in_sequence" ? nextFollowUp(lead.emailSends, settings) : null;
  return {
    status,
    toSend: emailToSend(lead, tier, lead.emailSends, settings, now),
    followUpDueToday: next !== null && isDueBy(next.dueAt, now),
    sequence: sequenceLabel(
      lead.emailSends,
      settings,
      status === "stopped" ? "stopped" : status === "replied" ? "replied" : status === "no_email" ? "no address" : null,
    ),
  };
}

export async function loadEmailView(now = new Date()) {
  const [settings, leads, sentToday] = await Promise.all([
    loadEmailSettings(),
    prisma.lead.findMany({
      where: { ...PIPELINE_DEFAULT_WHERE, channel: "email" },
      include: { emailSends: { orderBy: { step: "asc" } } },
      orderBy: { updatedAt: "desc" },
    }),
    countSentToday(now),
  ]);
  const rows = leads.map((l) => {
    const s = leadScore(l);
    const state = emailLeadState(l, settings, now);
    return {
      id: l.id,
      clinicName: l.clinicName,
      contactName: l.contactName,
      location: l.location,
      email: (l.email ?? "").trim() || null,
      emailDetail: emailDetailLine(l),
      icpTier: leadTier(l),
      icpVerdict: leadVerdictBadge(l),
      icpScore: s ? `${s.total}/${s.max}` : null,
      ...state,
    };
  });
  return {
    rows,
    settings,
    sentToday,
    starters: startersRemaining(settings),
    unchecked: leads.filter((l) => (l.email ?? "").trim() !== "" && l.emailStatus === null).length,
  };
}

// Everything the Email panel on a lead's page shows.
export async function emailPanelProps(
  lead: Lead & { emailSends: EmailSend[] },
  now = new Date(),
): Promise<EmailPanelProps> {
  const [settings, sentToday] = await Promise.all([loadEmailSettings(), countSentToday(now)]);
  const state = emailLeadState(lead, settings, now);
  const check = contactCheck(lead);
  return {
    leadId: lead.id,
    clinicName: lead.clinicName,
    status: state.status,
    sequence: state.sequence,
    toSend: state.toSend,
    starters: startersRemaining(settings),
    sentToday,
    dailyLimit: settings.dailyLimit,
    email: (lead.email ?? "").trim() || null,
    emailDetail: emailDetailLine(lead),
    contact:
      check.state === "mismatch"
        ? { state: "mismatch", scorecardName: check.scorecardName, contactName: check.contactName }
        : { state: "confirmed", scorecardName: check.scorecardName, contactName: lead.contactName },
    opener: lead.emailOpener,
    openerNote: lead.emailOpenerNote,
    openerMechanism: lead.emailOpenerMechanism,
    version: defaultEmailVersion(lead),
    subject: lead.emailSubject,
    body: lead.emailBody,
    approved: lead.emailApprovedAt !== null,
    unfilled: unfilledPlaceholders(`${lead.emailSubject ?? ""}\n${lead.emailBody ?? ""}`),
    sends: lead.emailSends.map((s) => ({ step: s.step, sentAt: s.sentAt.toISOString(), subject: s.subject, toEmail: s.toEmail })),
    reply: lead.emailRepliedAt
      ? { at: lead.emailRepliedAt.toISOString(), type: lead.emailReplyType, text: lead.emailReplyText }
      : null,
    suppressed:
      lead.suppressedAt && lead.suppressedReason
        ? { reason: lead.suppressedReason, at: lead.suppressedAt.toISOString() }
        : null,
  };
}
