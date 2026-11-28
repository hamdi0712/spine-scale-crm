// The Email view's rows and the Email panel's state, read for a page.
// Server-only. Every judgement is made by src/lib/emailWorkflow.ts.
//
// Reading only: nothing here writes or starts a job. A lead's inbox is given
// by the write that makes it Ready (src/lib/emailInboxes.ts), and addresses
// are checked by the contact finder (src/lib/contactFinderRun.ts).

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
  contactValidation,
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
  CONTACT_FORM_CALL_AFTER_DAYS,
  senderFor,
  emailStepLabel,
  undoSendBlocker,
  canAcceptRisky,
  riskyAccepted,
} from "@/lib/emailWorkflow";
import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { creditsUsedThisMonth } from "@/lib/emailCheckRun";
import { getInstantlyApiKey } from "@/lib/appSecretsStore";
import { inboxForLead, loadInboxes, sentTodayByInbox } from "@/lib/emailInboxes";
import type { EmailPanelProps } from "@/components/EmailPanel";
import { pickContactFormLink } from "@/lib/contactForm";
import { hasRiskyEmail } from "@/lib/ownerFind";
import { formBucketOf } from "@/lib/emailBuckets";
import { formSentAtByLead } from "@/lib/contactFormSent";
import { preSendCheck, shortClinicFor } from "@/lib/emailRules";
import { DUPLICATE_SELECT, duplicateIndex, matchTag } from "@/lib/duplicates";
import { canAutoAccept } from "@/lib/contactFinder";
import { revokedAddresses } from "@/lib/contactFinderRun";
import type { EmailSource } from "@/lib/emailFind";

function fmtDayMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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
  // When the contact form was last marked sent, if ever.
  formSentAt: Date | null = null,
): EmailLeadState {
  const tier = leadTier(lead);
  const status = emailWorkflowStatus(lead, tier, lead.emailSends, formBucketOf(lead, lead.emailSends.length, formSentAt));
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

export interface InboxCounter {
  id: string;
  address: string;
  short: string;
  sent: number;
  limit: number;
  // Sends to accepted risky addresses today, and the per-inbox risky limit.
  riskySent: number;
  riskyLimit: number;
}

async function inboxCounters(inboxes: SendingInboxView[], now: Date, riskyLimit: number): Promise<InboxCounter[]> {
  const [sent, risky] = await Promise.all([sentTodayByInbox(now), sentTodayByInbox(now, { risky: true })]);
  return inboxes.map((i) => ({
    id: i.id,
    address: i.address,
    short: inboxShort(i.address),
    sent: sent[i.id] ?? 0,
    limit: i.dailyLimit,
    riskySent: risky[i.id] ?? 0,
    riskyLimit,
  }));
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
  const formSent = await formSentAtByLead(leads.map((l) => l.id));
  // The same doctor or clinic on another lead, any channel: a marker only.
  const dupes = duplicateIndex(await prisma.lead.findMany({ where: { archived: false }, select: DUPLICATE_SELECT }));
  const counters = await inboxCounters(inboxes, now, settings.riskyDailyLimit);
  const rows = leads.map((l) => {
    const s = leadScore(l);
    const state = emailLeadState(l, settings, now, inboxes, formSent.get(l.id) ?? null);
    const counter = counters.find((c) => c.id === state.inbox?.id) ?? null;
    const isForm = state.status === "contact_form" || state.status === "form_sent";
    return {
      id: l.id,
      clinicName: l.clinicName,
      contactName: l.contactName,
      location: l.location,
      email: (l.email ?? "").trim() || null,
      emailDetail: emailDetailLine(l),
      risky: hasRiskyEmail(l),
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
      inboxRiskySentToday: counter?.riskySent ?? 0,
      riskyLimit: settings.riskyDailyLimit,
      riskyAccepted: riskyAccepted(l),
      riskyFlagged: l.emailRiskyFlaggedAt !== null,
      // "Also on: Strauss Scoliosis Correction · LinkedIn · Contacted".
      duplicates: (dupes.get(l.id) ?? []).map((d) => matchTag(l.channel, d)),
      contactStatus: l.contactStatus,
      stage: l.stage,
      // Contact form / Copy message / Mark form sent, in place of the address.
      form: isForm ? contactFormPropsFor(l, settings, inboxes, formSent.get(l.id) ?? null) : null,
    };
  });
  const check = await checkInfo(now);
  return {
    rows,
    settings,
    counters,
    check,
    starters: startersRemaining(settings),
    unchecked: leads.filter((l) => l.stage !== "LOST" && (l.email ?? "").trim() !== "" && l.emailStatus === null).length,
  };
}

// Whether the contact finder accepts this risky address on its own (found,
// on the clinic's own domain or free mail, never revoked by you).
async function finderWillAccept(lead: LeadWithSends): Promise<boolean> {
  const address = (lead.email ?? "").trim().toLowerCase();
  if (address === "" || lead.emailStatus !== "risky") return false;
  if (!canAutoAccept({ address, status: lead.emailStatus, source: (lead.emailSource as EmailSource | null) ?? null }, lead.websiteUrl)) return false;
  return !(await revokedAddresses(lead.id)).has(address);
}

// Everything the Email panel on a lead's page shows.
// The latest send, when "Undo mark sent" may take it back.
function undoProp(lead: LeadWithSends): EmailPanelProps["undo"] {
  const last = lead.emailSends.reduce<EmailSend | null>((a, b) => (a && a.step > b.step ? a : b), null);
  if (!last || undoSendBlocker(lead, lead.emailSends, last.id)) return null;
  return { sendId: last.id, label: emailStepLabel(last.step) };
}

export async function emailPanelProps(lead: LeadWithSends, now = new Date()): Promise<EmailPanelProps> {
  const [settings, inboxes] = await Promise.all([loadEmailSettings(), loadInboxes()]);
  const counters = await inboxCounters(inboxes, now, settings.riskyDailyLimit);
  const formSentAt = (await formSentAtByLead([lead.id])).get(lead.id) ?? null;
  const state = emailLeadState(lead, settings, now, inboxes, formSentAt);
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
    inboxRiskySentToday: counter?.riskySent ?? 0,
    riskyLimit: settings.riskyDailyLimit,
    risky: {
      isRisky: (lead.email ?? "").trim() !== "" && lead.emailStatus === "risky",
      // Accept by hand only where the contact finder will not: an address
      // typed in, one found off the clinic's domain, or one you revoked.
      canAccept: canAcceptRisky(lead) && !(await finderWillAccept(lead)),
      autoAcceptable: await finderWillAccept(lead),
      accepted: riskyAccepted(lead),
      // Already emailed: revoking pauses its follow-ups rather than leaving Ready.
      inSequence: lead.emailSends.length > 0,
      flagged: lead.emailRiskyFlaggedAt ? { at: lead.emailRiskyFlaggedAt.toISOString(), reason: lead.emailRiskyFlagReason } : null,
    },
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
    openerAngle: lead.openerAngle,
    contactIssues: contactValidation(lead).issues,
    shortClinic: { ...shortClinicFor(lead), stored: (lead.shortClinicName ?? "").trim() !== "" },
    preSend:
      lead.emailSubject && lead.emailBody && lead.emailSends.length === 0
        ? preSendCheck(lead.emailSubject, lead.emailBody, { optOutLine: settings.optOutLine, clinicName: lead.clinicName })
        : [],
    version: defaultEmailVersion(lead),
    subject: lead.emailSubject,
    body: lead.emailBody,
    approved: lead.emailApprovedAt !== null,
    unfilled: unfilledPlaceholders(`${lead.emailSubject ?? ""}\n${lead.emailBody ?? ""}`),
    undo: undoProp(lead),
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

// One lead's state, as a page would show it.
export async function loadLeadEmailState(leadId: string, now = new Date()): Promise<EmailLeadState> {
  const [settings, inboxes, lead] = await Promise.all([
    loadEmailSettings(),
    loadInboxes(),
    prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { emailSends: { orderBy: { step: "asc" } } } }),
  ]);
  return emailLeadState(lead, settings, now, inboxes, (await formSentAtByLead([lead.id])).get(lead.id) ?? null);
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
  const [settings, inboxes, sent] = await Promise.all([loadEmailSettings(), loadInboxes(), formSentAtByLead([lead.id])]);
  return contactFormPropsFor(lead, settings, inboxes, sent.get(lead.id) ?? null);
}

export function contactFormPropsFor(lead: LeadWithSends, settings: EmailSettingsValues, inboxes: SendingInboxView[], lastSentAt: Date | null) {
  const inbox = inboxForLead(lead, inboxes);
  const sender = inbox ? senderFor(inbox, settings) : settings.senderName.trim();
  return {
    leadId: lead.id,
    contactFormUrl: pickContactFormLink(lead.websiteLinks, lead.websiteUrl),
    message: frontDeskMessage(lead, settings, sender),
    // "Sent Oct 30 · call Nov 2": the day it went, and the call Mark form sent booked.
    lastSentLabel: lastSentAt
      ? `Sent ${fmtDayMonth(lastSentAt)} · call ${fmtDayMonth(new Date(lastSentAt.getTime() + CONTACT_FORM_CALL_AFTER_DAYS * 86_400_000))}`
      : null,
  };
}
