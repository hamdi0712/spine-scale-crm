// Decision-maker enrichment — who to talk to at a clinic that has qualified.
//
// The clinic-first pathway finds clinics before it finds people, so a
// candidate can clear the promotion bar with nobody named at it and stop at
// QUALIFIED_NO_CONTACT. This is the stage that goes and looks — and it is a
// stage of its own rather than a sixth step in the enrichment chain, for two
// reasons that between them describe the whole design:
//
//   It runs only on a candidate that has already qualified. Looking for the
//   owner of a clinic that is about to be rejected is money spent on a person
//   nobody will ever contact, so the gate is the score, not the import.
//
//   It is retried on its own. Nothing here re-runs the company lookup, Maps,
//   the ads library or the crawler — it reads what those already wrote and
//   spends at most one profile search and one Google search. "Try again" costs
//   one stage, not six.
//
// The rule underneath all of it is that unknown beats wrong. A doctor working
// at a clinic is not the clinic's owner, and a CRM that recorded him as one
// would be inventing the single fact the outreach depends on. So every
// identification carries the evidence behind it and a confidence that says how
// much that evidence is worth, and a stage that finds nobody says so.
//
// Pure: no network, no database. src/lib/actions/decisionMaker.ts does the
// running, and the actor it runs is a setting.

// ─── Status ────────────────────────────────────────────────────────────────

// Deliberately a separate field from the candidate's status rather than more
// values in it. Where a candidate is in the queue and how the search for a
// person went are two questions, and a single enum answering both would make
// "qualified, searched, nobody found" unrepresentable.
export const DECISION_MAKER_STATUSES = [
  "not_started",
  "searching",
  "found",
  "not_found",
  "failed",
  "manually_added",
] as const;

export type DecisionMakerStatus = (typeof DECISION_MAKER_STATUSES)[number];

export const DECISION_MAKER_STATUS_LABELS: Record<DecisionMakerStatus, string> = {
  not_started: "Not searched",
  searching: "Searching",
  found: "Found",
  not_found: "Not found",
  failed: "Search failed",
  manually_added: "Added by hand",
};

export const DECISION_MAKER_STATUS_MEANINGS: Record<DecisionMakerStatus, string> = {
  not_started: "Nobody has looked for a decision maker at this clinic yet",
  searching: "A search has this one right now — or had it when the tab was closed",
  found: "Somebody was identified, with the evidence and confidence kept",
  not_found:
    "The search ran and turned up nobody who could be verified against this clinic — it can be run again, or a name added by hand",
  failed: "The actor or the search failed outright, so nothing was concluded",
  manually_added: "A decision maker somebody entered or chose by hand",
};

export function isDecisionMakerStatus(v: unknown): v is DecisionMakerStatus {
  return (
    typeof v === "string" &&
    (DECISION_MAKER_STATUSES as readonly string[]).includes(v)
  );
}

export function readDecisionMakerStatus(v: unknown): DecisionMakerStatus {
  return isDecisionMakerStatus(v) ? v : "not_started";
}

// ─── Confidence ────────────────────────────────────────────────────────────

export const DECISION_MAKER_CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

export type DecisionMakerConfidence = (typeof DECISION_MAKER_CONFIDENCE)[number];

export const CONFIDENCE_LABELS: Record<DecisionMakerConfidence, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};

// What each level is claiming, in the one line the UI shows on hover. Worded
// as what the evidence says rather than as how sure the app feels, because the
// second is not a thing software can have.
export const CONFIDENCE_MEANINGS: Record<DecisionMakerConfidence, string> = {
  HIGH: "The clinic's own site states the relationship — “John Smith, Founder” on a team or about page",
  MEDIUM: "A profile states it — “Owner at Elite Spine & Rehab” on LinkedIn",
  LOW: "This person is associated with the clinic, but nothing found says they decide anything",
  UNKNOWN: "Somebody entered this by hand, or the source said nothing about the role",
};

