// Cold email, sent by hand from Gmail — the rules.
//
// The email channel's whole workflow, as plain functions: the templates and
// their starter copy, how an email is put together from a template and an
// opener, whether the contact agrees with the scorecard's decision-maker,
// what status a lead is in and whether it is Ready, when a follow-up is due,
// and the Gmail compose link.
//
// Nothing here sends. An email is drafted and approved in the app, opened in
// Gmail (or copied), sent there by hand, and marked sent here. The reads and
// writes live in src/lib/actions/emailWorkflow.ts.
//
// Pure: no network, no database. Imported by client components.

import { EmailLeadStatus } from "@/lib/emailChannel";
import { clinicDomain, readDecisionMakerName, scorecardDecisionMaker } from "@/lib/emailFind";
import { leadBreakdownV2 } from "@/lib/leadScore";
import { ScorecardEvidence } from "@/lib/outreachSequence";
import { IcpTier } from "@/lib/icp";
import { addressIsPlaceholder, salutation } from "@/lib/outreachSequence";

// ─── Settings ──────────────────────────────────────────────────────────────

export const EMAIL_SETTINGS_ID = "default";

export interface EmailSettingsValues {
  // The owner-direct subject; the front desk has its own below.
  subjectTemplate: string;
  frontDeskSubjectTemplate: string;
  ownerBodyTemplate: string;
  frontDeskTemplate: string;
  optOutLine: string;
  followUpTemplates: string[];
  // After the opt-out line, on every email: "{sender}" and whatever else the
  // signature carries.
  signOff: string;
  senderName: string;
  followUpDelayDays: number;
  dailyLimit: number;
  // Instantly email checks: this month's credit budget, and one check's cost.
  checkCreditBudget: number;
  creditsPerCheck: number;
}

// Starter copy: something that reads as an email, so the workflow can be
// tried end to end, and plainly not the operator's own words. While any
// template still holds it, the Email view and the Email panel say so.
export const STARTER_SUBJECT = "Quick question about {clinic}";
export const STARTER_FRONT_DESK_SUBJECT = "Quick question about {clinic}";
export const STARTER_OWNER_BODY = [
  "{greeting}",
  "",
  "{opener}",
  "",
  "I help non-surgical spine and decompression clinics turn more of the people who ask about care into booked consults. If it's useful, I can send a short note on what I'd look at first for {clinic}.",
  "",
  "Worth sending?",
].join("\n");
export const STARTER_FRONT_DESK_BODY = [
  "{greeting}",
  "",
  "{opener}",
  "",
  "Could you pass this to {contact}? I help non-surgical spine clinics turn more inquiries into booked consults, and I'd like to send a short note on what I'd look at first for {clinic}.",
].join("\n");
export const STARTER_OPT_OUT = "If this isn't relevant, just reply \"no\" and I won't email again.";
export const STARTER_FOLLOW_UPS = [
  "Following up on my note below. Is it worth me sending what I'd look at first for {clinic}?",
  "Last note from me. If the timing's off, no problem at all, and if it's useful later just reply and I'll send it over.",
];
export const STARTER_SIGN_OFF = "{sender}";

export const DEFAULT_FOLLOW_UP_DELAY_DAYS = 3;
export const DEFAULT_DAILY_LIMIT = 10;
export const MAX_FOLLOW_UPS = 5;
export const MAX_TEMPLATE_CHARS = 4000;

export const DEFAULT_EMAIL_SETTINGS: EmailSettingsValues = {
  subjectTemplate: STARTER_SUBJECT,
  frontDeskSubjectTemplate: STARTER_FRONT_DESK_SUBJECT,
  ownerBodyTemplate: STARTER_OWNER_BODY,
  frontDeskTemplate: STARTER_FRONT_DESK_BODY,
  optOutLine: STARTER_OPT_OUT,
  followUpTemplates: STARTER_FOLLOW_UPS,
  signOff: STARTER_SIGN_OFF,
  senderName: "",
  followUpDelayDays: DEFAULT_FOLLOW_UP_DELAY_DAYS,
  dailyLimit: DEFAULT_DAILY_LIMIT,
  checkCreditBudget: 150,
  creditsPerCheck: 1,
};

export const STARTER_COPY_BANNER = "Starter copy — edit your templates in Settings → Email before sending.";

