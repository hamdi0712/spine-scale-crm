// Decision-maker enrichment — who to talk to at a clinic that has qualified.
//
// The clinic-first pathway finds clinics before it finds people, so a clinic
// can arrive with nobody named at it. This is the stage that goes and looks,
// and it follows one procedure, in this order:
//
//   1-2. Read the website copy the crawler already stored and have DeepSeek
//        pull out any named individual on it — a doctor, an owner, anyone who
//        reads as staff. A bare name counts. A stated role is context, not a
//        requirement, because most clinic sites simply list their people.
//   3-4. Search that name exactly as it was written, in quotes, against the
//        clinic's name: "[name]" "[clinic]" LinkedIn.
//   5.   Take the first result that is a linkedin.com/in/ profile.
//   6.   Have DeepSeek check the result's own visible text against the clinic
//        and the name, to tell this person from a stranger who shares a name.
//   7.   Write the name, the profile URL and a confidence onto the record.
//
// And when the site names nobody at all, and only then, a second tier: the
// clinic-anchored owner/founder/director searches, which are a guess about who
// runs the place rather than a search for somebody the site named.
//
// Two rules run through all of it. Verification lowers confidence rather than
// rejecting — a plausible match nobody can prove is worth more than an empty
// field, as long as the record says which it is holding. And the stage is
// retried on its own: nothing here re-runs the company lookup, Maps, the ads
// library or the crawler, so "try again" costs one stage rather than six.
//
// Pure: no network, no database. src/lib/actions/decisionMaker.ts does the
// running, and the actor it runs is a setting.

import { GoogleSearchEntry } from "@/lib/googleSearch";

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
  HIGH: "The clinic named this person and the profile found for them names the clinic back",
  MEDIUM: "The clinic named this person, and the profile agrees on their profession or their town",
  LOW: "A plausible match nothing has confirmed — worth a glance before it is used",
  UNKNOWN: "Somebody entered this by hand, or nothing found said anything about them",
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
  // The procedure this stage actually runs: a name read off the clinic's own
  // site, searched for by that exact text, and verified against the result.
  // Its own source rather than "website" or "search" because it is neither —
  // the website said the name and the search said the profile, and a log that
  // called it either one would be describing half of what happened.
  "name_search",
  "linkedin",
  "search",
  "maps",
  "manual",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  website: "Clinic website",
  name_search: "Name from the website, found on LinkedIn",
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
  // The name-search path never derives its confidence from a title. What that
  // finding is worth is what the verification in step six said it was worth,
  // and it is passed in rather than re-guessed from words on a profile.
  if (source === "name_search") return "LOW";
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

// ─── 1. The name on the clinic's own website ───────────────────────────────
//
// Step one of the procedure, and the only step that costs nothing: the website
// crawler has already run and its copy is sitting on the candidate as
// websiteNotes, so this reads what is there rather than fetching it again.
//
// What it is looking for is *a named individual* — a doctor, an owner, anyone
// who reads as staff. Deliberately not "a name with a role next to it". A team
// page that says "Dr. Elena Marsh" and nothing else has told us who to search
// for, and the old rule — which threw that away because no title followed it —
// was discarding the single most common shape these pages come in. Whatever
// role context happens to sit near the name is carried along as context, and
// its absence is not a reason to drop the name.
//
// The extraction is DeepSeek's rather than a regular expression's for the same
// reason: prose names a person in more ways than a pattern can enumerate.

// The system half, stated once. "json" appears in it because deepSeekJson
// pins the reply to an object and DeepSeek refuses that request unless the
// word is in the prompt — see src/lib/deepseek.ts.
export const WEBSITE_NAME_SYSTEM_PROMPT = [
  "You read the copy crawled from a medical or chiropractic clinic's website and pull out the people named on it.",
  "A person counts if they are named and appear to be a doctor, an owner, or any member of staff at the clinic.",
  "A name on its own counts. Do NOT require a role or title to be stated next to it — most clinic sites simply list people.",
  "Return each name EXACTLY as it appears in the text, character for character, including any honorific or letters after it.",
  "Do not invent, correct, complete or reformat a name. Do not return patients, testimonial authors, brand names, treatment names, or the clinic's own name.",
  "Reply with json only.",
].join(" ");