const CONFIDENCE_RANK: Record<DecisionMakerConfidence, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNKNOWN: 0,
};

export function isDecisionMakerConfidence(v: unknown): v is DecisionMakerConfidence {
  return (
    typeof v === "string" &&
    (DECISION_MAKER_CONFIDENCE as readonly string[]).includes(v)
  );
}

// ─── Titles ────────────────────────────────────────────────────────────────

// Who decides, in the order they decide. Tier 1 owns the clinic, tier 2 runs
// it, tier 3 runs the office. The practitioner tier is last and is a fallback
// rather than a finding: plenty of these clinics are owner-operated and the
// doctor really is the buyer, but plenty of others employ six of them — so a
// practitioner is recorded as a person at the clinic, at low confidence,
// rather than as its owner.
export const TITLE_TIERS: { tier: 1 | 2 | 3 | 4; label: string; titles: string[] }[] = [
  {
    tier: 1,
    label: "Owner",
    titles: ["owner", "founder", "co-founder", "cofounder", "ceo", "chief executive", "president"],
  },
  {
    tier: 2,
    label: "Director",
    titles: [
      "medical director",
      "clinic director",
      "practice director",
      "practice owner",
      "managing director",
      "managing partner",
    ],
  },
  {
    tier: 3,
    label: "Manager",
    titles: ["practice manager", "office manager", "operations director", "operations manager"],
  },
  {
    tier: 4,
    label: "Practitioner",
    titles: [
      "doctor",
      "physician",
      "chiropractor",
      "physical therapist",
      "physiotherapist",
      "provider",
      "dc",
      "dpt",
      "md",
      "do",
    ],
  },
];

// The tier a title falls in, or null for a title that says nothing about
// authority — "receptionist", "marketing coordinator", or a job description
// this list has never heard of. Null is a person the stage will not put
// forward on their own.
export function titleTier(title: string | null | undefined): 1 | 2 | 3 | 4 | null {
  const text = (title ?? "").toLowerCase();
  if (text.trim() === "") return null;
  for (const group of TITLE_TIERS) {
    for (const t of group.titles) {
      // Word-bounded so "do" does not match "doctor of nothing in particular"
      // and "md" does not match "mdesign".
      const pattern = new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
      if (pattern.test(text)) return group.tier;
    }
  }
  return null;
}

// ─── Where a person came from ──────────────────────────────────────────────

// The evidence hierarchy, strongest first. It is an ordering of *sources*, and
// the confidence a finding carries is a function of the source and the title
// together — a founder named on the clinic's own site is the strongest thing
// this stage can find, and the same name scraped off a directory is not.
export const EVIDENCE_SOURCES = [
  "website",
  "linkedin",
  "search",
  "maps",
  "manual",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  website: "Clinic website",
  linkedin: "LinkedIn",
  search: "Google search",
  maps: "Google Maps",
  manual: "Entered by hand",
};

// The confidence a finding is worth, from where it came and what it said.
//
// The two rules that matter: a source that states the relationship in the
// clinic's own words is High and nothing else is; a practitioner title is
// never more than Low however it was found, because "a chiropractor works
// here" is not evidence about who signs anything.
export function confidenceFor(
  source: EvidenceSource,
  title: string | null | undefined,
): DecisionMakerConfidence {
  const tier = titleTier(title);
  if (source === "manual") return "UNKNOWN";
  if (tier === null) return "LOW";
  if (tier === 4) return "LOW";
  if (source === "website") return "HIGH";
  if (source === "linkedin") return "MEDIUM";
  // A search result or a Maps listing that names a role is worth something,
  // but nobody has read the page it came from — so it sits a level below the
  // profile that states it.
  return "LOW";
}

// ─── A person this stage might put forward ─────────────────────────────────

export interface DecisionMakerCandidate {
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  // Instagram, a personal site, a professional directory — whatever came back
  // that is a public profile and is not already a column of its own.
  socialUrls: string[];
  source: EvidenceSource;
  confidence: DecisionMakerConfidence;
  // The sentence behind the confidence, in the words of whatever established
  // it. Shown to the person deciding whether to believe it.
  evidence: string;
}

