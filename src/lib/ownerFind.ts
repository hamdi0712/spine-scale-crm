// Owner-finding — the rules. Pure; the run is src/lib/ownerFindRun.ts, the
// clients src/lib/npiRegistry.ts and src/lib/hunter.ts.
//
// 1. The owner's name, free.
//    The clinic is looked up in the NPI Registry's organization records by
//    name (and state, read off the lead's location), and a record counts as
//    the clinic only when its phone matches the lead's, or its name is close
//    and its town is the lead's. Its authorized official is the owner unless
//    the title is an office or billing one (office manager, administrator,
//    billing…) — then the official is "not a decision-maker".
//    The name is checked against the doctors the stored crawl names:
//      NPI decision-maker, same person on the site   → confirmed (npi_site)
//      NPI decision-maker, the site names nobody      → confirmed (npi)
//      NPI decision-maker, the site names others      → pick (both shown)
//      no NPI decision-maker, the site names one doctor → confirmed (site)
//      no NPI decision-maker, the site names several  → pick
//      nobody anywhere                                 → not_found
//
// 2. The owner's email, only for a confirmed owner on a clinic-owned domain
//    with no owner address yet. Hunter's Email Finder first; failing that,
//    Domain Search's pattern; failing a pattern, three guesses — drlast@,
//    first@, drfirst@ — each checked with Instantly, stopping at the first
//    valid one.
//
// 3. Where a found address goes. Valid → the main email, the front desk to
//    the alternates. On a catch-all domain (Instantly: risky) only an address
//    Hunter saw on the web becomes the main email; an inferred or guessed one
//    is kept as a risky alternate, since nothing can confirm it.

import { DecisionMakerName, EmailCandidate, EmailSource, EmailStatus, parseAlternates, readDecisionMakerName, readEmailSource } from "@/lib/emailFind";
import { looksLikePersonName } from "@/lib/decisionMaker";
import { parseLinks, providerNameFromLink } from "@/lib/websiteCrawl";
import type { NpiOrganization } from "@/lib/npiRegistry";

// ─── The vocabulary ────────────────────────────────────────────────────────

export const OWNER_STATUSES = ["confirmed", "pick", "not_found"] as const;
export type OwnerStatus = (typeof OWNER_STATUSES)[number];
export const OWNER_STATUS_LABELS: Record<OwnerStatus, string> = {
  confirmed: "Owner confirmed",
  pick: "Pick the owner",
  not_found: "Owner not found",
};
export function readOwnerStatus(v: unknown): OwnerStatus | null {
  return typeof v === "string" && (OWNER_STATUSES as readonly string[]).includes(v) ? (v as OwnerStatus) : null;
}

export const OWNER_SOURCES = ["npi_site", "npi", "site", "manual"] as const;
export type OwnerSource = (typeof OWNER_SOURCES)[number];
export const OWNER_SOURCE_LABELS: Record<OwnerSource, string> = {
  npi_site: "NPI Registry and the clinic's site agree",
  npi: "NPI Registry (the site names no doctor)",
  site: "The only doctor the clinic's site names",
  manual: "Picked by hand",
};
export function readOwnerSource(v: unknown): OwnerSource | null {
  return typeof v === "string" && (OWNER_SOURCES as readonly string[]).includes(v) ? (v as OwnerSource) : null;
}

// Worst case per lead, for the estimate: Email Finder and Domain Search (a
// credit each), and four Instantly checks (Hunter's address, then three
// guesses — a pattern means one guess, not three).
export const HUNTER_CREDITS_PER_LEAD_MAX = 2;
export const INSTANTLY_CHECKS_PER_LEAD_MAX = 4;
export const DEFAULT_HUNTER_CREDIT_BUDGET = 50;

// ─── Reading the lead ──────────────────────────────────────────────────────

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATES));

// "Austin, TX", "Austin TX 78701", "Austin, Texas" → "TX". Null when the
// location names no state.
export function stateFromLocation(location: string | null | undefined): string | null {
  const raw = (location ?? "").trim();
  if (raw === "") return null;
  const lower = raw.toLowerCase();
  for (const [name, code] of Object.entries(STATES).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`(^|[\\s,])${name}([\\s,]|$)`).test(lower)) return code;
  }
  const codes = raw.match(/\b[A-Z]{2}\b/g) ?? [];
  const code = codes.reverse().find((c) => STATE_CODES.has(c));
  return code ?? null;
}

