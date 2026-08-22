// Clinic-First Discovery — the second way into Discovery.
//
// The original pathway starts from a person: a LinkedIn profile search on job
// titles turns up a practitioner, and the clinic arrives as their employer.
// That biases what gets found towards whoever keeps a LinkedIn profile, which
// is not the same set as "clinics worth talking to". This pathway starts from
// the clinic — a place search on what the clinic does, wherever it is — and
// leaves the decision-maker unknown until later.
//
// What it deliberately does NOT do is build a second pipeline. A clinic-first
// result is normalised into exactly the DiscoveryCandidate shape the CSV and
// Apify imports already write, lands Pending like any other, and goes through
// the same Process Queue, the same five enrichment steps and the same scoring.
// The only thing downstream that knows the difference is the verdict, which
// will not promote a clinic nobody is named at (see src/lib/actions/discovery.ts).
//
// Pure: no network, no database. The run lives in
// src/lib/actions/clinicDiscovery.ts and the actor ID is a setting, never a
// constant in here.

// ─── Which pathway found a candidate ───────────────────────────────────────

export const DISCOVERY_SOURCES = ["PERSON_FIRST", "CLINIC_FIRST"] as const;

export type DiscoverySourceKind = (typeof DISCOVERY_SOURCES)[number];

export const DISCOVERY_SOURCE_KIND_LABELS: Record<DiscoverySourceKind, string> = {
  PERSON_FIRST: "Person-First",
  CLINIC_FIRST: "Clinic-First",
};

export const DISCOVERY_SOURCE_KIND_MEANINGS: Record<DiscoverySourceKind, string> = {
  PERSON_FIRST:
    "Found through a person — a LinkedIn profile search, or a sheet of them. The clinic came with the contact.",
  CLINIC_FIRST:
    "Found as a clinic, on its own merits. The decision-maker may still be unknown.",
};

export function isDiscoverySourceKind(v: unknown): v is DiscoverySourceKind {
  return (
    typeof v === "string" &&
    (DISCOVERY_SOURCES as readonly string[]).includes(v)
  );
}

// Anything unreadable reads as the pathway every row predating this column
// actually took, rather than throwing on a hand-edited database.
export function readDiscoverySourceKind(v: unknown): DiscoverySourceKind {
  return isDiscoverySourceKind(v) ? v : "PERSON_FIRST";
}

// What goes in the free-text `source` column, beside "LinkedIn" and "Added by
// name". It is the provenance a person reads; discoverySource is what the app
// branches on, and the two are kept separate so a merge can hold both sources
// at once without confusing the branch.
export const CLINIC_FIRST_SOURCE = "Clinic-First Search";

// The batch a clinic-first run is filed under, in the same "date — what it
// was" shape every other batch label takes. Here rather than beside the action
// that uses it because a "use server" module may export nothing but async
// functions.
export const CLINIC_FIRST_BATCH_DESCRIPTION = "Clinic-first search";

// ─── What the search is configured with ────────────────────────────────────

// The terms the brief names, offered as the starting set. They are a default
// and not a rule: the panel lets any of them be removed and anything else
// typed, because which phrase surfaces a decompression clinic is a thing to be
// found out by running it, not decided here.
export const DEFAULT_CLINIC_SEARCH_TERMS = [
  "non-surgical spine",
  "spinal decompression",
  "disc decompression",
  "herniated disc treatment",
  "bulging disc treatment",
  "DRX9000",
  "disc center",
  "spine center",
  "non-surgical back pain",
];

export const DEFAULT_CLINIC_SEARCH_LOCATION = "United States";

// The ICP's own headcount bands, as the two the discovery input can ask for.
// Optional, because most place-search actors have nothing to filter on and
// sending it would narrow nothing; where an actor does read it, this is the
// range the scorecard already rewards (see suggestedStaffSizeScore).
export const CLINIC_HEADCOUNT_RANGES = ["1-10", "11-50"] as const;

export type ClinicHeadcountRange = (typeof CLINIC_HEADCOUNT_RANGES)[number];

export function isClinicHeadcountRange(v: unknown): v is ClinicHeadcountRange {
  return (
    typeof v === "string" &&
    (CLINIC_HEADCOUNT_RANGES as readonly string[]).includes(v)
  );
}

