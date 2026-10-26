// Email helpers — what a lead's email fields mean, and plain functions for
// reading addresses out of scraped text and labelling them. Kept from the
// removed Find emails run for reuse on the addresses Clinic-first discovery
// brings in from Google Maps.
//
//   An address typed into the lead form is "manual"; one that arrived any
//   other way with no source on it reads as "imported".
//   Junk and vendor addresses (image names, site builders, error trackers,
//   placeholders) are dropped; an address on another business's domain is
//   not the clinic's.
//   An address is the owner's only when it carries the decision-maker's
//   name; anything else is a generic inbox.
//
// Pure.

import { splitName } from "@/lib/decisionMaker";
import { leadBreakdownV2 } from "@/lib/leadScore";
import { parseLinks } from "@/lib/websiteCrawl";

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

