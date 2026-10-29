"use server";

// Cold email, sent by hand from Gmail — the reads and writes.
//
// Every rule lives in src/lib/emailWorkflow.ts; this file loads a lead, asks
// those rules, and writes what they allow. Nothing here sends an email: Gmail
// does that, by hand, and "Mark sent" records it. Each send is checked against
// the rules again on the server, because a button on a page that has sat open
// for an hour is a courtesy and not a guarantee.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deepSeekJson } from "@/lib/deepseek";
import { loadActiveIcp } from "@/lib/icpDefinitionStore";
import { hasAssistEvidence } from "@/lib/icpAssist";
import { leadTier } from "@/lib/leadScore";
import { EmailCandidate, parseAlternates, scorecardDecisionMaker } from "@/lib/emailFind";
import {
  EMAIL_OPENER_MAX_CHARS,
  SEQUENCE_MAX_TOKENS,
  SequenceContext,
  assumptionReason,
  buildEmailOpenerPrompt,
  buildFirstMessageFallbackPrompt,
  emailCuriosityPainSignalLine,
  emailCuriosityProcessLine,
  formatInternalNote,
  gapAsStatementReason,
  inventedStatsReason,
  parseEmailOpenerReply,
  parseFirstMessageFallbackReply,
} from "@/lib/outreachSequence";
import {
  EMAIL_REPLY_TYPE_LABELS,
  EmailVersion,
  EmailSettingsValues,
  MAX_FOLLOW_UPS,
  MAX_TEMPLATE_CHARS,
  contactCheck,
  defaultEmailVersion,
  readCheckResults,
  readEmailReplyType,
  readEmailSettings,
  readEmailVersion,
  renderEmail,
  scorecardEvidence,
  sendBlocker,
  unfilledPlaceholders,
} from "@/lib/emailWorkflow";
import { loadEmailSettings, saveEmailSettingsRow } from "@/lib/emailSettingsStore";
import { findSuppression, suppressLead, suppressedMessage } from "@/lib/suppression";

type Result = { ok: true } | { ok: false; error: string };