// How many results one search term is allowed to bring back. A guard rail on
// spend rather than an opinion about the search: every result is a row the
// queue will eventually run five actors and a model call against.
export const MAX_RESULTS_PER_TERM = 50;
export const DEFAULT_RESULTS_PER_TERM = 20;

export interface ClinicSearchConfig {
  terms: string[];
  location: string;
  headcount: ClinicHeadcountRange | null;
  resultsPerTerm: number;
}

export const DEFAULT_CLINIC_SEARCH_CONFIG: ClinicSearchConfig = {
  terms: DEFAULT_CLINIC_SEARCH_TERMS,
  location: DEFAULT_CLINIC_SEARCH_LOCATION,
  headcount: null,
  resultsPerTerm: DEFAULT_RESULTS_PER_TERM,
};

// Untrusted config from the browser, held to what a search is allowed to be.
// Terms are trimmed, de-duplicated case-insensitively and capped; an empty set
// is not a search and the caller refuses it rather than running one.
export const MAX_CLINIC_SEARCH_TERMS = 12;

export function readClinicSearchConfig(raw: unknown): ClinicSearchConfig {
  const record =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const seen = new Set<string>();
  const terms: string[] = [];
  const rawTerms = Array.isArray(record.terms) ? record.terms : [];
  for (const term of rawTerms) {
    if (typeof term !== "string") continue;
    const trimmed = term.trim();
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(trimmed);
    if (terms.length >= MAX_CLINIC_SEARCH_TERMS) break;
  }

  const location =
    typeof record.location === "string" && record.location.trim() !== ""
      ? record.location.trim()
      : DEFAULT_CLINIC_SEARCH_LOCATION;

  const n = Number(record.resultsPerTerm);
  const resultsPerTerm = Number.isFinite(n)
    ? Math.min(MAX_RESULTS_PER_TERM, Math.max(1, Math.round(n)))
    : DEFAULT_RESULTS_PER_TERM;

  return {
    terms,
    location,
    headcount: isClinicHeadcountRange(record.headcount) ? record.headcount : null,
    resultsPerTerm,
  };
}

// The input one term's run is started with.
//
// Actors disagree about what they call these, and this app does not know which
// actor is configured — that is a setting. So the input carries the same value
// under each of the names the common place- and company-search actors read
// (searchStringsArray for the Maps crawler, query/search for the search
// scrapers, locationQuery/location for both), and an actor ignores whatever it
// does not have a field for. Sending a spare key is free; guessing the one
// right key and getting it wrong is a run that costs money and returns
// nothing.
export function clinicSearchInput(
  term: string,
  config: ClinicSearchConfig,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    search: term,
    query: term,
    searchStringsArray: [term],
    queries: term,
    location: config.location,
    locationQuery: config.location,
    countryCode: "us",
    maxCrawledPlacesPerSearch: config.resultsPerTerm,
    maxItems: config.resultsPerTerm,
    maxResults: config.resultsPerTerm,
    language: "en",
  };
  if (config.headcount) {
    // Only the company-search actors have anything to do with this one, and
    // they take the band as written — "11-50" is the string LinkedIn itself
    // uses, and the string the existing ICP range is expressed in.
    input.companySize = config.headcount;
    input.headcount = config.headcount;
  }
  return input;
}

// ─── Normalising what comes back ───────────────────────────────────────────

// One clinic, in the shape a DiscoveryCandidate is written from. Every field
// but the name may be unknown, which is the whole point of this pathway: a
// clinic with no website and nobody named is still a clinic worth scoring.
export interface ClinicCandidate {
  clinicName: string;
  websiteUrl: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  companyLinkedinUrl: string | null;
  facebookUrl: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  contactTitle: string | null;
  linkedinUrl: string | null; // the contact's own profile, if one came with it
  sourceQuery: string;
}

