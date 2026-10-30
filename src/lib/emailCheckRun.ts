// Checking one lead's address through Instantly, and what the result does to
// the lead. Server-only; the job that runs it for many is in
// src/lib/actions/jobs.ts.
//
//   Each address is checked once. A lead whose current address already has a
//   status is skipped unless the check is forced ("Check again").
//   valid / risky / unknown set the status. invalid moves the address to the
//   alternates and the lead goes back to No email — except an address typed
//   in by hand, which is marked invalid and left where it is: the app never
//   replaces an email you entered.
//   Every check is logged with what it cost (EmailCheck), and the cost per
//   check in Settings is corrected from credits_used.

import { prisma } from "@/lib/prisma";
import { PIPELINE_DEFAULT_WHERE } from "@/lib/liveLeadWhere";
import { EmailCandidate, parseAlternates, readEmailSource } from "@/lib/emailFind";
import { budgetFor, mapVerification, monthStart } from "@/lib/emailCheck";
import { verifyEmail, InstantlyErrorCode } from "@/lib/instantly";
import { loadEmailSettings, saveEmailSettingsRow } from "@/lib/emailSettingsStore";
import { getInstantlyApiKey } from "@/lib/appSecretsStore";

export async function creditsUsedThisMonth(now = new Date()): Promise<number> {
  const r = await prisma.emailCheck.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { creditsUsed: true } });
  return r._sum.creditsUsed ?? 0;
}

// Email-channel leads whose current address has never been checked.
export async function uncheckedEmailLeads(): Promise<{ id: string; clinicName: string }[]> {
  return prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, channel: "email", email: { not: null }, NOT: { email: "" }, emailStatus: null, suppressedAt: null },
    select: { id: true, clinicName: true },
    orderBy: { updatedAt: "asc" },
  });
}

export type CheckOutcome =
  | { kind: "checked"; status: string; email: string; detail: string }
  | { kind: "skipped"; detail: string }
  | { kind: "failed"; detail: string; code: InstantlyErrorCode };

export async function checkLeadEmail(leadId: string, opts: { force?: boolean } = {}): Promise<CheckOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { kind: "skipped", detail: "No longer here." };
  const email = (lead.email ?? "").trim().toLowerCase();
  if (email === "") return { kind: "skipped", detail: "No email to check." };
  if (lead.emailStatus !== null && !opts.force) return { kind: "skipped", detail: `Already checked (${lead.emailStatus}) — use Check again.` };

  const r = await verifyEmail(email);
  if (!r.ok) return { kind: "failed", detail: r.error, code: r.code };

  const status = mapVerification(r);
  const now = new Date();
  const settings = await loadEmailSettings();
  const credits = r.creditsUsed ?? settings.creditsPerCheck;
  await prisma.emailCheck.create({
    data: { leadId, email, rawStatus: r.verificationStatus, catchAll: r.catchAll === null ? null : String(r.catchAll), status, creditsUsed: credits },
  });
  // The cost per check, learnt from what Instantly reports.
  if (r.creditsUsed !== null && r.creditsUsed > 0 && r.creditsUsed !== settings.creditsPerCheck) {
    await saveEmailSettingsRow({ ...settings, creditsPerCheck: r.creditsUsed });
  }

  // The address may have changed while the check ran; the result is about
  // the address that was checked, so it only lands if that is still the one.
  const current = await prisma.lead.findUnique({ where: { id: leadId }, select: { email: true } });
  if ((current?.email ?? "").trim().toLowerCase() !== email) {
    return { kind: "skipped", detail: "The address changed while it was being checked — nothing written." };
  }

  if (status === "invalid" && lead.emailSource !== "manual") {
    const alternates: EmailCandidate[] = [
      ...parseAlternates(lead.emailAlternates).filter((a) => a.address !== email),
      {
        address: email,
        type: lead.emailType === "owner" ? "owner" : "generic",
        status: "invalid",
        // Where it came from, kept: an address off a Facebook page stays one.
        source: readEmailSource(lead.emailSource) ?? "imported",
      },
    ];
    await prisma.lead.update({
      where: { id: leadId },
      data: { email: null, emailType: null, emailStatus: null, emailSource: null, emailCheckedAt: now, emailAlternates: JSON.stringify(alternates), emailApprovedAt: null },
    });
    return { kind: "checked", status, email, detail: `${email} is invalid — moved to alternates; back to No email.` };
  }
  await prisma.lead.update({ where: { id: leadId }, data: { emailStatus: status, emailCheckedAt: now } });
  const note = status === "invalid" ? " (entered by hand, so it stays)" : r.verificationStatus === "pending" ? " (still pending at Instantly)" : "";
  return { kind: "checked", status, email, detail: `${email}: ${status}${note}` };
}

// Whether checks can run at all, and how many of n fit this month's budget.
export async function checkReadiness(n: number, now = new Date()) {
  const [key, settings, used] = await Promise.all([getInstantlyApiKey(), loadEmailSettings(), creditsUsedThisMonth(now)]);
  return { hasKey: key !== null, settings, used, ...budgetFor(n, used, settings.checkCreditBudget, settings.creditsPerCheck) };
}