function revalidate(leadId: string): void {
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${leadId}`);
}

// ─── Settings ──────────────────────────────────────────────────────────────

export async function saveEmailSettings(raw: unknown): Promise<Result> {
  const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const followUps = Array.isArray(r.followUpTemplates) ? r.followUpTemplates : [];
  if (followUps.length > MAX_FOLLOW_UPS) return { ok: false, error: `At most ${MAX_FOLLOW_UPS} follow-ups.` };
  for (const key of ["subjectTemplate", "frontDeskSubjectTemplate", "ownerBodyTemplate", "frontDeskTemplate", "optOutLine", "signOff"]) {
    const v = r[key];
    if (typeof v !== "string" || v.trim() === "") return { ok: false, error: "Every template needs some text." };
    if (v.length > MAX_TEMPLATE_CHARS) return { ok: false, error: `A template is longer than ${MAX_TEMPLATE_CHARS} characters.` };
  }
  if (!String(r.ownerBodyTemplate).includes("{opener}") || !String(r.frontDeskTemplate).includes("{opener}")) {
    return { ok: false, error: "Both email templates need {opener} somewhere, or the opener is never used." };
  }
  const settings: EmailSettingsValues = readEmailSettings({ ...r, followUpTemplates: followUps });
  await saveEmailSettingsRow(settings);
  revalidatePath("/settings/email");
  revalidatePath("/pipeline");
  return { ok: true };
}

// ─── Drafting ──────────────────────────────────────────────────────────────

async function loadLead(leadId: string) {
  return prisma.lead.findUnique({ where: { id: leadId }, include: { emailSends: { orderBy: { step: "asc" } } } });
}

export type OpenerResult =
  | { ok: true; mechanism: string }
  | { ok: false; error: string };

// Drafts the opener and builds the whole email around it from the template
// for this lead's version. Regenerating is pressing it again: a new opener,
// a fresh email, and the approval cleared.
export async function generateEmailOpener(leadId: string): Promise<OpenerResult> {
  const lead = await loadLead(leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const suppressed = await findSuppression({ leadId, email: lead.email, websiteUrl: lead.websiteUrl });
  if (suppressed) return { ok: false, error: suppressedMessage(suppressed) };
  if (lead.emailSends.length > 0) return { ok: false, error: "Email 1 has already been sent — the opener is part of the record now." };
  if (!hasAssistEvidence(lead) && !lead.icpBreakdown) {
    return { ok: false, error: "There is nothing to write from yet. Enrich the lead or score it first." };
  }

  const ctx: SequenceContext = {
    evidence: {
      clinicName: lead.clinicName,
      websiteNotes: lead.websiteNotes,
      metaAdsSignal: lead.metaAdsSignal,
      reviewCount: lead.reviewCount,
    },
    contactName: lead.contactName,
    contactTitle: lead.contactTitle,
    loomUrl: null,
    replyText: null,
    priorMessages: [],
    icpPainPoints: (await loadActiveIcp())?.painPoints ?? null,
  };
  const scorecard = scorecardEvidence(lead.icpBreakdown);
  const { system, user } = buildEmailOpenerPrompt(ctx, scorecard);

  // The made-up-stats check, the gap rule and the no-bridging rule, after
  // the model has written it; a line that fails any is asked for once more,
  // then given up on.
  const screen = (opener: string, basis: "cited" | "gap" | null) =>
    inventedStatsReason(opener, ctx.evidence) ?? gapAsStatementReason(opener, basis) ?? assumptionReason(opener);

  let opener: string | null = null;
  let note: string | null = null;
  let rejected: string | null = null;
  for (let attempt = 0; attempt < 2 && opener === null; attempt++) {
    const reply = await deepSeekJson({ system, user, maxTokens: SEQUENCE_MAX_TOKENS });
    if (!reply.ok) return { ok: false, error: reply.error };
    const parsed = parseEmailOpenerReply(reply.content);
    if (!parsed) return { ok: false, error: "DeepSeek answered, but not in a shape that reads as an opener. Nothing was saved — try again." };
    if (parsed.opener === null) break; // nothing true to say: the fallback below
    const why = screen(parsed.opener, parsed.basis);
    if (why) {
      rejected = why;
      continue;
    }
    opener = parsed.opener;
    note = formatInternalNote(parsed.note);
  }
  if (opener === null && rejected !== null) {
    return { ok: false, error: `Couldn't write a clean opener: ${rejected}, twice. Nothing was saved.` };
  }

  let mechanism = "observation";
  if (opener === null) {
    // The curiosity fallback, as Step 2 has it: one true detail to anchor a
    // question on, or a soft signal pointing at no-shows.
    const fb = buildFirstMessageFallbackPrompt(ctx);
    const reply = await deepSeekJson({ system: fb.system, user: fb.user, maxTokens: SEQUENCE_MAX_TOKENS });
    if (!reply.ok) return { ok: false, error: reply.error };
    const parsed = parseFirstMessageFallbackReply(reply.content);
    if (!parsed) return { ok: false, error: "DeepSeek answered the fallback, but not in a shape that can be read. Nothing was saved." };
    const line = parsed.painSignal
      ? emailCuriosityPainSignalLine(lead.clinicName)
      : parsed.detail
        ? emailCuriosityProcessLine(parsed.detail)
        : null;
    if (!line || screen(line, "gap")) {
      return {
        ok: false,
        error: `The evidence carries nothing true and specific enough to open with${parsed.detailRejected ? ` (${parsed.detailRejected})` : ""}. Nothing was saved — enrich the lead, or write the opener by hand.`,
      };
    }
    opener = line;
    note = formatInternalNote(parsed.note);
    mechanism = parsed.painSignal ? "curiosity_pain_signal" : "curiosity_process";
  }

  if (opener.length > EMAIL_OPENER_MAX_CHARS) return { ok: false, error: "The opener came back too long. Try again." };
  const version = defaultEmailVersion(lead);
  const email = renderEmail(await loadEmailSettings(), lead, version, opener);
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      emailOpener: opener,
      emailOpenerNote: note,
      emailOpenerMechanism: mechanism,
      emailVersion: version,
      emailSubject: email.subject,
      emailBody: email.body,
      emailApprovedAt: null,
    },
  });
  revalidate(leadId);
  return { ok: true, mechanism };
}

// Switches between the owner-direct and front-desk templates: the email is
// rebuilt around the same opener, and has to be approved again.
export async function setEmailVersion(leadId: string, version: string): Promise<Result> {
  const v: EmailVersion | null = readEmailVersion(version);
  if (!v) return { ok: false, error: "Not a version." };
  const lead = await loadLead(leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (lead.emailSends.length > 0) return { ok: false, error: "Email 1 has already been sent." };
  const email = lead.emailOpener ? renderEmail(await loadEmailSettings(), lead, v, lead.emailOpener) : null;
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      emailVersion: v,
      emailApprovedAt: null,
      ...(email ? { emailSubject: email.subject, emailBody: email.body } : {}),
    },
  });
  revalidate(leadId);
  return { ok: true };
}