// The town: everything before the first comma, or before the state.
export function cityFromLocation(location: string | null | undefined): string | null {
  const raw = (location ?? "").trim();
  if (raw === "") return null;
  const head = raw.split(",")[0].replace(/\b[A-Z]{2}\b\s*\d{0,5}\s*$/, "").trim();
  return head === "" ? null : head.toLowerCase();
}

export function phoneDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}

// ─── Matching the NPI record ───────────────────────────────────────────────

const ORG_NOISE = new Set(["the", "of", "and", "a", "an", "inc", "llc", "pllc", "pc", "pa", "ltd", "co", "corp", "corporation", "company", "dc", "md", "do", "lp", "llp", "group"]);

function orgWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !ORG_NOISE.has(w));
}

// The searches to try, most specific first: the first two words as written,
// then the first word alone. organization_name is a prefix search, so
// "Spine & Health Institute" → "Spine &*" would miss; words only.
export function npiNameQueries(clinicName: string): string[] {
  const words = clinicName
    .replace(/^the\s+/i, "")
    .replace(/[^A-Za-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && w.toLowerCase() !== "and");
  const out: string[] = [];
  if (words.length >= 2) out.push(`${words[0]} ${words[1]}`);
  if (words[0] && words[0].length >= 2) out.push(words[0]);
  return Array.from(new Set(out.map((q) => q.toUpperCase())));
}

// How much of the shorter name the other carries, 0–1.
export function nameSimilarity(a: string, b: string): number {
  const x = new Set(orgWords(a));
  const y = new Set(orgWords(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of Array.from(x)) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size);
}

export interface NpiMatch {
  org: NpiOrganization;
  // What confirmed it.
  by: "phone" | "town";
  similarity: number;
}

// The record that is this clinic, or null. A matching phone confirms it on
// its own (the search already narrowed by name); otherwise the name must be
// close (60% of the shorter one's words) and the town must be the lead's.
export function matchNpiOrganization(
  lead: { clinicName: string; phone: string | null; location: string | null },
  results: NpiOrganization[],
): NpiMatch | null {
  const phone = phoneDigits(lead.phone);
  const city = cityFromLocation(lead.location);
  const scored = results.map((org) => {
    const similarity = Math.max(0, ...org.names.map((n) => nameSimilarity(lead.clinicName, n)));
    const phones = [...org.addresses.map((a) => a.phone), org.official.phone].map(phoneDigits);
    const byPhone = phone !== null && phones.includes(phone);
    const byTown = city !== null && org.addresses.some((a) => a.city.toLowerCase() === city);
    return { org, similarity, byPhone, byTown };
  });
  const hits = scored
    .filter((s) => s.byPhone || (s.byTown && s.similarity >= 0.6))
    .sort((a, b) => Number(b.byPhone) - Number(a.byPhone) || b.similarity - a.similarity);
  const best = hits[0];
  return best ? { org: best.org, by: best.byPhone ? "phone" : "town", similarity: best.similarity } : null;
}

// Titles that run the office rather than own the practice.
const OFFICE_TITLE = /\b(office|billing|biller|manager|administrat\w*|admin|bookkeep\w*|accounting|accountant|secretary|reception\w*|front desk|assistant|coordinator|clerk|human resources|hr|credentialing|compliance|staff)\b/i;
// …unless the title also says they own it: "Owner / Office Manager".
const OWNER_TITLE = /\b(owner|president|ceo|founder|principal|partner|proprietor|member|managing member|doctor|chiropractor|physician|dc|d\.c\.|md|m\.d\.)\b/i;

export function isDecisionMakerTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  if (t === "") return true;
  if (OWNER_TITLE.test(t)) return true;
  return !OFFICE_TITLE.test(t);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((p) => (/^[a-z]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p))
    .join("");
}

const DOCTOR_CREDENTIAL = /^(d\.?\s?c\.?|m\.?\s?d\.?|d\.?\s?o\.?|dpt|d\.?p\.?t\.?|dmd|dds|phd|ph\.?d\.?|nmd|n\.?d\.?)$/i;