// The templates still holding their starter copy, by name, for the banner.
// Compared as written, whitespace aside: a template counts as edited the
// moment its words change.
export function startersRemaining(s: EmailSettingsValues): string[] {
  const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  if (same(s.subjectTemplate, STARTER_SUBJECT)) out.push("Owner subject");
  if (same(s.frontDeskSubjectTemplate, STARTER_FRONT_DESK_SUBJECT)) out.push("Front-desk subject");
  if (same(s.ownerBodyTemplate, STARTER_OWNER_BODY)) out.push("Owner-direct email");
  if (same(s.frontDeskTemplate, STARTER_FRONT_DESK_BODY)) out.push("Front-desk email");
  if (same(s.optOutLine, STARTER_OPT_OUT)) out.push("Opt-out line");
  s.followUpTemplates.forEach((t, i) => {
    if (STARTER_FOLLOW_UPS.some((starter) => same(t, starter))) out.push(`Follow-up ${i + 1}`);
  });
  if (same(s.signOff, STARTER_SIGN_OFF)) out.push("Sign-off");
  return out;
}

function text(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() !== "" ? v.slice(0, MAX_TEMPLATE_CHARS) : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function readFollowUpTemplates(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return STARTER_FOLLOW_UPS;
    }
  }
  if (!Array.isArray(list)) return STARTER_FOLLOW_UPS;
  return list
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .map((t) => t.slice(0, MAX_TEMPLATE_CHARS))
    .slice(0, MAX_FOLLOW_UPS);
}

// The stored row, or anything else, as settings the workflow can run on. A
// missing row is the defaults; a blank template is its starter copy.
export function readEmailSettings(row: Record<string, unknown> | null | undefined): EmailSettingsValues {
  const r = row ?? {};
  return {
    subjectTemplate: text(r.subjectTemplate, STARTER_SUBJECT),
    frontDeskSubjectTemplate: text(r.frontDeskSubjectTemplate, STARTER_FRONT_DESK_SUBJECT),
    ownerBodyTemplate: text(r.ownerBodyTemplate, STARTER_OWNER_BODY),
    frontDeskTemplate: text(r.frontDeskTemplate, STARTER_FRONT_DESK_BODY),
    optOutLine: text(r.optOutLine, STARTER_OPT_OUT),
    followUpTemplates: r.followUpTemplates === undefined ? STARTER_FOLLOW_UPS : readFollowUpTemplates(r.followUpTemplates),
    signOff: text(r.signOff, STARTER_SIGN_OFF),
    senderName: typeof r.senderName === "string" ? r.senderName.trim().slice(0, 200) : "",
    followUpDelayDays: int(r.followUpDelayDays, DEFAULT_FOLLOW_UP_DELAY_DAYS, 1, 60),
    dailyLimit: int(r.dailyLimit, DEFAULT_DAILY_LIMIT, 1, 500),
    checkCreditBudget: int(r.checkCreditBudget, 150, 0, 1_000_000),
    creditsPerCheck: (() => {
      const n = Number(r.creditsPerCheck);
      return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 1;
    })(),
  };
}

export function emailSettingsRow(s: EmailSettingsValues) {
  return {
    subjectTemplate: s.subjectTemplate,
    frontDeskSubjectTemplate: s.frontDeskSubjectTemplate,
    ownerBodyTemplate: s.ownerBodyTemplate,
    frontDeskTemplate: s.frontDeskTemplate,
    optOutLine: s.optOutLine,
    followUpTemplates: JSON.stringify(s.followUpTemplates),
    signOff: s.signOff,
    senderName: s.senderName,
    followUpDelayDays: s.followUpDelayDays,
    dailyLimit: s.dailyLimit,
    checkCreditBudget: s.checkCreditBudget,
    creditsPerCheck: s.creditsPerCheck,
  };
}

// ─── Which version, and the greeting ───────────────────────────────────────

export const EMAIL_VERSIONS = ["owner", "front_desk"] as const;
export type EmailVersion = (typeof EMAIL_VERSIONS)[number];
export const EMAIL_VERSION_LABELS: Record<EmailVersion, string> = {
  owner: "Owner-direct",
  front_desk: "Front desk",
};

export function readEmailVersion(v: unknown): EmailVersion | null {
  return v === "owner" || v === "front_desk" ? v : null;
}

// The version an address calls for: the owner's own inbox gets the
// owner-direct email, anything else is a front desk.
export function defaultEmailVersion(lead: { emailType: string | null; emailVersion?: string | null }): EmailVersion {
  return readEmailVersion(lead.emailVersion) ?? (lead.emailType === "owner" ? "owner" : "front_desk");
}

