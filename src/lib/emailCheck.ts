// Checking addresses through Instantly's email-verification endpoint — the
// rules. Pure; the client is src/lib/instantly.ts and the run is
// src/lib/emailCheckRun.ts.
//
// Confirmed against Instantly's API v2 reference: POST
// /api/v2/email-verification { email } answers within ten seconds or says
// "pending", and GET /api/v2/email-verification/{email} is polled until it
// does not. verification_status is pending | verified | invalid; catch_all is
// true | false | "pending"; credits_used is what the check cost. The cost of
// one check is not published there, so it is a setting that starts at 1 and
// is corrected from credits_used on every real check.

import { EmailStatus } from "@/lib/emailFind";

export const DEFAULT_CHECK_CREDIT_BUDGET = 150;
export const DEFAULT_CREDITS_PER_CHECK = 1;

export interface InstantlyVerification {
  verificationStatus: string;
  catchAll: boolean | "pending" | null;
  creditsUsed: number | null;
  creditsLeft: number | null;
}

// Instantly's answer as one of the four statuses here.
//   verified, not catch-all  → valid
//   verified, catch-all      → risky (the domain accepts everything, so the
//                              mailbox itself is not proven)
//   invalid                  → invalid
//   still pending, or a word this does not know → unknown
export function mapVerification(v: Pick<InstantlyVerification, "verificationStatus" | "catchAll">): EmailStatus {
  const s = v.verificationStatus.trim().toLowerCase();
  if (s === "invalid") return "invalid";
  if (s === "verified") return v.catchAll === true ? "risky" : v.catchAll === "pending" ? "unknown" : "valid";
  return "unknown";
}

export function monthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Whether a job of n checks fits what is left of this month's budget, and
// how many would.
export function budgetFor(
  n: number,
  usedThisMonth: number,
  budget: number,
  perCheck: number,
): { fits: boolean; affordable: number; needed: number; left: number } {
  const per = perCheck > 0 ? perCheck : DEFAULT_CREDITS_PER_CHECK;
  const left = Math.max(0, budget - usedThisMonth);
  const needed = round(n * per);
  return { fits: needed <= left, affordable: Math.floor(left / per + 1e-9), needed, left: round(left) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "");
}