// "Dr. Arnoldo Gutierrez": the official as a name the email can use. "Dr."
// when the record says so (prefix Dr., or a doctor's credential).
export function officialName(org: NpiOrganization): string | null {
  const { first, last, prefix, credential } = org.official;
  if (!last) return null;
  const doctor = /^dr\.?$/i.test(prefix ?? "") || (credential ?? "").split(/[,\s]+/).some((c) => DOCTOR_CREDENTIAL.test(c));
  const name = [first, last].filter(Boolean).map((p) => titleCase(p!)).join(" ");
  return doctor ? `Dr. ${name}` : name;
}

// ─── The doctors on the clinic's own site ──────────────────────────────────

const NOT_NAME_WORDS = new Set(["the", "our", "your", "meet", "visit", "call", "ask", "contact", "about", "is", "and", "office", "clinic", "team", "who", "will", "can", "has", "was", "today", "now"]);
const NAME = "[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?";

function cleanName(raw: string): string {
  return raw.replace(/’/g, "'").replace(/\s+/g, " ").trim();
}

// Every doctor the stored crawl names, as "Dr. First Last" (or "Dr. Last"
// when only that is written), each person once — "Dr. Lee" folds into
// "Dr. Ann Lee". Read from the copy ("Dr. Ann Lee", "Ann Lee, D.C.") and
// from the provider-page links (/doctors/ann-lee-dc). Nothing is fetched.
export function siteDoctorNames(websiteNotes: string | null | undefined, websiteLinks: string | null | undefined): string[] {
  const text = websiteNotes ?? "";
  const found: string[] = [];
  const titled = new RegExp(`\\b(?:Dr\\.?|Doctor)\\s+(${NAME}(?:\\s+[A-Z]\\.)?(?:\\s+${NAME}){0,2})`, "g");
  for (const m of Array.from(text.matchAll(titled))) {
    const words = cleanName(m[1]).split(" ").filter((w) => !NOT_NAME_WORDS.has(w.toLowerCase()));
    // A name runs until the first word that is not one: "Dr. Lee Offers" stops at Lee.
    if (words.length === 0) continue;
    const name = words.slice(0, 3).join(" ");
    if (words.length === 1 || looksLikePersonName(name)) found.push(`Dr. ${name}`);
  }
  const credentialed = new RegExp(`\\b(${NAME}(?:\\s+[A-Z]\\.)?\\s+${NAME}),?\\s+(?:D\\.\\s?C\\.|DC|M\\.\\s?D\\.|MD|D\\.\\s?O\\.|DO|DPT)(?![A-Za-z])`, "g");
  for (const m of Array.from(text.matchAll(credentialed))) {
    const name = cleanName(m[1]);
    if (looksLikePersonName(name) && !NOT_NAME_WORDS.has(name.split(" ")[0].toLowerCase())) found.push(`Dr. ${name}`);
  }
  for (const link of parseLinks(websiteLinks)) {
    const n = providerNameFromLink(link);
    if (n) found.push(n.startsWith("Dr. ") ? n : `Dr. ${n}`);
  }
  return foldNames(found);
}

// One entry per person: same surname and the first names do not disagree.
// The fuller spelling is kept.
function foldNames(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const i = out.findIndex((o) => samePerson(o, n));
    if (i === -1) out.push(n);
    else if (n.length > out[i].length) out[i] = n;
  }
  return out;
}

// Same surname, and the first names agree where both have one (an initial
// agrees with a name that starts with it).
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = readDecisionMakerName(a);
  const y = readDecisionMakerName(b);
  if (!x?.last || !y?.last || x.last !== y.last) return false;
  if (!x.first || !y.first) return true;
  return x.first === y.first || x.first.startsWith(y.first) || y.first.startsWith(x.first);
}

// ─── The decision ──────────────────────────────────────────────────────────

export interface OwnerDecision {
  status: OwnerStatus;
  source: OwnerSource | null;
  // The confirmed owner, null otherwise.
  name: string | null;
  // Whom to choose between, for a pick.
  choices: string[];
  // The NPI official, and whether the title makes them a decision-maker.
  official: string | null;
  officialIsDecisionMaker: boolean | null;
  detail: string;
}