export interface EmailLeadInput {
  clinicName: string;
  contactName: string | null;
  contactTitle: string | null;
  websiteNotes: string | null;
}

// "Hi Dr. Chen," to the owner, by salutation(), the same decision the
// LinkedIn sequence makes. "Hi there," where the record has no name to use —
// a placeholder never goes into an email. The front desk is greeted as the
// clinic's team.
export function emailGreeting(lead: EmailLeadInput, version: EmailVersion): string {
  if (version === "front_desk") return `Hi ${lead.clinicName.trim()} team,`;
  const s = salutation(lead.contactName, lead.contactTitle, lead.websiteNotes);
  return addressIsPlaceholder(s) ? "Hi there," : `Hi ${s.address},`;
}

// Who the front desk is asked to pass it to.
function contactFor(lead: EmailLeadInput): string {
  const s = salutation(lead.contactName, lead.contactTitle, lead.websiteNotes);
  if (addressIsPlaceholder(s)) return "the owner";
  return s.honorific ? s.address : (lead.contactName ?? "").trim() || s.address;
}

// A blank value leaves its placeholder in place rather than an empty gap —
// so an email with no sender name set reads "{sender}" and cannot be
// approved until it is set, instead of going out unsigned.
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values && (values[key] !== "" || key === "opener") ? values[key] : whole,
  );
}

// Placeholders left unfilled, so the panel can refuse to approve an email
// with "{opener}" still in it.
//
// {sender} is the exception: it is filled when the email is sent, from the
// inbox it goes out of (see senderFor), so it stays in the draft on purpose.
export const SEND_TIME_PLACEHOLDERS = ["{sender}"];

export function unfilledPlaceholders(textIn: string): string[] {
  return Array.from(new Set(Array.from(textIn.matchAll(/\{(\w+)\}/g)).map((m) => m[0]))).filter(
    (p) => !SEND_TIME_PLACEHOLDERS.includes(p),
  );
}

