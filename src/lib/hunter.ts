// Hunter's API — Email Finder and Domain Search, and nothing else.
//
// Server-only. The key is read on every call (Settings → API Keys, then
// HUNTER_API_KEY) and sent in the X-API-KEY header, never to the browser.
// Confirmed against hunter.io/api-documentation/v2 and its test key:
//
//   GET https://api.hunter.io/v2/email-finder?domain&first_name&last_name
//     data.email (null when none), data.score, data.accept_all,
//     data.provenance found | inferred (more may come), data.verification
//     .status valid | accept_all | unknown. No email found: no credit.
//   GET https://api.hunter.io/v2/domain-search?domain&limit
//     data.pattern ("{first}", "{first}.{last}", … or null), data.accept_all,
//     data.webmail, data.emails[]. limit + offset may not pass 10 on Free.
//
//   Both send X-Credits-Used (0 for a free repeat in the same period) — what
//   is logged. A search costs 1 credit where the account has one pool.
//   401 is the key; 403 the rate limit (15/s, 500/min); 429 the usage limit
//   (credits used up); 451 a person who asked not to be processed.

import { getHunterApiKey } from "@/lib/appSecretsStore";

const API_BASE = process.env.HUNTER_API_BASE || "https://api.hunter.io";

export type HunterErrorCode = "no_key" | "auth" | "rate_limit" | "quota" | "claimed" | "network" | "other";
type Fail = { ok: false; error: string; code: HunterErrorCode };

export type FinderResult =
  | {
      ok: true;
      email: string | null;
      score: number | null;
      acceptAll: boolean | null;
      // found: seen on a public page. inferred: built from the name and the
      // domain's pattern. Anything else Hunter adds later reads as inferred.
      provenance: "found" | "inferred";
      verification: string | null;
      creditsUsed: number;
    }
  | Fail;

export type DomainSearchResult =
  | { ok: true; pattern: string | null; acceptAll: boolean | null; webmail: boolean | null; creditsUsed: number }
  | Fail;

function errorFor(status: number, details: string): Fail {
  const said = details ? ` Hunter said: ${details}` : "";
  if (status === 401) return { ok: false, error: `Hunter refused the API key — check it under Settings → API Keys.${said}`, code: "auth" };
  if (status === 403) return { ok: false, error: `Hunter's rate limit was hit — try again in a minute.${said}`, code: "rate_limit" };
  if (status === 429) return { ok: false, error: `Hunter says this account's credits are used up for the period.${said}`, code: "quota" };
  if (status === 451) return { ok: false, error: `This person asked Hunter not to process their data, so nothing is looked up for them.${said}`, code: "claimed" };
  return { ok: false, error: `Hunter answered HTTP ${status}.${said}`, code: "other" };
}

async function get(path: string, params: Record<string, string>, freeWhen: (data: Record<string, unknown>) => boolean) {
  const key = await getHunterApiKey();
  if (!key) return { ok: false as const, error: "No Hunter API key — add one under Settings → API Keys.", code: "no_key" as const };
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}?${new URLSearchParams(params).toString()}`, {
      headers: { "X-API-KEY": key },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false as const, error: "Could not reach Hunter. Check the server's network connection and try again.", code: "network" as const };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errs = (json as { errors?: { details?: unknown }[] } | null)?.errors;
    const details = Array.isArray(errs) && typeof errs[0]?.details === "string" ? (errs[0].details as string) : "";
    return errorFor(response.status, details);
  }
  const data = ((json as { data?: unknown } | null)?.data ?? {}) as Record<string, unknown>;
  // What it cost, as Hunter reports it; failing the header, what the docs say:
  // a search is 1 credit, nothing found is free.
  const header = Number(response.headers.get("x-credits-used"));
  const creditsUsed = Number.isFinite(header) && response.headers.has("x-credits-used") ? header : freeWhen(data) ? 0 : 1;
  return { ok: true as const, data, creditsUsed };
}

const bool = (v: unknown) => (v === true ? true : v === false ? false : null);

export async function findEmail(domain: string, first: string, last: string): Promise<FinderResult> {
  const r = await get("/v2/email-finder", { domain, first_name: first, last_name: last }, (d) => typeof d.email !== "string" || d.email === "");
  if (!r.ok) return r;
  const d = r.data;
  const email = typeof d.email === "string" && d.email.includes("@") ? d.email.trim().toLowerCase() : null;
  const verification = (d.verification ?? null) as { status?: unknown } | null;
  return {
    ok: true,
    email,
    score: typeof d.score === "number" ? d.score : null,
    acceptAll: bool(d.accept_all),
    provenance: d.provenance === "found" ? "found" : "inferred",
    verification: typeof verification?.status === "string" ? verification.status : null,
    creditsUsed: r.creditsUsed,
  };
}

// limit=1: the pattern is what is wanted, not the addresses.
export async function searchDomain(domain: string): Promise<DomainSearchResult> {
  const r = await get("/v2/domain-search", { domain, limit: "1" }, (d) => !d.pattern && !(Array.isArray(d.emails) && d.emails.length > 0));
  if (!r.ok) return r;
  const d = r.data;
  return {
    ok: true,
    pattern: typeof d.pattern === "string" && d.pattern.trim() !== "" ? d.pattern.trim() : null,
    acceptAll: bool(d.accept_all),
    webmail: bool(d.webmail),
    creditsUsed: r.creditsUsed,
  };
}