export function decideOwner(match: NpiMatch | null, siteNames: string[]): OwnerDecision {
  const official = match ? officialName(match.org) : null;
  const title = match?.org.official.title ?? null;
  const dm = official ? isDecisionMakerTitle(title) : null;
  const base = { official, officialIsDecisionMaker: dm };
  const titled = official ? `${official}${title ? ` (${title})` : ""}` : null;

  if (official && dm) {
    const same = siteNames.find((n) => samePerson(n, official));
    if (same) return { ...base, status: "confirmed", source: "npi_site", name: official, choices: [], detail: `${titled} — the NPI official, and named on the site` };
    if (siteNames.length === 0) return { ...base, status: "confirmed", source: "npi", name: official, choices: [], detail: `${titled} — the NPI official; the site names no doctor` };
    return {
      ...base,
      status: "pick",
      source: null,
      name: null,
      choices: [official, ...siteNames],
      detail: `NPI says ${titled}; the site names ${siteNames.join(", ")} — pick the owner`,
    };
  }
  const flagged = official && !dm ? `NPI official ${titled} is not a decision-maker. ` : match ? "" : "No NPI record matched. ";
  if (siteNames.length === 1) {
    return { ...base, status: "confirmed", source: "site", name: siteNames[0], choices: [], detail: `${flagged}${siteNames[0]} — the only doctor the site names` };
  }
  if (siteNames.length > 1) {
    return { ...base, status: "pick", source: null, name: null, choices: siteNames, detail: `${flagged}The site names ${siteNames.join(", ")} — pick the owner` };
  }
  return { ...base, status: "not_found", source: null, name: null, choices: [], detail: `${flagged}The site names no doctor.`.trim() };
}

export function parseOwnerChoices(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  } catch {
    return [];
  }
}

// ─── Building the owner's address ──────────────────────────────────────────

// Hunter's pattern ("{first}.{last}", "{f}{last}", "{first}") filled in with
// the owner's name. Null when the pattern needs a part the name lacks, or
// holds a placeholder this does not know.
export function addressFromPattern(pattern: string, person: DecisionMakerName, domain: string): string | null {
  const parts: Record<string, string | null> = {
    first: person.first,
    last: person.last,
    f: person.first ? person.first[0] : null,
    l: person.last ? person.last[0] : null,
  };
  let missing = false;
  const local = pattern.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = parts[key.toLowerCase()];
    if (!v) missing = true;
    return v ?? "";
  });
  if (missing || !/^[a-z0-9._-]+$/.test(local)) return null;
  return `${local}@${domain}`;
}

// The three guesses when the domain has no known pattern, in order:
// drlast@, first@, drfirst@. One the name cannot fill is left out.
export function guessAddresses(person: DecisionMakerName, domain: string): string[] {
  const out = [person.last ? `dr${person.last}` : null, person.first, person.first ? `dr${person.first}` : null]
    .filter((l): l is string => !!l)
    .map((l) => `${l}@${domain}`);
  return Array.from(new Set(out));
}

// ─── Where the found address goes ──────────────────────────────────────────

export type OwnerEmailSource = Extract<EmailSource, "hunter" | "pattern_guess">;

export interface OwnerEmailCandidate {
  address: string;
  status: EmailStatus;
  source: OwnerEmailSource;
  // Hunter's provenance; a guess is never "found".
  found: boolean;
}

export function ownerEmailPlacement(c: OwnerEmailCandidate): "main" | "alternate" {
  if (c.status === "valid") return "main";
  if (c.status === "invalid") return "alternate";
  // risky (catch-all) or unknown: only an address seen on the web.
  return c.source === "hunter" && c.found ? "main" : "alternate";
}