// An email from its template: the greeting where the template puts
// {greeting} (at the top where it has none, as the follow-ups do not), the
// template, the opt-out line, and the sign-off.
function assemble(
  greeting: string,
  template: string,
  values: Record<string, string>,
  settings: Pick<EmailSettingsValues, "optOutLine" | "signOff">,
): string {
  const hasGreeting = template.includes("{greeting}");
  const body = fill(template, { ...values, greeting });
  return [hasGreeting ? null : greeting, body.trim(), settings.optOutLine.trim(), fill(settings.signOff, values).trim()]
    .filter((part): part is string => part !== null && part !== "")
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The whole first email: the version's subject, and a body of greeting, the
// template with the opener in it, the opt-out line and the sign-off.
export function renderEmail(
  settings: EmailSettingsValues,
  lead: EmailLeadInput,
  version: EmailVersion,
  opener: string,
): { subject: string; body: string } {
  const values = {
    clinic: lead.clinicName.trim(),
    opener: opener.trim(),
    contact: contactFor(lead),
  };
  const template = version === "owner" ? settings.ownerBodyTemplate : settings.frontDeskTemplate;
  const subject = version === "owner" ? settings.subjectTemplate : settings.frontDeskSubjectTemplate;
  return {
    subject: fill(subject, values).trim(),
    body: assemble(emailGreeting(lead, version), template, values, settings),
  };
}

// Follow-up n (1-based), in reply to the first email.
export function renderFollowUp(
  settings: EmailSettingsValues,
  lead: EmailLeadInput,
  version: EmailVersion,
  n: number,
  firstSubject: string,
): { subject: string; body: string } | null {
  const template = settings.followUpTemplates[n - 1];
  if (template === undefined) return null;
  const values = { clinic: lead.clinicName.trim(), opener: "", contact: contactFor(lead) };
  const subject = /^re:/i.test(firstSubject.trim()) ? firstSubject.trim() : `Re: ${firstSubject.trim()}`;
  return { subject, body: assemble(emailGreeting(lead, version), template, values, settings) };
}

// ─── The contact check ─────────────────────────────────────────────────────

export type ContactCheck =
  | { state: "confirmed"; scorecardName: string | null }
  | { state: "mismatch"; scorecardName: string; contactName: string | null };

// Whether the lead's contact is the person the scorecard cited as the
// decision-maker. Only a disagreement needs a decision: the same person (by
// surname, or by first name where a surname is missing on one side), or a
// scorecard that names nobody, is confirmed as it stands. A pick by hand
// (contactConfirmedAt) settles a disagreement.
export function contactCheck(lead: {
  contactName: string | null;
  icpBreakdown: string | null;
  contactConfirmedAt: Date | null;
}): ContactCheck {
  const cited = scorecardDecisionMaker(lead.icpBreakdown);
  if (!cited || lead.contactConfirmedAt) return { state: "confirmed", scorecardName: cited };
  const a = readDecisionMakerName(lead.contactName);
  const b = readDecisionMakerName(cited);
  if (!b) return { state: "confirmed", scorecardName: cited };
  if (a) {
    if (a.last && b.last && a.last === b.last) return { state: "confirmed", scorecardName: cited };
    if ((!a.last || !b.last) && a.first && b.first && a.first === b.first) return { state: "confirmed", scorecardName: cited };
  }
  return { state: "mismatch", scorecardName: cited, contactName: lead.contactName };
}

// ─── What the opener is written from ───────────────────────────────────────

// The scorecard's evidence for the opener prompt: every citation the scoring
// run made, quoted with its source, and every criterion it came up short on,
// in its own words. Nothing for a lead scored under the old model or not at
// all — the opener is then written from the enrichment alone.
export function scorecardEvidence(icpBreakdown: string | null): ScorecardEvidence {
  const b = leadBreakdownV2({ icpBreakdown });
  if (!b) return { cited: [], gaps: [] };
  const entries = [...b.fit, ...b.signals];
  return {
    cited: entries.flatMap((e) => e.citations.slice(0, 2).map((c) => `${e.label}: "${c.quote}" (${c.source})`)).slice(0, 12),
    gaps: entries.flatMap((e) => (e.shortfall ? [`${e.label}: ${e.shortfall}`] : [])).slice(0, 10),
  };
}

// ─── The suppression list ──────────────────────────────────────────────────

// What a suppression is matched on: the address, and the clinic's own website
// domain. Never a mailbox provider's domain — suppressing gmail.com would
// suppress every clinic on Gmail.
export function suppressionKeys(lead: { email: string | null; websiteUrl: string | null }): {
  email: string | null;
  domain: string | null;
} {
  const email = (lead.email ?? "").trim().toLowerCase() || null;
  return { email, domain: clinicDomain(lead.websiteUrl) };
}

// ─── Status, Ready, and follow-ups ─────────────────────────────────────────

export interface EmailWorkflowLead {
  email: string | null;
  emailStatus: string | null;
  emailApprovedAt: Date | null;
  emailRepliedAt: Date | null;
  emailUnsubscribedAt: Date | null;
  suppressedAt: Date | null;
  scoringRejectedAt: Date | null;
  contactName: string | null;
  icpBreakdown: string | null;
  contactConfirmedAt: Date | null;
}

export interface EmailSendView {
  step: number;
  sentAt: Date;
}

// The steps a lead has been sent, and the day the next follow-up is due —
// null when there is none to send: not started, replied, stopped, or past
// the last template.
export function nextFollowUp(
  sends: EmailSendView[],
  settings: Pick<EmailSettingsValues, "followUpDelayDays" | "followUpTemplates">,
): { n: number; dueAt: Date } | null {
  if (sends.length === 0) return null;
  const last = sends.reduce((a, b) => (b.step > a.step ? b : a));
  const n = last.step + 1;
  if (n > settings.followUpTemplates.length) return null;
  return { n, dueAt: new Date(last.sentAt.getTime() + settings.followUpDelayDays * 86_400_000) };
}

// Due today or earlier, counted in whole calendar days in the server's zone,
// so a follow-up whose three days run out at 4pm shows from the morning.
export function isDueBy(dueAt: Date, now: Date): boolean {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return dueAt.getTime() <= endOfToday.getTime();
}

export type EmailWorkflowStatus = EmailLeadStatus;

// Where a lead stands, by the first rule that applies. Ready only once every
// condition holds — A or B tier, the address checked valid, the email
// approved, the contact confirmed — and never for a lead that is suppressed,
// flagged by new scoring, disqualified, or already in sequence.
export function emailWorkflowStatus(
  lead: EmailWorkflowLead,
  tier: IcpTier | null,
  sends: EmailSendView[],
): EmailWorkflowStatus {
  if (lead.suppressedAt || lead.emailUnsubscribedAt) return "stopped";
  if (lead.emailRepliedAt) return "replied";
  if ((lead.email ?? "").trim() === "") return "no_email";
  if (sends.length > 0) return "in_sequence";
  if (lead.emailStatus !== "valid") return "check_email";
  if (contactCheck(lead).state === "mismatch") return "check_contact";
  if (!lead.emailApprovedAt) return "needs_opener";
  if (lead.scoringRejectedAt || (tier !== "A" && tier !== "B")) return "not_ab";
  return "ready";
}

// What blocks sending right now, in words, or null when the lead may be sent
// Email 1 (Ready) or its next follow-up (due). The server checks this before
// recording a send.
export function sendBlocker(
  lead: EmailWorkflowLead,
  tier: IcpTier | null,
  sends: EmailSendView[],
  settings: Pick<EmailSettingsValues, "followUpDelayDays" | "followUpTemplates">,
  now: Date,
): { step: number } | { blocked: string } {
  const status = emailWorkflowStatus(lead, tier, sends);
  if (status === "ready") return { step: 0 };
  if (status === "in_sequence") {
    const next = nextFollowUp(sends, settings);
    if (!next) return { blocked: "Every follow-up has been sent." };
    if (!isDueBy(next.dueAt, now)) return { blocked: `Follow-up ${next.n} is not due until ${next.dueAt.toDateString()}.` };
    return { step: next.n };
  }
  return { blocked: EMAIL_STATUS_BLOCKERS[status] };
}

const EMAIL_STATUS_BLOCKERS: Record<EmailWorkflowStatus, string> = {
  stopped: "This clinic is on the suppression list.",
  replied: "They replied — follow-ups have stopped.",
  no_email: "There is no email address.",
  in_sequence: "",
  check_email: "The address has not been checked valid.",
  check_contact: "The contact disagrees with the scorecard's decision-maker — pick one first.",
  needs_opener: "The email has not been approved.",
  not_ab: "Only A and B tier leads are sent to.",
  ready: "",
};

// ─── Results ───────────────────────────────────────────────────────────────

export const EMAIL_REPLY_TYPES = ["interested", "not_now", "not_interested"] as const;
export type EmailReplyType = (typeof EMAIL_REPLY_TYPES)[number];
export const EMAIL_REPLY_TYPE_LABELS: Record<EmailReplyType, string> = {
  interested: "Interested",
  not_now: "Not now",
  not_interested: "Not interested",
};
export function readEmailReplyType(v: unknown): EmailReplyType | null {
  return typeof v === "string" && (EMAIL_REPLY_TYPES as readonly string[]).includes(v) ? (v as EmailReplyType) : null;
}

export const SUPPRESSION_REASONS = ["not_interested", "unsubscribed"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];
export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  not_interested: "Not interested",
  unsubscribed: "Unsubscribed",
};

