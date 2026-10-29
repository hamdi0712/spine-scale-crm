// Instantly's API — email verification, and nothing else.
//
// Server-only. The key is read on every call (Settings → API Keys, then
// INSTANTLY_API_KEY) and sent as a bearer header; it never reaches the
// browser. This client has exactly two calls, both on the email-verification
// endpoint: there is no way through it to a campaign, a lead list, a lead or
// a send, and that is on purpose — nothing is ever sent through Instantly.

import { getInstantlyApiKey } from "@/lib/appSecretsStore";
import { InstantlyVerification } from "@/lib/emailCheck";

// Overridable only so tools/verify-instantly.ts can point it at the mock.
const API_BASE = process.env.INSTANTLY_API_BASE || "https://api.instantly.ai";
// Instantly answers within ten seconds or says "pending"; a pending check is
// asked after every few seconds, for up to this long, and then reported as
// still pending (it is recorded as unknown, and can be checked again).
const POLL_MS = Number(process.env.INSTANTLY_POLL_MS) || 5_000;
const MAX_WAIT_MS = Number(process.env.INSTANTLY_MAX_WAIT_MS) || 3 * 60_000;

export type InstantlyErrorCode = "no_key" | "auth" | "plan" | "rate_limit" | "network" | "other";

export type VerifyResult =
  | ({ ok: true } & InstantlyVerification)
  | { ok: false; error: string; code: InstantlyErrorCode };

// The errors a person can do something about, in words. 401 and 403 are the
// key (missing, revoked, or without the email_verifications scope); 402 is a
// workspace without a paid plan — the "plan does not allow API access" case.
function errorFor(status: number, message: string): { error: string; code: InstantlyErrorCode } {
  const said = message ? ` Instantly said: ${message}` : "";
  if (status === 401 || status === 403) {
    return {
      error: `Instantly refused the API key — it may be wrong, revoked, or missing the email_verifications scope. Check it under Settings → API Keys.${said}`,
      code: "auth",
    };
  }
  if (status === 402) {
    return {
      error: `Your Instantly plan doesn't allow API access (the workspace has no active paid plan), so emails can't be checked through it.${said}`,
      code: "plan",
    };
  }
  if (status === 429) return { error: `Instantly's rate limit was hit — try again in a minute.${said}`, code: "rate_limit" };
  return { error: `Instantly answered HTTP ${status}.${said}`, code: "other" };
}

function readVerification(body: unknown): InstantlyVerification | null {
  if (body === null || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (typeof o.verification_status !== "string") return null;
  const catchAll = o.catch_all === true || o.catch_all === "true" ? true : o.catch_all === false || o.catch_all === "false" ? false : o.catch_all === "pending" ? "pending" : null;
  return {
    verificationStatus: o.verification_status,
    catchAll,
    creditsUsed: typeof o.credits_used === "number" ? o.credits_used : null,
    creditsLeft: typeof o.credits === "number" ? o.credits : null,
  };
}

async function call(key: string, method: "POST" | "GET", path: string, body?: unknown): Promise<VerifyResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, error: "Could not reach Instantly. Check the server's network connection and try again.", code: "network" };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json && typeof json === "object" && typeof (json as { message?: unknown }).message === "string" ? (json as { message: string }).message : "";
    return { ok: false, ...errorFor(response.status, message) };
  }
  const v = readVerification(json);
  return v ? { ok: true, ...v } : { ok: false, error: "Instantly answered, but not with a verification result.", code: "other" };
}

// Checks one address: asks for the verification, then, while Instantly says
// it is pending, asks after it until it is not or the wait runs out. Credits
// are counted from the first answer that reports them.
export async function verifyEmail(email: string): Promise<VerifyResult> {
  const key = await getInstantlyApiKey();
  if (!key) return { ok: false, error: "No Instantly API key — add one under Settings → API Keys.", code: "no_key" };

  const first = await call(key, "POST", "/api/v2/email-verification", { email });
  if (!first.ok) return first;
  let latest = first;
  const creditsUsed = first.creditsUsed;
  const giveUpAt = Date.now() + MAX_WAIT_MS;
  while ((latest.verificationStatus === "pending" || latest.catchAll === "pending") && Date.now() < giveUpAt) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const next = await call(key, "GET", `/api/v2/email-verification/${encodeURIComponent(email)}`);
    if (!next.ok) {
      if (next.code === "network" || next.code === "rate_limit") continue;
      return next;
    }
    latest = next;
  }
  return { ...latest, creditsUsed: creditsUsed ?? latest.creditsUsed };
}