// The email as edited by hand. An edit is a new email, so any approval goes.
export async function saveEmailDraft(leadId: string, draft: { subject: string; body: string }): Promise<Result> {
  const subject = typeof draft?.subject === "string" ? draft.subject.trim() : "";
  const body = typeof draft?.body === "string" ? draft.body.replace(/\r\n/g, "\n").trim() : "";
  if (subject === "" || body === "") return { ok: false, error: "The email needs a subject and a body." };
  if (subject.length > 300 || body.length > 8000) return { ok: false, error: "That email is too long." };
  const lead = await loadLead(leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (lead.emailSends.length > 0) return { ok: false, error: "Email 1 has already been sent." };
  await prisma.lead.update({ where: { id: leadId }, data: { emailSubject: subject, emailBody: body, emailApprovedAt: null } });
  revalidate(leadId);
  return { ok: true };
}

export async function approveEmail(leadId: string): Promise<Result> {
  const lead = await loadLead(leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (!lead.emailSubject || !lead.emailBody) return { ok: false, error: "There is no email to approve yet — draft the opener first." };
  const left = unfilledPlaceholders(`${lead.emailSubject}\n${lead.emailBody}`);
  if (left.length > 0) return { ok: false, error: `The email still has ${left.join(", ")} in it.` };
  await prisma.lead.update({ where: { id: leadId }, data: { emailApprovedAt: new Date() } });
  revalidate(leadId);
  return { ok: true };
}

export async function unapproveEmail(leadId: string): Promise<Result> {
  await prisma.lead.update({ where: { id: leadId }, data: { emailApprovedAt: null } });
  revalidate(leadId);
  return { ok: true };
}

// ─── The contact check ─────────────────────────────────────────────────────

// The contact disagreed with the scorecard's decision-maker: take the
// scorecard's person, or keep the one on the lead. Either way it is settled.
export async function resolveContact(leadId: string, choice: string): Promise<Result> {
  const lead = await loadLead(leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const check = contactCheck(lead);
  const now = new Date();
  if (choice === "scorecard") {
    const cited = scorecardDecisionMaker(lead.icpBreakdown);
    if (!cited) return { ok: false, error: "The scorecard names nobody." };
    const settings = await loadEmailSettings();
    const updated = { ...lead, contactName: cited };
    // The greeting is built from the contact, so the email is rebuilt.
    const email =
      lead.emailOpener && lead.emailSends.length === 0
        ? renderEmail(settings, updated, defaultEmailVersion(lead), lead.emailOpener)
        : null;
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        contactName: cited,
        contactConfirmedAt: now,
        ...(email ? { emailSubject: email.subject, emailBody: email.body, emailApprovedAt: null } : {}),
      },
    });
  } else if (choice === "keep") {
    if (check.state !== "mismatch") return { ok: false, error: "There is nothing to settle." };
    await prisma.lead.update({ where: { id: leadId }, data: { contactConfirmedAt: now } });
  } else {
    return { ok: false, error: "Pick the scorecard's person or keep the contact." };
  }
  revalidate(leadId);
  return { ok: true };
}

// ─── Checking addresses, by file ───────────────────────────────────────────

export interface CheckImportSummary {
  updated: number;
  valid: number;
  risky: number;
  unknown: number;
  invalid: number;
  unmatched: string[];
  unreadable: number;
}

// The checker's results back onto the leads. Matched by lead and address
// where the export's lead_id survived, by address alone where it did not —
// and only ever onto the lead's current address: a result for an address the
// lead no longer has is about somebody else's record now.
//
// Invalid: the address moves to the alternates, marked invalid, and the lead
// has no email again.
export async function importCheckResults(
  fileText: string,
): Promise<{ ok: true; summary: CheckImportSummary } | { ok: false; error: string }> {
  if (typeof fileText !== "string" || fileText.trim() === "") return { ok: false, error: "That file is empty." };
  if (fileText.length > 5_000_000) return { ok: false, error: "That file is too large." };
  const read = readCheckResults(fileText);
  if (read.error) return { ok: false, error: read.error };

  const summary: CheckImportSummary = { updated: 0, valid: 0, risky: 0, unknown: 0, invalid: 0, unmatched: [], unreadable: read.unreadable };
  const now = new Date();
  for (const row of read.rows) {
    const leads = await prisma.lead.findMany({
      where: { email: row.email, ...(row.leadId ? { id: row.leadId } : {}) },
      select: { id: true, email: true, emailType: true, emailSource: true, emailAlternates: true },
    });
    // A lead_id the address does not match is a stale file; the address alone
    // still names the lead.
    const targets = leads.length > 0 || !row.leadId
      ? leads
      : await prisma.lead.findMany({
          where: { email: row.email },
          select: { id: true, email: true, emailType: true, emailSource: true, emailAlternates: true },
        });
    if (targets.length === 0) {
      summary.unmatched.push(row.email);
      continue;
    }
    for (const lead of targets) {
      if (row.status === "invalid") {
        const alternates: EmailCandidate[] = [
          ...parseAlternates(lead.emailAlternates).filter((a) => a.address !== row.email),
          {
            address: row.email,
            type: lead.emailType === "owner" ? "owner" : "generic",
            status: "invalid",
            source: lead.emailSource === "maps_contacts" ? "maps_contacts" : "imported",
          },
        ];
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            email: null,
            emailType: null,
            emailStatus: null,
            emailSource: null,
            emailCheckedAt: now,
            emailAlternates: JSON.stringify(alternates),
            emailApprovedAt: null,
          },
        });
      } else {
        await prisma.lead.update({ where: { id: lead.id }, data: { emailStatus: row.status, emailCheckedAt: now } });
      }
      summary.updated++;
      summary[row.status]++;
    }
  }
  revalidatePath("/pipeline");
  return { ok: true, summary };
}