// The lead's email columns with the owner's address in them. As the main
// email, the old one (the front desk) moves to the alternates with what is
// known about it; as an alternate, it joins them. A main address typed in
// by hand is never replaced — the owner's goes to the alternates instead.
export function withOwnerEmail(
  lead: { email: string | null; emailType: string | null; emailStatus: string | null; emailSource: string | null; emailAlternates: string | null },
  c: OwnerEmailCandidate,
): {
  placed: "main" | "alternate";
  fields: { email?: string; emailType?: string; emailStatus?: string; emailSource?: string; emailAlternates: string | null };
} {
  const wanted = ownerEmailPlacement(c);
  const manual = lead.emailSource === "manual" && (lead.email ?? "").trim() !== "";
  const placed = wanted === "main" && !manual ? "main" : "alternate";
  const owner: EmailCandidate = { address: c.address, type: "owner", status: c.status, source: c.source };
  const others = parseAlternates(lead.emailAlternates).filter((a) => a.address !== c.address);
  if (placed === "alternate") {
    const list = [...others, owner];
    return { placed, fields: { emailAlternates: JSON.stringify(list) } };
  }
  const old = (lead.email ?? "").trim().toLowerCase();
  const demoted: EmailCandidate[] =
    old !== "" && old !== c.address
      ? [{ address: old, type: lead.emailType === "owner" ? "owner" : "generic", status: (lead.emailStatus as EmailStatus | null) ?? null, source: readEmailSource(lead.emailSource) ?? "imported" }]
      : [];
  const list = [...demoted, ...others.filter((a) => a.address !== old)];
  return {
    placed,
    fields: {
      email: c.address,
      emailType: "owner",
      emailStatus: c.status,
      emailSource: c.source,
      emailAlternates: list.length > 0 ? JSON.stringify(list) : null,
    },
  };
}

// Whether the lead already has the owner's address — as its email, or as an
// alternate nobody has found invalid.
export function hasOwnerEmail(lead: { email: string | null; emailType: string | null; emailAlternates: string | null }): boolean {
  if ((lead.email ?? "").trim() !== "" && lead.emailType === "owner") return true;
  return parseAlternates(lead.emailAlternates).some((a) => a.type === "owner" && a.status !== "invalid");
}

// Any address on the lead (email or alternate) marked risky.
export function hasRiskyEmail(lead: { email: string | null; emailStatus: string | null; emailAlternates: string | null }): boolean {
  if ((lead.email ?? "").trim() !== "" && lead.emailStatus === "risky") return true;
  return parseAlternates(lead.emailAlternates).some((a) => a.status === "risky");
}

// ─── The lead page ─────────────────────────────────────────────────────────

// What the owner panel shows, off the lead's columns.
export function ownerPanelProps(lead: {
  id: string;
  contactName: string | null;
  ownerStatus: string | null;
  ownerSource: string | null;
  ownerSiteNames: string | null;
  ownerCheckedAt: Date | null;
  ownerEmailAt: Date | null;
  npiNumber: string | null;
  npiOfficialName: string | null;
  npiOfficialTitle: string | null;
  email: string | null;
  emailType: string | null;
  emailAlternates: string | null;
}) {
  const status = readOwnerStatus(lead.ownerStatus);
  const source = readOwnerSource(lead.ownerSource);
  const names = parseOwnerChoices(lead.ownerSiteNames);
  const riskyOwner = parseAlternates(lead.emailAlternates).find((a) => a.type === "owner" && a.status === "risky");
  const emailNote = hasOwnerEmail(lead)
    ? lead.emailType === "owner" && (lead.email ?? "") !== ""
      ? null
      : riskyOwner
        ? `Owner's address kept as a risky alternate: ${riskyOwner.address} — the domain accepts every address, so it can't be confirmed.`
        : null
    : lead.ownerEmailAt
      ? "The owner's email was looked for — nothing valid turned up."
      : null;
  return {
    leadId: lead.id,
    status,
    statusLabel: status ? OWNER_STATUS_LABELS[status] : "Not looked up",
    sourceLabel: status === "confirmed" && source ? OWNER_SOURCE_LABELS[source] : null,
    owner: status === "confirmed" ? lead.contactName : null,
    npiNumber: lead.npiNumber,
    npiOfficial: lead.npiOfficialName,
    npiTitle: lead.npiOfficialTitle,
    npiNotDecisionMaker: lead.npiOfficialName !== null && !isDecisionMakerTitle(lead.npiOfficialTitle),
    siteNames: status === "pick" ? [] : names,
    choices: status === "pick" ? names : [],
    checkedAt: lead.ownerCheckedAt ? lead.ownerCheckedAt.toISOString() : null,
    emailNote,
  };
}
