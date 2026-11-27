// Checking an address through Instantly — what the contact finder
// (src/lib/contactFinderRun.ts) calls for every new address — and this
// month's credits. Server-only.
//
//   Every check is logged with what it cost (EmailCheck), and the cost per
//   check in Settings is corrected from credits_used.

import { prisma } from "@/lib/prisma";
import { EmailStatus } from "@/lib/emailFind";
import { budgetFor, mapVerification, monthStart } from "@/lib/emailCheck";
import { verifyEmail, InstantlyErrorCode } from "@/lib/instantly";
import { loadEmailSettings, saveEmailSettingsRow } from "@/lib/emailSettingsStore";
import { getInstantlyApiKey } from "@/lib/appSecretsStore";

export async function creditsUsedThisMonth(now = new Date()): Promise<number> {
  const r = await prisma.emailCheck.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { creditsUsed: true } });
  return r._sum.creditsUsed ?? 0;
}

// One address through Instantly, logged with what it cost (EmailCheck) — the
// check every address gets, whether or not it is the lead's email yet. 
export async function checkAddress(
  leadId: string | null,
  emailIn: string,
): Promise<{ ok: true; status: EmailStatus; rawStatus: string; catchAll: boolean | "pending" | null; credits: number } | { ok: false; error: string; code: InstantlyErrorCode }> {
  const email = emailIn.trim().toLowerCase();
  const r = await verifyEmail(email);
  if (!r.ok) return r;
  const status = mapVerification(r);
  const settings = await loadEmailSettings();
  const credits = r.creditsUsed ?? settings.creditsPerCheck;
  await prisma.emailCheck.create({
    data: { leadId, email, rawStatus: r.verificationStatus, catchAll: r.catchAll === null ? null : String(r.catchAll), status, creditsUsed: credits },
  });
  // The cost per check, learnt from what Instantly reports.
  if (r.creditsUsed !== null && r.creditsUsed > 0 && r.creditsUsed !== settings.creditsPerCheck) {
    await saveEmailSettingsRow({ ...settings, creditsPerCheck: r.creditsUsed });
  }
  return { ok: true, status, rawStatus: r.verificationStatus, catchAll: r.catchAll, credits };
}

// Whether checks can run at all, and how many of n fit this month's budget.
export async function checkReadiness(n: number, now = new Date()) {
  const [key, settings, used] = await Promise.all([getInstantlyApiKey(), loadEmailSettings(), creditsUsedThisMonth(now)]);
  return { hasKey: key !== null, settings, used, ...budgetFor(n, used, settings.checkCreditBudget, settings.creditsPerCheck) };
}
