// The duplicate test, across both discovery pathways.
//
// Clinic-first and person-first searches routinely find the same clinic: one
// arrives as "Austin Spine & Disc" off a place search, the other as the
// employer on a chiropractor's LinkedIn profile. Two rows for that clinic
// means two queue runs, two model calls, and two answers to a question that
// has one answer — so the second one must find the first.
//
// The existing bulk import keeps its own test (dedupeKey in
// src/lib/discoveryImport.ts: clinic name + contact name) and is deliberately
// untouched. This module is the wider waterfall the clinic-first import needs,
// because a clinic-first result usually has no contact name to match on:
//
//   1. normalised clinic name + normalised location   (the primary match)
//   2. website domain
//   3. company LinkedIn URL
//   4. normalised clinic name + normalised contact name, where both are known
//
// First hit wins, and every rung is normalised the same way, so "Austin Spine
// & Disc Center, Austin, TX" and "austin spine and disc center — austin tx"
// are one clinic.
//
// Pure. What to do about a hit is decided by the caller: the clinic-first
// import merges into the existing row rather than creating a second one.

// ─── Normalising ───────────────────────────────────────────────────────────

// A clinic or contact name, flattened to what two spellings of it have in
// common: case, punctuation, "&" against "and", and the corporate suffixes one
// source keeps and the other drops.
const NOISE_WORDS = new Set([
  "the",
  "inc",
  "llc",
  "pllc",
  "pc",
  "pa",
  "ltd",
  "co",
  "corp",
  "and",
]);

export function normalizeName(raw: string | null | undefined): string {
  const base = (raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (base === "") return "";
  const words = base
    .split(" ")
    .map((w) => (w === "centre" ? "center" : w))
    .filter((w) => w !== "" && !NOISE_WORDS.has(w));
  // A name made entirely of noise words is still a name; falling back to the
  // flattened original beats matching every such clinic to each other on an
  // empty string.
  return words.length > 0 ? words.join(" ") : base.replace(/\s+/g, " ");
}

// US state names to the two-letter code, so "Austin, Texas" and "Austin, TX"
// are one location. Only the direction that collapses variety is needed —
// nothing here needs to expand a code back into a name.
const STATE_CODES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
  missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi",
  wyoming: "wy", "district of columbia": "dc",
};

