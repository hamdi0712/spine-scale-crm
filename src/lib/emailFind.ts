// Find emails — what the fields mean, and every decision the run makes that
// does not need a network: reading addresses out of a stored crawl, telling an
// owner's address from a front-desk one, the name-pattern guesses, reading a
// verifier's verdict, choosing which address goes in the email field, and what
// a run will cost.
//
// Pure. The actor calls and the write are in src/lib/emailFindRun.ts, and this
// module is what the run, the Pipeline page and the lead page agree on.
//
// The rules, in the order the run applies them:
//
//   An address typed into the lead form is "manual" and is never touched.
//
//   An address that arrived with an import is "imported": it is verified, and
//   it is never replaced. If it comes back invalid it moves to the alternates
//   and the run looks for another, exactly as for a lead with no address.
//
//   Cheapest first. The stored crawl is read for free; the extractor actor
//   runs only when that found nothing; the name-pattern guesses run only when
//   no valid owner address has turned up, and never on a catch-all domain.
//
//   Only "valid" is usable. A catch-all domain accepts every address, so a
//   verifier's yes there means nothing: it is "risky", never "valid".

import { splitName } from "@/lib/decisionMaker";
import { leadBreakdownV2 } from "@/lib/leadScore";
import { parseLinks } from "@/lib/websiteCrawl";
import {
  EXTRACTOR_ASSUMED_ADDRESSES,
  MAX_FOUND_VERIFIED,
  VERIFIER_USD_PER_ADDRESS,
  extractorCost,
} from "@/lib/emailFindRates";
export * from "@/lib/emailFindRates";

// ─── The fields ────────────────────────────────────────────────────────────

export const EMAIL_TYPES = ["owner", "generic", "not_found"] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];
export const EMAIL_TYPE_LABELS: Record<EmailType, string> = {
  owner: "Owner direct",
  generic: "Generic inbox",
  not_found: "Not found",
};

// Null in the column is "not checked".
export const EMAIL_STATUSES = ["valid", "risky", "invalid", "unknown"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export const EMAIL_STATUS_LABELS: Record<EmailStatus | "unchecked", string> = {
  valid: "Valid",
  risky: "Risky",
  invalid: "Invalid",
  unknown: "Unknown",
  unchecked: "Not checked",
};

export const EMAIL_SOURCES = ["site_crawl", "extractor", "name_pattern", "imported", "manual"] as const;
export type EmailSource = (typeof EMAIL_SOURCES)[number];
export const EMAIL_SOURCE_LABELS: Record<EmailSource, string> = {
  site_crawl: "Site crawl",
  extractor: "Extractor",
  name_pattern: "Name pattern",
  imported: "Imported",
  manual: "Entered by hand",
};

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}
export const readEmailType = (v: unknown) => oneOf(EMAIL_TYPES, v);
export const readEmailStatus = (v: unknown) => oneOf(EMAIL_STATUSES, v);
export const readEmailSource = (v: unknown) => oneOf(EMAIL_SOURCES, v);

// What the stored source means for a lead. An address with no source on it
// predates the column or came in through Discovery: imported, not typed.
export function effectiveEmailSource(lead: { email: string | null; emailSource: string | null }): EmailSource | null {
  const source = readEmailSource(lead.emailSource);
  if (source) return source;
  return (lead.email ?? "").trim() === "" ? null : "imported";
}

// The lead form's half of the rule: what emailSource becomes when the form is
// saved. A changed address is the operator's own, an emptied one carries no
// source, and an unchanged one keeps whatever it had — saving the form to fix
// a phone number does not turn a found address into a typed one.
export function emailSourceAfterFormSave(
  stored: { email: string | null; emailSource: string | null },
  posted: string | null,
): { changed: boolean; emailSource: string | null } {
  const before = (stored.email ?? "").trim().toLowerCase();
  const after = (posted ?? "").trim().toLowerCase();
  if (before === after) return { changed: false, emailSource: stored.emailSource };
  return { changed: true, emailSource: after === "" ? null : "manual" };
}