// Ranks two findings: confidence first, then the title tier, then whether
// there is a LinkedIn URL to go on. Highest first, so a list sorted by this
// puts the one to put forward at the top and leaves the rest as alternates.
export function compareCandidates(
  a: DecisionMakerCandidate,
  b: DecisionMakerCandidate,
): number {
  const byConfidence = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
  if (byConfidence !== 0) return byConfidence;
  const byTier = (titleTier(a.title) ?? 9) - (titleTier(b.title) ?? 9);
  if (byTier !== 0) return byTier;
  return Number(b.linkedinUrl !== null) - Number(a.linkedinUrl !== null);
}

// The findings worth showing, best first and one entry per person.
//
// Nothing is thrown away for being weak — a Low-confidence practitioner is
// still the only name anybody has, and the page shows it as exactly that. What
// is thrown away is a second sighting of the same person, so a name found on
// the website and again on LinkedIn appears once, under whichever sighting was
// worth more.
export function rankCandidates(
  candidates: DecisionMakerCandidate[],
): DecisionMakerCandidate[] {
  const sorted = [...candidates].sort(compareCandidates);
  const out: DecisionMakerCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of sorted) {
    const key = personKey(candidate.name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

// A person's name as two spellings of it have in common: case, punctuation,
// and the honorifics one source keeps and the other drops.
const HONORIFICS = new Set(["dr", "dr.", "doctor", "mr", "mrs", "ms", "prof", "professor"]);
const NAME_SUFFIXES = new Set(["dc", "dpt", "md", "do", "pt", "phd", "cscs", "ms", "jr", "sr", "ii", "iii"]);

export function personKey(raw: string | null | undefined): string {
  return nameWords(raw).join(" ");
}

function nameWords(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z\s.'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[.']/g, ""))
    .filter((w) => w !== "" && !HONORIFICS.has(w) && !NAME_SUFFIXES.has(w));
}