// ─── Sending, by hand ──────────────────────────────────────────────────────

export type MarkSentResult =
  | { ok: true; step: number; sentToday: number; dailyLimit: number }
  | { ok: false; error: string };

// Records that the email Gmail just sent went: Email 1, or the follow-up that
// was due. What was sent is stored as it was shown, so the record holds what
// actually went out. Over the daily limit is allowed — the page asked first —
// and the count comes back so it can say so.
export async function markEmailSent(
  leadId: string,
  sent: { step: number; subject: string; body: string },
): Promise<MarkSentResult> {
  const lead = await loadLead(leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const suppressed = await findSuppression({ leadId, email: lead.email, websiteUrl: lead.websiteUrl });
  if (suppressed) return { ok: false, error: suppressedMessage(suppressed) };
  const settings = await loadEmailSettings();
  const now = new Date();
  const next = sendBlocker(lead, leadTier(lead), lead.emailSends, settings, now);
  if ("blocked" in next) return { ok: false, error: next.blocked };
  if (sent?.step !== next.step) return { ok: false, error: "The page was out of date — reload it and send again." };
  const subject = typeof sent.subject === "string" ? sent.subject.slice(0, 300) : "";
  const body = typeof sent.body === "string" ? sent.body.slice(0, 8000) : "";

  await prisma.emailSend.create({
    data: { leadId, step: next.step, toEmail: (lead.email ?? "").trim(), subject, body, sentAt: now },
  });
  const sentToday = await countSentToday(now);
  revalidate(leadId);
  return { ok: true, step: next.step, sentToday, dailyLimit: settings.dailyLimit };
}

export async function countSentToday(now = new Date()): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return prisma.emailSend.count({ where: { sentAt: { gte: start } } });
}

// ─── Results ───────────────────────────────────────────────────────────────

// A reply, pasted in with its type. Follow-ups stop and a task is made to
// answer it; "not interested" also puts the clinic on the suppression list.
export async function markEmailReplied(leadId: string, reply: { text: string; type: string }): Promise<Result> {
  const type = readEmailReplyType(reply?.type);
  if (!type) return { ok: false, error: "Pick what kind of reply it was." };
  const textIn = typeof reply?.text === "string" ? reply.text.trim().slice(0, 8000) : "";
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: { emailRepliedAt: now, emailReplyText: textIn || null, emailReplyType: type },
    });
    await tx.task.create({
      data: {
        title: `Reply to ${lead.clinicName} (${EMAIL_REPLY_TYPE_LABELS[type].toLowerCase()})`,
        description: textIn ? `They wrote:\n\n${textIn}` : null,
        dueDate: today,
        leadId,
      },
    });
    if (type === "not_interested" && !lead.suppressedAt) await suppressLead(tx, lead, "not_interested", now);
  });
  revalidate(leadId);
  revalidatePath("/tasks");
  return { ok: true };
}

// A bounce is about the address, not the clinic: it moves to the alternates
// as invalid and the lead goes back to No email. The clinic is not suppressed.
export async function markEmailBounced(leadId: string): Promise<Result> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const address = (lead.email ?? "").trim().toLowerCase();
  if (address === "") return { ok: false, error: "There is no address to mark bounced." };
  const alternates: EmailCandidate[] = [
    ...parseAlternates(lead.emailAlternates).filter((a) => a.address !== address),
    {
      address,
      type: lead.emailType === "owner" ? "owner" : "generic",
      status: "invalid",
      source: lead.emailSource === "maps_contacts" ? "maps_contacts" : "imported",
    },
  ];
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      email: null,
      emailType: null,
      emailStatus: null,
      emailSource: null,
      emailCheckedAt: new Date(),
      emailAlternates: JSON.stringify(alternates),
    },
  });
  revalidate(leadId);
  return { ok: true };
}

// They asked not to be emailed: the clinic goes on the suppression list.
export async function markEmailUnsubscribed(leadId: string): Promise<Result> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { emailUnsubscribedAt: now } });
    if (!lead.suppressedAt) await suppressLead(tx, lead, "unsubscribed", now);
  });
  revalidate(leadId);
  return { ok: true };
}
