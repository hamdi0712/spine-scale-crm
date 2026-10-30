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
  SendingInboxView,
  emailToSend,
  emailWorkflowStatus,
  inboxShort,
  isEmailToSend,
  unfilledPlaceholders,
  isDueBy,
  nextFollowUp,
  sequenceLabel,
  startersRemaining,
  frontDeskMessage,
  senderFor,
} from "@/lib/emailWorkflow";
import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { autoCheckEmails } from "@/lib/actions/jobs";
import { creditsUsedThisMonth } from "@/lib/emailCheckRun";
import { getInstantlyApiKey } from "@/lib/appSecretsStore";
import { assignInboxes, inboxForLead, loadInboxes, sentTodayByInbox } from "@/lib/emailInboxes";
import type { EmailPanelProps } from "@/components/EmailPanel";
import { pickContactFormLink } from "@/lib/contactForm";
import { fmtDate } from "@/lib/format";

export interface EmailLeadState {
  status: EmailWorkflowStatus;
  toSend: EmailToSend | null;
  // There is an email to send, but it cannot go yet: why.
  sendBlocked: string | null;
  inbox: SendingInboxView | null;
  followUpDueToday: boolean;
  sequence: string;
}

type LeadWithSends = Lead & { emailSends: EmailSend[] };

export function emailLeadState(
  lead: LeadWithSends,
  settings: EmailSettingsValues,
  now: Date,
  inboxes: SendingInboxView[],
): EmailLeadState {
  const tier = leadTier(lead);
  const status = emailWorkflowStatus(lead, tier, lead.emailSends);
  const next = status === "in_sequence" ? nextFollowUp(lead.emailSends, settings) : null;
  const inbox = inboxForLead(lead, inboxes);
  const send = emailToSend(lead, tier, lead.emailSends, settings, now, inbox);
  return {
    status,
    toSend: isEmailToSend(send) ? send : null,
    sendBlocked: send !== null && "blocked" in send ? send.blocked : null,
    inbox,
    followUpDueToday: next !== null && isDueBy(next.dueAt, now),
    sequence: sequenceLabel(
      lead.emailSends,
      settings,
      status === "stopped" ? "stopped" : status === "replied" ? "replied" : status === "no_email" ? "no address" : null,
    ),
  };
}

// Leads that have become Ready with no inbox yet are given one now, before
// anything is shown — the first moment they are Ready is the first moment
// this sees them so.
async function assignReady(leads: LeadWithSends[], inboxes: SendingInboxView[]): Promise<void> {
  const ready = leads.filter(
    (l) => l.sendingInboxId === null && l.emailSends.length === 0 && emailWorkflowStatus(l, leadTier(l), l.emailSends) === "ready",
  );
  const given = await assignInboxes(ready.map((l) => l.id), inboxes);
  for (const l of ready) if (given[l.id]) l.sendingInboxId = given[l.id];
}

export interface InboxCounter {
  id: string;
  address: string;
  short: string;
  sent: number;
  limit: number;
}

async function inboxCounters(inboxes: SendingInboxView[], now: Date): Promise<InboxCounter[]> {
  const sent = await sentTodayByInbox(now);
  return inboxes.map((i) => ({ id: i.id, address: i.address, short: inboxShort(i.address), sent: sent[i.id] ?? 0, limit: i.dailyLimit }));
}

export async function loadEmailView(now = new Date()) {
  const [settings, leads, inboxes] = await Promise.all([
    loadEmailSettings(),
    prisma.lead.findMany({
      where: { ...PIPELINE_DEFAULT_WHERE, channel: "email" },
      include: { emailSends: { orderBy: { step: "asc" } } },
      orderBy: { updatedAt: "desc" },
    }),
    loadInboxes(),
  ]);
  await assignReady(leads, inboxes);
  // Newly promoted email leads arrive with an address nobody has checked;
  // they are checked on their own from here, budget allowing.
  void autoCheckEmails();
  const counters = await inboxCounters(inboxes, now);
  const rows = leads.map((l) => {
    const s = leadScore(l);
    const state = emailLeadState(l, settings, now, inboxes);
    const counter = counters.find((c) => c.id === state.inbox?.id) ?? null;
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
      status: state.status,
      sequence: state.sequence,
      toSend: state.toSend,
      sendBlocked: state.sendBlocked,
      followUpDueToday: state.followUpDueToday,
      inbox: state.inbox ? state.inbox.address : null,
      inboxSentToday: counter?.sent ?? 0,
      inboxLimit: counter?.limit ?? 0,
    };
  });
  const check = await checkInfo(now);
  return {
    rows,
    settings,
    counters,
    check,
    starters: startersRemaining(settings),
    unchecked: leads.filter((l) => (l.email ?? "").trim() !== "" && l.emailStatus === null).length,
  };
}