// A location as the match sees it: lowercased, punctuation gone, states as
// codes, and the street half dropped.
//
// The street is dropped on purpose. One source reports "1200 W 6th St, Suite
// 210, Austin, TX 78703" and the other reports "Austin, TX"; keeping the
// street would make those two different clinics, which is the exact duplicate
// this exists to catch. What is kept is the last two comma-separated parts,
// with any ZIP dropped — town and state, the granularity both sources agree on.
export function normalizeLocation(raw: string | null | undefined): string {
  const text = (raw ?? "")
    .toLowerCase()
    .replace(/\bunited states\b|\busa\b|\bus\b/g, "");
  const parts = text
    .split(",")
    .map((p) => p.replace(/\d{5}(-\d{4})?/g, "").replace(/[^a-z ]+/g, " ").trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return "";
  return parts
    .slice(-2)
    .map((p) => STATE_CODES[p] ?? p)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// The host of a URL, without "www." and without a scheme, path or query — the
// part two sources reporting the same clinic's site agree on. Null for
// anything that is not a URL, so two candidates with no website never match
// each other on one.
export function websiteDomain(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

// A LinkedIn company URL as the match sees it: case-less, and without the
// trailing slash, the locale subdomain or the tracking query one source adds
// and the other doesn't.
export function linkedinKey(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const path = url.pathname.toLowerCase().replace(/\/+$/, "");
    if (path === "") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^[a-z]{2}\./, "");
    return `${host}${path}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

// ─── The waterfall ─────────────────────────────────────────────────────────

// Everything a match is made on. Both an existing row and an incoming result
// are read as one of these, so the two sides are always compared the same way.
export interface DedupeFields {
  clinicName: string;
  location?: string | null;
  websiteUrl?: string | null;
  companyLinkedinUrl?: string | null;
  contactName?: string | null;
}

export type DedupeRung =
  | "nameLocation"
  | "website"
  | "companyLinkedin"
  | "nameContact";

export const DEDUPE_RUNG_LABELS: Record<DedupeRung, string> = {
  nameLocation: "same clinic name and location",
  website: "same website domain",
  companyLinkedin: "same company LinkedIn page",
  nameContact: "same clinic and contact name",
};

export interface DedupeMatch<T> {
  existing: T;
  rung: DedupeRung;
}

// An index over whatever is already stored — candidates, leads, and the rows
// created so far in this very import. Built once and asked per result, because
// a clinic-first run brings back hundreds of results and a scan per rung per
// row is the difference between a second and a minute.
export class DedupeIndex<T extends DedupeFields> {
  private byNameLocation = new Map<string, T>();
  private byWebsite = new Map<string, T>();
  private byLinkedin = new Map<string, T>();
  private byNameContact = new Map<string, T>();

  constructor(rows: T[] = []) {
    for (const row of rows) this.add(row);
  }

  add(row: T): void {
    const name = normalizeName(row.clinicName);
    if (name === "") return;
    const location = normalizeLocation(row.location);
    this.putFirst(this.byNameLocation, `${name}|${location}`, row);
    // Also indexed under the name alone, so the next sighting of this clinic
    // finds it whether or not that sighting carries a town. Two genuinely
    // different clinics sharing a name is the one case this merges wrongly,
    // and merging is the better error: nothing is deleted, and the row carries
    // both sources for a person to read.
    if (location !== "") this.putFirst(this.byNameLocation, `${name}|`, row);

    const domain = websiteDomain(row.websiteUrl);
    if (domain) this.putFirst(this.byWebsite, domain, row);

    const linkedin = linkedinKey(row.companyLinkedinUrl);
    if (linkedin) this.putFirst(this.byLinkedin, linkedin, row);

    const contact = normalizeName(row.contactName);
    if (contact !== "") this.putFirst(this.byNameContact, `${name}|${contact}`, row);
  }

  // First writer wins: the oldest row carrying a key is the one an incoming
  // duplicate should merge into, not whichever was indexed last.
  private putFirst(map: Map<string, T>, key: string, row: T): void {
    if (!map.has(key)) map.set(key, row);
  }

  // The stored row this result is already a copy of, and which rung caught it.
  // Null means it is new.
  match(incoming: DedupeFields): DedupeMatch<T> | null {
    const name = normalizeName(incoming.clinicName);
    if (name !== "") {
      const location = normalizeLocation(incoming.location);
      const hit =
        this.byNameLocation.get(`${name}|${location}`) ??
        this.byNameLocation.get(`${name}|`);
      if (hit) return { existing: hit, rung: "nameLocation" };
    }

    const domain = websiteDomain(incoming.websiteUrl);
    if (domain) {
      const hit = this.byWebsite.get(domain);
      if (hit) return { existing: hit, rung: "website" };
    }

    const linkedin = linkedinKey(incoming.companyLinkedinUrl);
    if (linkedin) {
      const hit = this.byLinkedin.get(linkedin);
      if (hit) return { existing: hit, rung: "companyLinkedin" };
    }

    const contact = normalizeName(incoming.contactName);
    if (name !== "" && contact !== "") {
      const hit = this.byNameContact.get(`${name}|${contact}`);
      if (hit) return { existing: hit, rung: "nameContact" };
    }

    return null;
  }
}

// ─── Provenance ────────────────────────────────────────────────────────────

// The sources a merged candidate has been found by, as one line: "LinkedIn,
// Clinic-First Search". A source already listed is not listed twice, and the
// order is the order it was found in, so the first one stays first.
//
// It is the free-text `source` column, which is what the list filters and
// displays on. A merge adds to it rather than overwriting: knowing a clinic
// turned up in both searches is worth more than knowing which search saw it
// last.
export function mergeSources(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const source of [existing, incoming]) {
    for (const piece of (source ?? "").split(",")) {
      const trimmed = piece.trim();
      if (trimmed === "") continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(trimmed);
    }
  }
  return parts.length === 0 ? null : parts.join(", ");
}

// What a merge is allowed to write onto the row that is already stored: the
// fields it has nothing in, and nothing else.
//
// This is the safety rule of the whole feature in one function. A second
// sighting of a clinic may fill in a website nobody had; it may never
// overwrite a contact somebody typed, a website an actor verified, or a score
// a run produced. Absence is the only thing it is allowed to change.
export function mergeFill<T extends Record<string, unknown>>(
  existing: T,
  incoming: Partial<T>,
): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || value === "") continue;
    const current = existing[key as keyof T];
    if (current === null || current === undefined || current === "") {
      patch[key] = value;
    }
  }
  return patch as Partial<T>;
}