// How much crawled copy one extraction reads. The people on a clinic site are
// named on its team and about pages, which the crawler puts near the top of
// what it stores; past this is footer text and treatment descriptions, and
// every character of it is billed.
export const MAX_WEBSITE_NOTE_CHARS = 6000;

export function websiteNamePrompt(clinicName: string, notes: string | null | undefined): string {
  const text = (notes ?? "").replace(/\r/g, "").trim().slice(0, MAX_WEBSITE_NOTE_CHARS);
  return [
    `CLINIC: ${clinicName}`,
    "",
    "WEBSITE COPY:",
    text,
    "",
    "REPLY FORMAT — json, and nothing else:",
    '{"people":[{"name":"exactly as written in the copy","roleContext":"the words near the name that suggest what they do, or null"}]}',
    "",
    "Order them by how likely each is to be the person who decides things at this clinic. An empty list is a correct answer when the copy names nobody.",
  ].join("\n");
}

// One name the model found, before anything has been searched for it.
export interface ExtractedName {
  // Verbatim, because step 3 searches this string in quotes. Trimming
  // whitespace is the only thing done to it.
  name: string;
  // Whatever the copy said around the name — often nothing, and nothing is a
  // perfectly good answer here rather than a reason to discard the name.
  roleContext: string | null;
}

// How many extracted names one attempt will search. Each is a billed search,
// and a clinic's decider is at the top of the list or the list was the wrong
// list — the rest are there for the retry.
export const MAX_NAMES_SEARCHED = 3;

// The model's reply as names, never throwing on anything it might have said.
// A name that does not read as a person's name is dropped: the model is asked
// for exact text and a treatment heading returned as a person would otherwise
// be searched for, in quotes, at this clinic's expense.
export function readExtractedNames(content: string): ExtractedName[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const list = (parsed as Record<string, unknown> | null)?.["people"];
  if (!Array.isArray(list)) return [];

  const out: ExtractedName[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim().replace(/\s+/g, " ") : "";
    if (name === "" || !looksLikePersonName(name)) continue;
    const key = personKey(name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const context =
      typeof record.roleContext === "string" && record.roleContext.trim() !== ""
        ? record.roleContext.trim().replace(/\s+/g, " ").slice(0, 160)
        : null;
    out.push({ name, roleContext: context });
    if (out.length >= 8) break;
  }
  return out;
}

// ─── 2. The search for that exact name ─────────────────────────────────────

// Steps three and four: the extracted text, verbatim and in quotes, against
// the clinic's name, on LinkedIn. Both halves are quoted so the search is for
// this person at this clinic rather than for either word anywhere — a bare
// name search returns every namesake in the country, which is precisely the
// mistake step six exists to catch and is cheaper not to make.
//
// The only edit made to either string is dropping the quote characters inside
// it, which would otherwise close the quoting early and change what is asked.
export function nameLinkedinQuery(name: string, clinicName: string): string {
  const quoted = (raw: string) => `"${raw.replace(/["“”]/g, "").trim()}"`;
  return `${quoted(name)} ${quoted(clinicName)} LinkedIn`;
}

// ─── 3. The profile out of the results ─────────────────────────────────────

// Step five: the first result that is a personal LinkedIn profile. "First"
// literally — Google has already ranked them and a quoted two-term search that
// puts a profile at the top has said something the app should not second-guess
// by preferring a later one.
export function firstLinkedinProfile(entries: GoogleSearchEntry[]): GoogleSearchEntry | null {
  for (const entry of entries) {
    if (isLinkedinProfileUrl(entry.url)) return entry;
  }
  return null;
}

export function isLinkedinProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)linkedin\.com$/i.test(parsed.hostname) &&
      /^\/in\/[^/]+\/?$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

// A LinkedIn personal profile out of a list of result links. Kept because the
// fallback tier below has only links to work with.
export function profileUrlsFromResults(urls: string[]): string[] {
  return urls.filter(isLinkedinProfileUrl);
}

// ─── 4. Verifying that it is the same person ───────────────────────────────
//
// Step six, and the reason the search may be trusted at all: a quoted search
// can still return a profile for somebody who shares the name, so the visible
// text of the result is checked against the clinic and the extracted name
// before anything is written down.
//
// The bar is deliberately not "prove it". A profile that plausibly belongs to
// this person at this clinic but does not say so outright is kept at a lower
// confidence rather than thrown away — an uncertain name somebody can check in
// ten seconds is worth more than an empty field, and the confidence is what
// says which of the two it is. Only a positive contradiction rejects.