// Everything the Email panel on a lead's page shows.
export async function emailPanelProps(lead: LeadWithSends, now = new Date()): Promise<EmailPanelProps> {
  const [settings, inboxes] = await Promise.all([loadEmailSettings(), loadInboxes()]);
  await assignReady([lead], inboxes);
  const counters = await inboxCounters(inboxes, now);
  const state = emailLeadState(lead, settings, now, inboxes);
  const counter = counters.find((c) => c.id === state.inbox?.id) ?? null;
  const check = contactCheck(lead);
  return {
    leadId: lead.id,
    clinicName: lead.clinicName,
    status: state.status,
    sequence: state.sequence,
    toSend: state.toSend,
    sendBlocked: state.sendBlocked,
    starters: startersRemaining(settings),
    inbox: state.inbox ? { id: state.inbox.id, address: state.inbox.address } : null,
    inboxes: inboxes.map((i) => ({ id: i.id, address: i.address })),
    // Fixed once Email 1 has gone: the follow-ups stay in its thread.
    inboxLocked: lead.emailSends.length > 0,
    inboxSentToday: counter?.sent ?? 0,
    inboxLimit: counter?.limit ?? 0,
    check: { ...(await checkInfo(now)), checked: lead.emailStatus !== null },
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
    sends: lead.emailSends.map((s) => ({
      step: s.step,
      sentAt: s.sentAt.toISOString(),
      subject: s.subject,
      toEmail: s.toEmail,
      fromEmail: s.fromEmail,
    })),
    reply: lead.emailRepliedAt
      ? { at: lead.emailRepliedAt.toISOString(), type: lead.emailReplyType, text: lead.emailReplyText }
      : null,
    suppressed:
      lead.suppressedAt && lead.suppressedReason
        ? { reason: lead.suppressedReason, at: lead.suppressedAt.toISOString() }
        : null,
  };
}

// One lead's state, as a page would show it: given an inbox first if it has
// just become Ready.
export async function loadLeadEmailState(leadId: string, now = new Date()): Promise<EmailLeadState> {
  const [settings, inboxes, lead] = await Promise.all([
    loadEmailSettings(),
    loadInboxes(),
    prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { emailSends: { orderBy: { step: "asc" } } } }),
  ]);
  await assignReady([lead], inboxes);
  return emailLeadState(lead, settings, now, inboxes);
}

// What the check buttons quote: the key, this month's credits, the cost of one.
export async function checkInfo(now = new Date()) {
  const [settings, used, key] = await Promise.all([loadEmailSettings(), creditsUsedThisMonth(now), getInstantlyApiKey()]);
  return { hasKey: key !== null, used, budget: settings.checkCreditBudget, perCheck: settings.creditsPerCheck };
}

// The lead page's contact-form buttons: the clinic's contact page off the
// stored links, the front-desk message signed from the lead's inbox (or Your
// name), and when a form was last marked sent.
export async function contactFormProps(lead: LeadWithSends) {
  const [settings, inboxes, last] = await Promise.all([
    loadEmailSettings(),
    loadInboxes(),
    prisma.activityLog.findFirst({
      where: { leadId: lead.id, kind: "CONTACT_FORM_SENT" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const inbox = inboxForLead(lead, inboxes);
  const sender = inbox ? senderFor(inbox, settings) : settings.senderName.trim();
  return {
    leadId: lead.id,
    contactFormUrl: pickContactFormLink(lead.websiteLinks, lead.websiteUrl),
    message: frontDeskMessage(lead, settings, sender),
    lastSentLabel: last ? `Form sent ${fmtDate(last.createdAt)}` : null,
  };
}