// ─── Sending ───────────────────────────────────────────────────────────────

// A Gmail compose window on the sending inbox's own account — authuser picks
// the signed-in account by address, rather than whichever is first in the
// browser — with the address, subject and body filled in.
export function gmailComposeUrl(from: string, to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ authuser: from, view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}

// What "Copy email" puts on the clipboard: the subject line, then the body.
export function copyText(subject: string, body: string): string {
  return `Subject: ${subject}\n\n${body}`;
}

// ─── The next email to send ────────────────────────────────────────────────

export interface EmailToSend {
  step: number;
  label: string;
  to: string;
  // The inbox it goes from: Gmail is opened on this account.
  inboxId: string;
  from: string;
  subject: string;
  body: string;
}

export interface EmailSendRecord extends EmailSendView {
  subject: string;
}

// The email to send right now: Email 1 as approved once the lead is Ready,
// or the next follow-up once it is due, drafted from its template in reply
// to Email 1 — from the lead's inbox, signed with that inbox's name. Null
// when there is nothing to send; { blocked } when there is, but it cannot go
// yet (no inbox, or nobody to sign it as).
export function emailToSend(
  lead: EmailWorkflowLead &
    EmailLeadInput & { emailType: string | null; emailVersion: string | null; emailSubject: string | null; emailBody: string | null },
  tier: IcpTier | null,
  sends: EmailSendRecord[],
  settings: EmailSettingsValues,
  now: Date,
  inbox: SendingInboxView | null,
): EmailToSend | { blocked: string } | null {
  const next = sendBlocker(lead, tier, sends, settings, now);
  if ("blocked" in next) return null;
  if (!inbox) return { blocked: "No sending inbox — add one in Settings → Email." };
  const sender = senderFor(inbox, settings);
  if (sender === "") return { blocked: `Nobody to sign it as: give ${inbox.address} a display name, or set Your name, in Settings → Email.` };
  const to = (lead.email ?? "").trim();
  const from = { inboxId: inbox.id, from: inbox.address };
  if (next.step === 0) {
    if (!lead.emailSubject || !lead.emailBody) return null;
    return { step: 0, label: "Email 1", to, ...from, subject: lead.emailSubject, body: fillSender(lead.emailBody, sender) };
  }
  const first = sends.find((s) => s.step === 0);
  const drafted = renderFollowUp(settings, lead, defaultEmailVersion(lead), next.step, first?.subject ?? lead.emailSubject ?? "");
  if (!drafted) return null;
  return { step: next.step, label: `Follow-up ${next.step}`, to, ...from, subject: drafted.subject, body: fillSender(drafted.body, sender) };
}