// Which flattened key holds what. Matched on the last path segment, lowercased
// and stripped of separators, so "placeName", "place_name" and
// "result.placeName" all read as the same field — actors differ in casing and
// nesting far more than they differ in vocabulary.
//
// Order matters: the first key on a list that has a value wins, so the more
// specific name is listed before the vaguer one.
const FIELD_ALIASES: Record<keyof Omit<ClinicCandidate, "sourceQuery">, string[]> = {
  clinicName: ["clinicname", "companyname", "businessname", "placename", "title", "name"],
  websiteUrl: ["website", "websiteurl", "url", "domain", "companywebsite", "site"],
  location: ["address", "fulladdress", "formattedaddress", "location", "addressline"],
  city: ["city", "locality", "town"],
  state: ["state", "region", "administrativearea", "stateprovince"],
  country: ["country", "countrycode", "countryname"],
  companyLinkedinUrl: ["companylinkedinurl", "linkedin", "linkedinurl", "companylinkedin"],
  facebookUrl: ["facebookurl", "facebook", "facebookpage"],
  phone: ["phone", "phonenumber", "telephone", "phoneunformatted", "mobile"],
  email: ["email", "emailaddress", "contactemail"],
  contactName: ["contactname", "ownername", "decisionmakername", "personname"],
  contactTitle: ["contacttitle", "jobtitle", "title2", "position", "role"],
  linkedinUrl: ["contactlinkedinurl", "personlinkedinurl", "profileurl"],
};

// A field name as this module compares them: last segment, lowercased, with
// every separator removed.
function fieldKey(header: string): string {
  const leaf = header.slice(header.lastIndexOf(".") + 1);
  return leaf.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// One dataset item, as a row of the table src/lib/apify.ts already flattens
// actor output into. Headers are the flattened paths; cells are strings.
export interface ClinicSearchRow {
  headers: string[];
  cells: string[];
}

// Reads one row into a clinic, or null when there is no name in it — a
// candidate with no clinic name is the one thing this pathway cannot make.
//
// Nothing here invents anything. A field with no value stays null, including
// every contact field: "unknown" is the honest state for a decision-maker
// nobody has looked for yet, and a blank person on the record would read as a
// person who exists.
export function normalizeClinicRow(
  row: ClinicSearchRow,
  sourceQuery: string,
): ClinicCandidate | null {
  const byKey = new Map<string, string>();
  row.headers.forEach((header, i) => {
    const value = (row.cells[i] ?? "").trim();
    if (value === "") return;
    const key = fieldKey(header);
    // First one wins, so a top-level "website" is not overwritten by a nested
    // "socials.website" further down the same item.
    if (!byKey.has(key)) byKey.set(key, value);
  });

  const read = (field: keyof typeof FIELD_ALIASES): string | null => {
    for (const alias of FIELD_ALIASES[field]) {
      const value = byKey.get(alias);
      if (value !== undefined && value !== "") return value;
    }
    return null;
  };

  const clinicName = read("clinicName");
  if (clinicName === null) return null;

  const city = read("city");
  const state = read("state");
  const country = read("country");
  // The address if the actor gave one, otherwise the parts of it that did come
  // back — the enrichment chain searches Maps on "name + location", and
  // "Austin, TX" is a good deal better for that than nothing.
  const location = read("location") ?? joinPlace(city, state, country);

  return {
    clinicName,
    websiteUrl: readUrl(read("websiteUrl")),
    location,
    city,
    state,
    country,
    companyLinkedinUrl: readUrl(read("companyLinkedinUrl")),
    facebookUrl: readUrl(read("facebookUrl")),
    phone: read("phone"),
    email: read("email"),
    contactName: read("contactName"),
    contactTitle: read("contactTitle"),
    linkedinUrl: readUrl(read("linkedinUrl")),
    sourceQuery,
  };
}

function joinPlace(...parts: (string | null)[]): string | null {
  const joined = parts.filter((p) => p !== null && p !== "").join(", ");
  return joined === "" ? null : joined;
}

// A URL as it will be stored, or null. Actors report these as anything from a
// bare domain to a tracking link; what the enrichment chain needs is something
// fetchable, so a bare domain gains a scheme and anything that is not a web
// address at all is dropped rather than stored for an actor to choke on.
export function readUrl(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || !/[a-z0-9]\.[a-z]{2,}/i.test(trimmed)) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