// First and last, off a whole name. Both null when the name is a single word —
// "Dr Smith" has a last name and no first, and guessing which half is missing
// would put a wrong first name on an outreach message.
export function splitName(raw: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = (raw ?? "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w !== "" && !HONORIFICS.has(w.toLowerCase().replace(/[.']/g, "")));
  const kept = parts.filter(
    (w) => !NAME_SUFFIXES.has(w.toLowerCase().replace(/[.,']/g, "")),
  );
  if (kept.length < 2) return { firstName: null, lastName: null };
  return { firstName: kept[0], lastName: kept[kept.length - 1] };
}

// Whether a string reads as a person's name at all: two to four words, letters
// only, none of them a word that belongs to a clinic rather than a person.
// It is the guard on everything scraped out of prose below — "Spinal
// Decompression Therapy" is three capitalised words and is not a person.
const NOT_A_PERSON_WORDS = [
  "clinic", "center", "centre", "spine", "chiropractic", "therapy", "health",
  "wellness", "medical", "rehab", "institute", "group", "associates", "care",
  "physical", "decompression", "disc", "treatment", "pain", "team", "staff",
  "meet", "our", "about", "contact", "services", "patients", "appointment",
];

export function looksLikePersonName(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 4 || trimmed.length > 60) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (!/^[A-Za-z.'\- ]+$/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (NOT_A_PERSON_WORDS.some((w) => new RegExp(`(^|\\s)${w}(\\s|$)`).test(lower))) {
    return false;
  }
  // At least two words that start with a capital: a name is written the way a
  // name is written, and lowercase prose that happens to be two words long is
  // not one.
  return words.filter((w) => /^[A-Z]/.test(w)).length >= 2;
}

// ─── 1. The clinic's own website ───────────────────────────────────────────

// The strongest evidence there is, and it costs nothing: the website crawler
// has already run, and its copy is sitting on the candidate as websiteNotes.
// A team or about page written by the clinic says "Dr John Smith, Founder" in
// so many words, which is the one thing no amount of searching can improve on.
//
// Two shapes are read, because both are how these pages are written:
// "Name, Title" / "Name — Title", and "Title: Name". Anything else is left
// alone rather than guessed at — this function returning nothing is a normal
// outcome and the stage has three more places to look.
export function peopleFromWebsiteNotes(
  notes: string | null | undefined,
): DecisionMakerCandidate[] {
  const text = (notes ?? "").replace(/\r/g, "");
  if (text.trim() === "") return [];

  const found: DecisionMakerCandidate[] = [];
  // Case-insensitive per letter rather than a case-insensitive regex: the name
  // half of these patterns depends on capitals to tell a person from prose, so
  // the whole expression cannot be given the i flag. "founder" becomes
  // [fF][oO][uU]… and matches "Founder" without loosening anything else.
  const titleWords = TITLE_TIERS.flatMap((g) => g.titles)
    .filter((t) => t.length > 2)
    .map((t) =>
      t
        .split("")
        .map((ch) =>
          /[a-z]/.test(ch)
            ? `[${ch}${ch.toUpperCase()}]`
            : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join(""),
    )
    .join("|");

  // One word of a name: an honorific with its full stop ("Dr.", "Mr."), or an
  // ordinary capitalised word without one. Keeping the full stop out of the
  // long form is what stops a match running backwards over a sentence
  // boundary — "Meet our team. Dr John Smith" is one name, not four words of
  // the sentence before it.
  const NAME_WORD = "(?:[A-Z][a-z]{0,2}\\.|[A-Z][A-Za-z'\u2019-]{1,20})";
  const NAME = `(${NAME_WORD}(?:\\s+${NAME_WORD}){1,3})`;

  // "John Smith, Founder" / "Dr. John Smith — Medical Director"
  const nameFirst = new RegExp(
    `${NAME}\\s*[,\\u2013\\u2014|-]\\s*((?:${titleWords})[A-Za-z /&-]{0,30})`,
    "g",
  );
  // "Founder: John Smith" / "Owner - Dr John Smith"
  const titleFirst = new RegExp(
    `((?:${titleWords})[A-Za-z /&-]{0,30})\\s*[:\\u2013\\u2014|-]\\s*${NAME}`,
    "g",
  );

  for (const [pattern, nameGroup, titleGroup] of [
    [nameFirst, 1, 2] as const,
    [titleFirst, 2, 1] as const,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[nameGroup].trim();
      const title = match[titleGroup].trim().replace(/\s+/g, " ");
      if (!looksLikePersonName(name)) continue;
      if (titleTier(title) === null) continue;
      found.push(
        person({
          name,
          title,
          source: "website",
          evidence: `Clinic website — “${name}${title ? `, ${title}` : ""}”, read from the page the crawler already had.`,
        }),
      );
      if (found.length >= 8) break;
    }
  }
  return rankCandidates(found);
}

// ─── 2. The profile search ─────────────────────────────────────────────────

// What the configured actor is asked, and it is asked about *this clinic*.
//
// Never a bare "owner" or "founder": a search that is not anchored to the
// clinic returns the owners of other clinics, and a name is worse than useless
// if it belongs to somebody else's practice. Every field here carries the
// clinic name, and the titles narrow it rather than defining it.
//
// The same alias-spreading the clinic-first search uses, and for the same
// reason: which actor is configured is a setting, actors disagree about what
// they call their inputs, and a spare key costs nothing while a missing one
// costs a run that returns nothing.
export const DECISION_MAKER_TITLES_SEARCHED = [
  "Owner",
  "Founder",
  "CEO",
  "President",
  "Medical Director",
  "Clinic Director",
  "Practice Manager",
];

export function profileSearchInput(
  clinicName: string,
  location: string | null | undefined,
  maxResults: number,
): Record<string, unknown> {
  const anchored = `"${clinicName}" ${DECISION_MAKER_TITLES_SEARCHED.slice(0, 4).join(" OR ")}`;
  return {
    // harvestapi/linkedin-profile-search and its siblings take the company as
    // a list and the titles as another; the free-text keys are for the search
    // scrapers that take a query instead.
    currentCompanies: [clinicName],
    companyNames: [clinicName],
    companyName: clinicName,
    jobTitles: DECISION_MAKER_TITLES_SEARCHED,
    title: DECISION_MAKER_TITLES_SEARCHED.join(" OR "),
    search: anchored,
    searchQuery: anchored,
    query: anchored,
    queries: anchored,
    ...(location ? { location, locations: [location] } : {}),
    maxItems: maxResults,
    maxResults,
    profileScraperMode: "Short",
  };
}

// One row of whatever the actor returned, read as a person — or null when
// there is no name in it, or when the row is about somebody at a different
// clinic.
//
// The clinic check is the important half. A profile search anchored to a
// clinic still returns near-matches, and taking one of those would attach the
// owner of another practice to this record. So a row is only accepted if the
// company it names matches the clinic being searched for, or if the row names
// no company at all and the search itself was anchored.
export interface ProfileRow {
  headers: string[];
  cells: string[];
}

const PROFILE_ALIASES = {
  name: ["fullname", "name", "profilename", "displayname"],
  firstName: ["firstname", "givenname"],
  lastName: ["lastname", "surname", "familyname"],
  title: ["headline", "jobtitle", "title", "position", "currentposition", "occupation"],
  linkedinUrl: ["profileurl", "linkedinurl", "url", "publicprofileurl", "link"],
  email: ["email", "emailaddress", "workemail"],
  phone: ["phone", "phonenumber", "mobile"],
  company: ["companyname", "currentcompany", "company", "organization", "employer"],
  instagram: ["instagram", "instagramurl"],
  website: ["website", "personalwebsite", "websiteurl"],
} as const;

export function normalizeProfileRow(
  row: ProfileRow,
  clinicName: string,
): DecisionMakerCandidate | null {
  const byKey = new Map<string, string>();
  row.headers.forEach((header, i) => {
    const value = (row.cells[i] ?? "").trim();
    if (value === "") return;
    const leaf = header.slice(header.lastIndexOf(".") + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!byKey.has(leaf)) byKey.set(leaf, value);
  });
  const read = (field: keyof typeof PROFILE_ALIASES): string | null => {
    for (const alias of PROFILE_ALIASES[field]) {
      const value = byKey.get(alias);
      if (value !== undefined && value !== "") return value;
    }
    return null;
  };

  const first = read("firstName");
  const last = read("lastName");
  const name = read("name") ?? [first, last].filter(Boolean).join(" ");
  if (name.trim() === "" || !looksLikePersonName(name)) return null;

  // Somebody at another clinic of a similar name is not this clinic's owner.
  const company = read("company");
  if (company !== null && !companiesMatch(company, clinicName)) return null;

  const title = read("title");
  const socials = [read("instagram"), read("website")].filter(
    (u): u is string => typeof u === "string" && u.trim() !== "",
  );

  return person({
    name: name.trim(),
    title,
    linkedinUrl: read("linkedinUrl"),
    email: read("email"),
    phone: read("phone"),
    socialUrls: socials,
    source: "linkedin",
    evidence:
      title === null
        ? `LinkedIn profile search anchored to “${clinicName}” returned this profile, which states no role.`
        : `LinkedIn — “${name.trim()}, ${title}”${company ? ` at ${company}` : ""}.`,
  });
}

// Whether the company on a profile is the clinic being searched for. The same
// flattening the duplicate test uses on clinic names, then a containment check
// either way round: "Elite Spine" on a profile and "Elite Spine & Rehab" on
// the record are the same practice, and neither is "Denver Spine".
export function companiesMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(the|inc|llc|pllc|pc|pa|ltd|co|corp|and)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (x === "" || y === "") return false;
  return x === y || x.includes(y) || y.includes(x);
}

// ─── 3. The anchored Google search ─────────────────────────────────────────

// The queries, and every one of them names the clinic. This is the list the
// brief asks for, in the order it is worth running: ownership first, the roles
// that run the place next, then the two catch-alls.
export function decisionMakerQueries(
  clinicName: string,
  location?: string | null,
): string[] {
  const clinic = `"${clinicName.replace(/"/g, "").trim()}"`;
  const where = (location ?? "").trim();
  const suffix = where === "" ? "" : ` ${where}`;
  return [
    `${clinic} owner${suffix}`,
    `${clinic} founder${suffix}`,
    `${clinic} "medical director"${suffix}`,
    `${clinic} "clinic director"${suffix}`,
    `${clinic} "practice manager"${suffix}`,
    `${clinic} LinkedIn${suffix}`,
    `${clinic} doctor${suffix}`,
  ];
}

// How many of those queries one attempt is allowed to run. Each is a billed
// search, and the answer is in the first few or it is not there — the rest of
// the queries exist for the retry, which starts from the top again with
// whatever the crawler has learned since.
export const MAX_SEARCH_QUERIES = 3;

// A LinkedIn personal profile out of a list of search results, with the name
// read off the URL slug. It is the weakest thing this stage will accept and it
// is accepted for one reason: a linkedin.com/in/ URL anchored to a clinic
// search is a real person associated with that clinic, which is a lead worth
// having as long as nothing pretends it is more than that.
export function profileUrlsFromResults(urls: string[]): string[] {
  return urls.filter((url) => {
    try {
      const parsed = new URL(url);
      return (
        /(^|\.)linkedin\.com$/i.test(parsed.hostname) &&
        /^\/in\/[^/]+\/?$/i.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  });
}

// "https://www.linkedin.com/in/john-smith-dc-1a2b3c" → "John Smith". The
// trailing hash is dropped, the honorific letters with it. Null when the slug
// carries nothing that reads as a name — a numeric or single-word slug is a
// profile nobody can name from the URL alone, and a made-up name is exactly
// what this module exists not to produce.
export function nameFromProfileUrl(url: string): string | null {
  let slug: string;
  try {
    slug = new URL(url).pathname.replace(/^\/in\//i, "").replace(/\/+$/, "");
  } catch {
    return null;
  }
  const words = slug
    .split("-")
    .filter((w) => w !== "" && !/\d/.test(w) && !NAME_SUFFIXES.has(w.toLowerCase()));
  if (words.length < 2) return null;
  const name = words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return looksLikePersonName(name) ? name : null;
}

// ─── Building one ──────────────────────────────────────────────────────────

// Every candidate this module produces goes through here, so the confidence is
// never set by hand at a call site and the name is always split the same way.
export function person(args: {
  name: string;
  title?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  socialUrls?: string[];
  source: EvidenceSource;
  evidence: string;
  // Only the manual path sets this: a person somebody chose is carried at
  // whatever the finding was worth, not re-derived.
  confidence?: DecisionMakerConfidence;
}): DecisionMakerCandidate {
  const name = args.name.trim().replace(/\s+/g, " ");
  const { firstName, lastName } = splitName(name);
  return {
    name,
    firstName,
    lastName,
    title: blank(args.title),
    linkedinUrl: blank(args.linkedinUrl),
    email: blank(args.email),
    phone: blank(args.phone),
    socialUrls: (args.socialUrls ?? []).filter((u) => u.trim() !== ""),
    source: args.source,
    confidence: args.confidence ?? confidenceFor(args.source, args.title),
    evidence: args.evidence,
  };
}

function blank(v: string | null | undefined): string | null {
  const trimmed = (v ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

// ─── The log ───────────────────────────────────────────────────────────────

// One entry per attempt, and enough of it to debug a run that found nobody:
// what was searched, with which actor, how many results came back, who was
// picked, and any error in the actor's own words. A stage that quietly found
// nothing is a stage nobody can fix.
export interface DecisionMakerAttempt {
  at: string; // ISO
  clinicName: string;
  steps: {
    source: EvidenceSource;
    // The query or the input summary — what was actually asked.
    query: string;
    actorId: string | null;
    results: number;
    error: string | null;
  }[];
  // Who came out of it, or null when nothing verifiable did.
  selected: {
    name: string;
    title: string | null;
    confidence: DecisionMakerConfidence;
    source: EvidenceSource;
  } | null;
  // Everybody else worth showing, by name, so the log says what the choice was
  // made against.
  alternates: string[];
}

export function serializeAttempts(attempts: DecisionMakerAttempt[]): string {
  // Newest first, and capped: a log is for debugging the last run or two, not
  // an audit trail of every press of a button.
  return JSON.stringify(attempts.slice(0, 10));
}

// Never throws, on any input — a row written by an older shape, a hand-edited
// database, or nothing at all reads as no attempts rather than as an error on
// a page that was only trying to show a name.
export function parseDecisionMakerLog(raw: string | null | undefined): DecisionMakerAttempt[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DecisionMakerAttempt[] = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    out.push({
      at: typeof record.at === "string" ? record.at : "",
      clinicName: typeof record.clinicName === "string" ? record.clinicName : "",
      steps: Array.isArray(record.steps)
        ? record.steps.flatMap((step) => {
            if (step === null || typeof step !== "object") return [];
            const s = step as Record<string, unknown>;
            return [
              {
                source: (EVIDENCE_SOURCES as readonly string[]).includes(s.source as string)
                  ? (s.source as EvidenceSource)
                  : "search",
                query: typeof s.query === "string" ? s.query : "",
                actorId: typeof s.actorId === "string" ? s.actorId : null,
                results: typeof s.results === "number" ? s.results : 0,
                error: typeof s.error === "string" ? s.error : null,
              },
            ];
          })
        : [],
      selected:
        record.selected !== null && typeof record.selected === "object"
          ? {
              name: String((record.selected as Record<string, unknown>).name ?? ""),
              title:
                typeof (record.selected as Record<string, unknown>).title === "string"
                  ? ((record.selected as Record<string, unknown>).title as string)
                  : null,
              confidence: isDecisionMakerConfidence(
                (record.selected as Record<string, unknown>).confidence,
              )
                ? ((record.selected as Record<string, unknown>).confidence as DecisionMakerConfidence)
                : "UNKNOWN",
              source: (EVIDENCE_SOURCES as readonly string[]).includes(
                (record.selected as Record<string, unknown>).source as string,
              )
                ? ((record.selected as Record<string, unknown>).source as EvidenceSource)
                : "search",
            }
          : null,
      alternates: Array.isArray(record.alternates)
        ? record.alternates.filter((a): a is string => typeof a === "string")
        : [],
    });
  }
  return out;
}

// ─── Social URLs on the record ─────────────────────────────────────────────

// Stored as a JSON list in one column, because which profiles a person has is
// their business rather than the schema's. Both readers never throw: a column
// holding something else reads as no socials.
export function serializeSocialUrls(urls: string[]): string | null {
  const cleaned = Array.from(
    new Set(urls.map((u) => u.trim()).filter((u) => u !== "")),
  ).slice(0, 8);
  return cleaned.length === 0 ? null : JSON.stringify(cleaned);
}

export function parseSocialUrls(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((u): u is string => typeof u === "string" && u.trim() !== "")
      : [];
  } catch {
    // A hand-typed column of one URL is a reasonable thing to find here.
    return raw.trim().startsWith("http") ? [raw.trim()] : [];
  }
}

// Whether this candidate already has somebody to talk to. The stage refuses to
// run on one that does — re-searching for a person who is already named would
// spend a run to arrive at a name that is already on the record, and risks
// replacing somebody's own entry with a scrape.
export function hasDecisionMaker(candidate: {
  contactName: string | null | undefined;
}): boolean {
  return (candidate.contactName ?? "").trim() !== "";
}