export function isEmailToSend(v: EmailToSend | { blocked: string } | null): v is EmailToSend {
  return v !== null && !("blocked" in v);
}

// ─── Sending inboxes ───────────────────────────────────────────────────────

export interface SendingInboxView {
  id: string;
  address: string;
  displayName: string;
  dailyLimit: number;
}

// Who an email from this inbox is signed as: its display name, or Settings'
// "Your name" where it has none.
export function senderFor(inbox: Pick<SendingInboxView, "displayName">, settings: Pick<EmailSettingsValues, "senderName">): string {
  return inbox.displayName.trim() || settings.senderName.trim();
}

export function fillSender(textIn: string, sender: string): string {
  return sender === "" ? textIn : textIn.split("{sender}").join(sender);
}

// The inbox a newly Ready lead is given: whichever has the fewest leads so
// far, the first in Settings order on a tie — so two inboxes alternate and
// stay balanced.
export function pickInbox<T extends { id: string }>(inboxes: T[], assigned: Record<string, number>): T | null {
  let best: T | null = null;
  for (const inbox of inboxes) {
    if (best === null || (assigned[inbox.id] ?? 0) < (assigned[best.id] ?? 0)) best = inbox;
  }
  return best;
}

// "hamdi@" for the counters and the rows.
export function inboxShort(address: string): string {
  const at = address.indexOf("@");
  return at === -1 ? address : address.slice(0, at + 1);
}

export function isInboxAddress(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// Where a lead is in its sequence, for the table: what went last and when,
// and what comes next.
export function sequenceLabel(
  sends: EmailSendView[],
  settings: Pick<EmailSettingsValues, "followUpDelayDays" | "followUpTemplates">,
  // Why the sequence is not running, where it is not: "replied", "stopped",
  // "no address".
  halted: string | null,
): string {
  if (sends.length === 0) return "Not started";
  const last = sends.reduce((a, b) => (b.step > a.step ? b : a));
  const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const sent = `${last.step === 0 ? "Email 1" : `Follow-up ${last.step}`} sent ${day(last.sentAt)}`;
  if (halted) return `${sent} · ${halted}`;
  const next = nextFollowUp(sends, settings);
  return next ? `${sent} · follow-up ${next.n} due ${day(next.dueAt)}` : `${sent} · last email`;
}

// ─── A clinic's contact form ───────────────────────────────────────────────

// "Mark form sent" books a call this many days later.
export const CONTACT_FORM_CALL_AFTER_DAYS = 3;

// What "Copy message" puts on the clipboard for a contact form: the
// front-desk email. The approved email when that is the front-desk version;
// otherwise built from the front-desk template, with the opener in it when
// one was approved and without one when not. Signed as sender.
export function frontDeskMessage(
  lead: EmailLeadInput & {
    emailVersion: string | null;
    emailSubject: string | null;
    emailBody: string | null;
    emailOpener: string | null;
    emailApprovedAt: Date | null;
  },
  settings: EmailSettingsValues,
  sender: string,
): { subject: string; body: string } {
  if (lead.emailApprovedAt && readEmailVersion(lead.emailVersion) === "front_desk" && lead.emailSubject && lead.emailBody) {
    return { subject: lead.emailSubject, body: fillSender(lead.emailBody, sender) };
  }
  const opener = lead.emailApprovedAt ? (lead.emailOpener ?? "") : "";
  const built = renderEmail(settings, lead, "front_desk", opener);
  return { subject: built.subject, body: fillSender(built.body, sender) };
}