export interface EmailCandidate {
  address: string;
  type: Exclude<EmailType, "not_found">;
  // Null: found but never sent to the verifier (the run stopped first).
  status: EmailStatus | null;
  source: EmailSource;
}

export function parseAlternates(raw: string | null | undefined): EmailCandidate[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x): EmailCandidate[] => {
      if (x === null || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      if (typeof o.address !== "string") return [];
      return [
        {
          address: o.address,
          type: o.type === "owner" ? "owner" : "generic",
          status: readEmailStatus(o.status),
          source: readEmailSource(o.source) ?? "site_crawl",
        },
      ];
    });
  } catch {
    return [];
  }
}

// ─── Reading addresses ─────────────────────────────────────────────────────

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

// Things shaped like an address that are not one: retina image names
// (logo@2x.png), the site builder's own and error-tracking addresses, and the
// placeholders in a template's contact form.
const JUNK_TLDS = /\.(png|jpe?g|gif|webp|svg|css|js|ico|bmp|tiff?|mp4|pdf)$/i;
const JUNK_DOMAINS = [
  "example.com",
  "example.org",
  "domain.com",
  "email.com",
  "yourdomain.com",
  "yoursite.com",
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "wix.com",
  "squarespace.com",
  "godaddy.com",
  "wordpress.com",
  "mysite.com",
];
const JUNK_LOCALS = new Set(["name", "your", "youremail", "email", "user", "username", "test", "noreply", "no-reply", "donotreply"]);

export function isJunkAddress(address: string): boolean {
  const [local, domain] = address.split("@");
  if (!local || !domain) return true;
  if (JUNK_TLDS.test(domain)) return true;
  if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  if (JUNK_LOCALS.has(local)) return true;
  // Hex hashes the error trackers use as a local part.
  if (/^[0-9a-f]{16,}$/.test(local)) return true;
  return false;
}

// Every address in a piece of text, lowercased, junk dropped, each once, in
// the order they appear.
export function extractEmails(text: string | null | undefined): string[] {
  if (!text) return [];
  // mailto:a@b?subject=… and URL-encoded @ both turn up in markdown.
  const plain = text.replace(/%40/gi, "@");
  const out: string[] = [];
  for (const m of Array.from(plain.matchAll(EMAIL_RE))) {
    const address = m[0].toLowerCase().replace(/^[._%+-]+/, "").replace(/\.+$/, "");
    if (isJunkAddress(address) || out.includes(address)) continue;
    out.push(address);
  }
  return out;
}

// The free step: the copy the crawler stored, and every stored link — its
// text, and its target, which is where a mailto: lands.
export function emailsFromStoredCrawl(websiteNotes: string | null, websiteLinks: string | null): string[] {
  const links = parseLinks(websiteLinks);
  const linkText = links.map((l) => `${l.text} ${l.url}`).join("\n");
  return dedupe([...extractEmails(websiteNotes), ...extractEmails(linkText)]);
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}

// The clinic's own domain, off its website: "www.austinspine.com" →
// "austinspine.com". Null without a usable website.
export function clinicDomain(websiteUrl: string | null | undefined): string | null {
  const raw = (websiteUrl ?? "").trim();
  if (raw === "") return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

// Mailbox providers a small clinic runs its inbox on. An address on one of
// these is the clinic's as surely as one on its own domain; an address on any
// other domain is somebody else's — the web designer, a partner, a vendor.
const MAILBOX_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "verizon.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "protonmail.com",
  "proton.me",
]);

function domainOf(address: string): string {
  return address.slice(address.indexOf("@") + 1);
}