export const VERIFY_SYSTEM_PROMPT = [
  "You check whether a LinkedIn search result belongs to a named person at a named clinic.",
  "You are shown the name taken from the clinic's own website, the clinic's name, and the visible title and snippet of the search result.",
  "Decide whether this is plausibly the same person at that clinic, or somebody else who happens to share the name.",
  "Be pragmatic: agreement on the clinic name, the town, the profession or the specialty all count in favour, and a snippet that says little is grounds for lower confidence, NOT for rejection.",
  "Only answer 'different' when something in the result actually contradicts it — a different employer, a different profession, a different person.",
  "Reply with json only.",
].join(" ");

export function verificationPrompt(args: {
  clinicName: string;
  extractedName: string;
  roleContext: string | null;
  profileUrl: string;
  resultTitle: string;
  resultSnippet: string;
}): string {
  return [
    `CLINIC: ${args.clinicName}`,
    `NAME FROM THE CLINIC'S WEBSITE: ${args.extractedName}`,
    `ROLE CONTEXT ON THE WEBSITE: ${args.roleContext ?? "none stated"}`,
    "",
    "SEARCH RESULT:",
    `URL: ${args.profileUrl}`,
    `Title: ${args.resultTitle === "" ? "(none returned)" : args.resultTitle}`,
    `Snippet: ${args.resultSnippet === "" ? "(none returned)" : args.resultSnippet}`,
    "",
    "REPLY FORMAT — json, and nothing else:",
    '{"verdict":"same"|"unsure"|"different","confidence":"HIGH"|"MEDIUM"|"LOW","name":"the person\'s name as the result gives it, or null","title":"their role as the result gives it, or null","reason":"one sentence of what you matched on"}',
    "",
    "HIGH means the result names this clinic or otherwise ties the person to it. MEDIUM means it agrees on profession or place. LOW means nothing contradicts it and nothing confirms it.",
  ].join("\n");
}

export interface Verification {
  verdict: "same" | "unsure" | "different";
  confidence: DecisionMakerConfidence;
  // What the profile calls them, when the result gave a fuller or better
  // spelling than the website did. Null keeps the website's own text.
  name: string | null;
  title: string | null;
  reason: string;
}

// The model's verdict, never throwing, and clamped rather than trusted.
//
// Two clamps, both of them the "unknown beats wrong" rule in arithmetic: an
// unsure verdict is never worth more than Low however sure the model claims to
// be about being unsure, and an unparseable reply is an unsure Low rather than
// a rejection — a search that returned a profile and a verifier that returned
// gibberish is still a lead, held at the confidence that says so.
export function readVerification(content: string): Verification {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(content);
    if (value !== null && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  if (parsed === null) {
    return {
      verdict: "unsure",
      confidence: "LOW",
      name: null,
      title: null,
      reason: "The verification could not be read, so the match is kept at low confidence rather than assumed.",
    };
  }

  const raw = typeof parsed.verdict === "string" ? parsed.verdict.toLowerCase().trim() : "";
  const verdict: Verification["verdict"] =
    raw === "same" ? "same" : raw === "different" ? "different" : "unsure";

  const claimed = isDecisionMakerConfidence(parsed.confidence)
    ? (parsed.confidence as DecisionMakerConfidence)
    : "LOW";
  const confidence: DecisionMakerConfidence =
    verdict === "different" ? "UNKNOWN" : verdict === "unsure" ? "LOW" : claimed;

  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim().replace(/\s+/g, " ");
    return trimmed === "" || trimmed.toLowerCase() === "null" ? null : trimmed.slice(0, 120);
  };

  return {
    verdict,
    confidence,
    name: str(parsed.name),
    title: str(parsed.title),
    reason:
      str(parsed.reason)?.slice(0, 300) ??
      "No reason was given for the verdict.",
  };
}

// ─── 5. The fallback: the clinic-anchored search ───────────────────────────
//
// Second tier, and it runs only after the name path above has been tried and
// genuinely found nobody — no name on the site, or names that searched and
// verified to nothing. That ordering is the whole point of it: the name path
// is specific and this one is a guess, and a guess run first would spend the
// budget answering a question the website could have answered.
//
// The queries, and every one of them names the clinic. Ownership first, the
// roles that run the place next, then the two catch-alls. There is no bare
// "owner" search here — that returns the owners of other people's practices.
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