export function belongsToClinic(address: string, domain: string | null): boolean {
  const d = domainOf(address);
  if (MAILBOX_PROVIDERS.has(d)) return true;
  if (domain === null) return false;
  return d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`);
}

// ─── Owner or front desk ───────────────────────────────────────────────────

export interface DecisionMakerName {
  // The whole name as it was read, for the per-lead line.
  name: string;
  first: string | null;
  last: string | null;
}

// Letters only, lowercase: "O'Neil-Smith" → "oneilsmith".
function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function readDecisionMakerName(raw: string | null | undefined): DecisionMakerName | null {
  const name = (raw ?? "").trim();
  if (name === "") return null;
  const { firstName, lastName } = splitName(name);
  if (firstName && lastName) {
    const first = slug(firstName);
    const last = slug(lastName);
    if (first.length >= 2 && last.length >= 2) return { name, first, last };
  }
  // "Dr. Smith": a last name and no first. Enough for drsmith@ and for
  // recognising smith@ as theirs, and nothing else is guessed.
  const dr = name.match(/^(?:dr\.?|doctor)\s+([A-Za-z'-]{2,})$/i);
  if (dr) return { name, first: null, last: slug(dr[1]) };
  return null;
}

// The decision-maker the run guesses for: the contact on the lead, or failing
// that the person the new-model scorecard named as the decision-maker.
export function decisionMakerFor(lead: { contactName: string | null; icpBreakdown: string | null }): DecisionMakerName | null {
  const onRecord = readDecisionMakerName(lead.contactName);
  if (onRecord) return onRecord;
  return readDecisionMakerName(scorecardDecisionMaker(lead.icpBreakdown));
}

// The scorecard's "Decision-maker title" line names its person in one of two
// shapes (titleEntry in src/lib/icpScoring.ts): "Jane Smith, Owner on the
// site — …" or "Dr. Jane Smith is named on the site at …". A line with no
// points named nobody.
export function scorecardDecisionMaker(icpBreakdown: string | null): string | null {
  const b = leadBreakdownV2({ icpBreakdown });
  const title = b?.fit.find((e) => e.key === "title");
  if (!title || title.points <= 0) return null;
  const named = title.reason.match(/^(.+?) is named on the site\b/);
  if (named) return named[1].trim();
  const titled = title.reason.match(/^([^,]+), .+ on the site\b/);
  if (titled) return titled[1].trim();
  return null;
}

// Front-desk local parts. An address is the owner's only when it carries the
// decision-maker's name; anything else is a shared inbox for this purpose.
const GENERIC_LOCALS = [
  "info", "office", "contact", "hello", "hi", "admin", "frontdesk", "front.desk", "front-desk",
  "reception", "appointments", "appointment", "appts", "schedule", "scheduling", "booking",
  "bookings", "billing", "team", "staff", "support", "mail", "inquiries", "inquiry",
  "enquiries", "care", "patientcare", "patients", "newpatients", "help", "marketing", "sales",
  "welcome", "clinic", "practice", "manager", "officemanager", "careers", "jobs", "hr", "general",
];

export function classifyAddress(address: string, person: DecisionMakerName | null): "owner" | "generic" {
  const local = address.slice(0, address.indexOf("@"));
  if (GENERIC_LOCALS.includes(local)) return "generic";
  if (!person) return "generic";
  const letters = slug(local);
  // dr.janet@, drjanet@ — the title in front of the name.
  const bare = /^dr[a-z]{3,}/.test(letters) ? letters.slice(2) : letters;
  const { first, last } = person;
  if (last && last.length >= 3 && letters.includes(last)) return "owner";
  if (first && first.length >= 3 && (letters.startsWith(first) || bare.startsWith(first))) return "owner";
  // jsmith@, j.smith@
  if (first && last && letters === `${first[0]}${last}`) return "owner";
  return "generic";
}

// The guesses, in the order they are tried: first@, firstlast@, first.last@,
// drlast@ on the clinic's own domain. A last name alone gives drlast@ only.
export function namePatternGuesses(person: DecisionMakerName, domain: string): string[] {
  const { first, last } = person;
  const locals: string[] = [];
  if (first) locals.push(first);
  if (first && last) locals.push(`${first}${last}`, `${first}.${last}`);
  if (last) locals.push(`dr${last}`);
  return dedupe(locals.map((l) => `${l}@${domain}`));
}

// ─── Reading a verifier's verdict ──────────────────────────────────────────
//
// Verifier actors disagree on what to call things — status, result, verdict;
// "deliverable", "valid", "ok"; "catch_all", "accept-all", isCatchAll: true —
// so a row is read by field name rather than by one actor's schema. The row
// is the flattened dataset item (itemsToTable in src/lib/apify.ts): dotted
// paths to string values.

export interface Verdict {
  status: EmailStatus;
  catchAll: boolean;
}

const STATUS_KEYS = /^(status|result|verdict|state|deliverability|verification|verificationstatus|emailstatus|smtpstatus|smtp_status)$/i;
const CATCH_ALL_KEYS = /(catch.?all|accept.?all)/i;
const VALID_BOOL_KEYS = /^(is_?)?(valid|deliverable)$/i;

function leaf(key: string): string {
  return key.slice(key.lastIndexOf(".") + 1);
}

function truthy(v: string): boolean {
  return /^(true|yes|1)$/i.test(v.trim());
}

export function statusWord(raw: string): { status: EmailStatus; catchAll: boolean } | null {
  const w = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (w === "") return null;
  if (/catch_?all|accept_?all/.test(w)) return { status: "risky", catchAll: true };
  if (/^(invalid|undeliverable|bounce|bounced|rejected|disposable|bad|not_valid|does_not_exist|no_mx|syntax_error|invalid_syntax|mailbox_not_found|spamtrap)$/.test(w)) {
    return { status: "invalid", catchAll: false };
  }
  if (/^(valid|deliverable|ok|safe|verified|good|exists)$/.test(w)) return { status: "valid", catchAll: false };
  if (/^(risky|role|role_based|full_inbox|mailbox_full|low_quality)$/.test(w)) return { status: "risky", catchAll: false };
  if (/^(unknown|unverifiable|timeout|error|unchecked|greylisted|unavailable)$/.test(w)) return { status: "unknown", catchAll: false };
  return null;
}

// One verdict per address. A verifier that says "valid" and also flags the
// domain as catch-all has said risky.
export function readVerdict(headers: string[], row: string[]): Verdict {
  let status: EmailStatus | null = null;
  let catchAll = false;
  let validFlag: boolean | null = null;
  headers.forEach((h, i) => {
    const value = row[i] ?? "";
    const name = leaf(h);
    if (CATCH_ALL_KEYS.test(name)) {
      if (truthy(value)) catchAll = true;
      return;
    }
    if (VALID_BOOL_KEYS.test(name) && /^(true|false)$/i.test(value.trim())) {
      validFlag = truthy(value);
      return;
    }
    if (STATUS_KEYS.test(name) && status === null) {
      const read = statusWord(value);
      if (read) {
        status = read.status;
        if (read.catchAll) catchAll = true;
      }
    }
  });
  let resolved: EmailStatus = status ?? (validFlag === true ? "valid" : validFlag === false ? "invalid" : "unknown");
  if (catchAll && resolved === "valid") resolved = "risky";
  return { status: resolved, catchAll };
}

// The row about this address, when the verifier returned more than one.
export function rowForAddress(headers: string[], rows: string[][], address: string): string[] | null {
  const want = address.toLowerCase();
  for (const row of rows) {
    if (row.some((cell) => cell.trim().toLowerCase() === want)) return row;
  }
  return rows.length === 1 ? rows[0] : null;
}

// ─── Choosing the address ──────────────────────────────────────────────────

const STATUS_RANK: Record<EmailStatus, number> = { valid: 0, risky: 1, unknown: 2, invalid: 3 };

function rank(c: EmailCandidate): number {
  const status = c.status === null ? 4 : STATUS_RANK[c.status];
  return status * 2 + (c.type === "owner" ? 0 : 1);
}

export interface EmailChoice {
  primary: EmailCandidate | null;
  alternates: EmailCandidate[];
}

// What goes in the email field. An imported address that did not come back
// invalid stays where it is; otherwise the best verified address wins — valid
// owner, valid generic, then risky, then unknown, owner before generic at each
// step. A guess is only ever the primary when it verified valid: a catch-all
// "yes" to a made-up address is not evidence anyone reads it. Never invalid,
// never unverified.
export function chooseEmail(candidates: EmailCandidate[]): EmailChoice {
  const imported = candidates.find((c) => c.source === "imported");
  const eligible = (c: EmailCandidate) =>
    c.status !== null && c.status !== "invalid" && (c.source !== "name_pattern" || c.status === "valid");
  let primary: EmailCandidate | null = null;
  if (imported && imported.status !== "invalid") primary = imported;
  else {
    const sorted = candidates.filter(eligible).sort((a, b) => rank(a) - rank(b));
    primary = sorted[0] ?? null;
  }
  // Guesses that did not verify are not addresses anybody found, and stay out.
  const alternates = candidates.filter(
    (c) => c !== primary && !(c.source === "name_pattern" && c.status === "invalid"),
  );
  return { primary, alternates };
}

// ─── The run's summary ─────────────────────────────────────────────────────

// One per lead, read off the address left in the email field.
export const FIND_OUTCOMES = [
  "valid_owner",
  "valid_generic",
  "risky",
  "unknown",
  "none",
  "skipped_manual",
] as const;
export type FindOutcome = (typeof FIND_OUTCOMES)[number];

export const FIND_OUTCOME_LABELS: Record<FindOutcome, string> = {
  valid_owner: "Valid owner email",
  valid_generic: "Valid generic email",
  risky: "Risky only",
  unknown: "Unknown only",
  none: "None",
  skipped_manual: "Skipped (entered by hand)",
};

export function outcomeFor(primary: EmailCandidate | null): FindOutcome {
  if (!primary || primary.status === null || primary.status === "invalid") return "none";
  if (primary.status === "valid") return primary.type === "owner" ? "valid_owner" : "valid_generic";
  return primary.status;
}

export type FindCounts = Record<FindOutcome, number>;

export function countOutcomes(outcomes: (FindOutcome | null)[]): FindCounts {
  const counts = Object.fromEntries(FIND_OUTCOMES.map((o) => [o, 0])) as FindCounts;
  for (const o of outcomes) if (o) counts[o]++;
  return counts;
}

// "Valid owner 7 · valid generic 5 · risky only 3 · unknown 1 · none 4". Zero
// rows are left out except the four that answer the question.
export function summarySentence(counts: FindCounts): string {
  const parts = [
    `valid owner ${counts.valid_owner}`,
    `valid generic ${counts.valid_generic}`,
    `risky only ${counts.risky}`,
    `unknown ${counts.unknown}`,
    `none ${counts.none}`,
  ];
  if (counts.skipped_manual > 0) parts.push(`skipped (entered by hand) ${counts.skipped_manual}`);
  const s = parts.join(" · ");
  return s[0].toUpperCase() + s.slice(1);
}

// ─── What it costs ─────────────────────────────────────────────────────────
//
// The rates live in src/lib/emailFindRates.ts, which the settings form (a
// client component) can import without pulling the scorecard in with it.


// The ceiling on one lead: the extractor if it will need it, and every
// verification it could make — the imported address, the found ones up to
// the cap, and every guess.
export function leadCeilingUsd(plan: { imported: boolean; found: number; needsExtractor: boolean; guesses: number }): number {
  const found = Math.min(MAX_FOUND_VERIFIED, plan.needsExtractor ? EXTRACTOR_ASSUMED_ADDRESSES : plan.found);
  const verifications = (plan.imported ? 1 : 0) + found + plan.guesses;
  return (plan.needsExtractor ? extractorCost() : 0) + verifications * VERIFIER_USD_PER_ADDRESS;
}
