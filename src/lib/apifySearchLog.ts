// Search usage tracking — how many times a search has actually been run.
//
// Two ways into Discovery spend money on a search: the Apify bulk import,
// which runs a LinkedIn people search from a block of input JSON, and the
// Clinic-First panel, which runs one search per keyword. Both are re-run often
// and neither remembered anything, so the only way to know whether a keyword
// was fresh or had been ground through a dozen times was to remember it.
//
// This is that memory: one row per distinct search, a count, and a status read
// off the count. It changes nothing about what a run does — a well-used search
// still runs, and still returns whatever it returns. It only says so.
//
// Pure: no network, no database. The reads and writes live in
// src/lib/actions/apifySearchLog.ts.

// ─── What kind of search a row is ──────────────────────────────────────────

export const APIFY_SEARCH_TYPES = ["LINKEDIN_SEARCH", "CLINIC_KEYWORD"] as const;

export type ApifySearchType = (typeof APIFY_SEARCH_TYPES)[number];

export const APIFY_SEARCH_TYPE_LABELS: Record<ApifySearchType, string> = {
  LINKEDIN_SEARCH: "LinkedIn search",
  CLINIC_KEYWORD: "Clinic keyword",
};

export const APIFY_SEARCH_TYPE_MEANINGS: Record<ApifySearchType, string> = {
  LINKEDIN_SEARCH:
    "A bulk LinkedIn search run from the Apify import — the key is its input JSON, canonicalised.",
  CLINIC_KEYWORD:
    "One search term from a Clinic-First run. Each term in a run is counted on its own.",
};

export function isApifySearchType(v: unknown): v is ApifySearchType {
  return (
    typeof v === "string" &&
    (APIFY_SEARCH_TYPES as readonly string[]).includes(v)
  );
}

// ─── The tiers ─────────────────────────────────────────────────────────────

export const APIFY_SEARCH_STATUSES = [
  "NEW",
  "USED",
  "SATURATING",
  "WELL_USED",
] as const;

export type ApifySearchStatus = (typeof APIFY_SEARCH_STATUSES)[number];

export function isApifySearchStatus(v: unknown): v is ApifySearchStatus {
  return (
    typeof v === "string" &&
    (APIFY_SEARCH_STATUSES as readonly string[]).includes(v)
  );
}

// The two thresholds the tiers turn on, named once and read everywhere.
// Moving a band is editing these two numbers and nothing else — no branch
// anywhere in the app compares a run count against a literal.
export const APIFY_SEARCH_SATURATING_AT = 5;
export const APIFY_SEARCH_WELL_USED_AT = 10;

export const APIFY_SEARCH_STATUS_LABELS: Record<ApifySearchStatus, string> = {
  NEW: "New",
  USED: "Used",
  SATURATING: "Getting saturated",
  WELL_USED: "Well used",
};

export const APIFY_SEARCH_STATUS_MEANINGS: Record<ApifySearchStatus, string> = {
  NEW: "Never run through tracking — whatever it finds is new to us.",
  USED: `Run between 1 and ${APIFY_SEARCH_SATURATING_AT - 1} times. Still turning up clinics that have not been seen.`,
  SATURATING: `Run ${APIFY_SEARCH_SATURATING_AT}–${APIFY_SEARCH_WELL_USED_AT - 1} times. Expect a thinning return — most of what it finds is already in Discovery.`,
  WELL_USED: `Run ${APIFY_SEARCH_WELL_USED_AT} times or more. Worth replacing rather than running again.`,
};

// The tier a bare run count sits in. Nothing else decides it, and an override
// is applied on top of this rather than instead of it — see searchStatus.
export function statusFromRunCount(runCount: number): ApifySearchStatus {
  if (!Number.isFinite(runCount) || runCount <= 0) return "NEW";
  if (runCount >= APIFY_SEARCH_WELL_USED_AT) return "WELL_USED";
  if (runCount >= APIFY_SEARCH_SATURATING_AT) return "SATURATING";
  return "USED";
}

// What a row's status actually reads as. An override wins outright and keeps
// winning: a run that lands while one is set still increments the count
// underneath it (see recordApifySearchRun), so clearing the override later
// drops back to the truth rather than to a stale guess.
export function searchStatus(row: {
  runCount: number;
  manualStatusOverride?: string | null;
}): { status: ApifySearchStatus; manual: boolean } {
  const override = row.manualStatusOverride;
  if (isApifySearchStatus(override)) return { status: override, manual: true };
  return { status: statusFromRunCount(row.runCount), manual: false };
}

// The label as it is shown: the tier, and whether a person set it rather than
// the count. "Well used (manual)" is the whole point of the suffix — an
// override that looked like a count would be indistinguishable from one.
export function searchStatusLabel(status: ApifySearchStatus, manual: boolean): string {
  return `${APIFY_SEARCH_STATUS_LABELS[status]}${manual ? " (manual)" : ""}`;
}

// ─── Keys ──────────────────────────────────────────────────────────────────

// A search key is long enough to be a paragraph of JSON, so it is capped —
// far above any real actor input, and short of anything that would be a
// problem to store or draw.
export const MAX_SEARCH_KEY_LENGTH = 4000;

// The clinic-first key: the term itself, trimmed and lowercased, because
// "Spinal Decompression" and "spinal decompression" are one search and the
// panel already de-duplicates its terms case-insensitively.
export function clinicKeywordKey(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_SEARCH_KEY_LENGTH);
}

// The LinkedIn key: the input JSON, canonicalised so that re-indenting it,
// re-ordering its keys or pasting it back with different whitespace is the
// same search rather than a new one.
//
// Object keys are sorted at every depth; arrays keep their order, because the
// order of a list of job titles is the actor's input and not formatting.
// Input that is not JSON at all is not thrown away — it is stripped of
// whitespace and used as-is, so a hand-written non-JSON input still counts.
export function linkedinSearchKey(input: string): string {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (trimmed === "") return "{}";
  try {
    return JSON.stringify(canonicalize(JSON.parse(trimmed))).slice(
      0,
      MAX_SEARCH_KEY_LENGTH,
    );
  } catch {
    return trimmed.replace(/\s+/g, "").slice(0, MAX_SEARCH_KEY_LENGTH);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

// The key for whichever kind of search, so a caller that has both never has to
// remember which normaliser belongs to which type.
export function searchKey(type: ApifySearchType, raw: string): string {
  return type === "LINKEDIN_SEARCH" ? linkedinSearchKey(raw) : clinicKeywordKey(raw);
}

// ─── What the history view is handed ───────────────────────────────────────

export interface ApifySearchLogRow {
  id: string;
  type: ApifySearchType;
  key: string;
  runCount: number;
  manualStatusOverride: ApifySearchStatus | null;
  firstRunAt: string | null;
  lastRunAt: string | null;
}

// A LinkedIn key is a JSON blob, and a table cell is not the place to read one
// in full. This is the one-line reading of it: the values that say what was
// searched for, in the order the JSON had them after sorting.
export function describeSearchKey(type: ApifySearchType, key: string): string {
  if (type !== "LINKEDIN_SEARCH") return key;
  try {
    const parsed = JSON.parse(key);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return key;
    }
    const parts: string[] = [];
    for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
      const shown = Array.isArray(value)
        ? value.map((v) => String(v)).join(", ")
        : value === null || typeof value === "object"
          ? null
          : String(value);
      if (shown === null || shown === "") continue;
      parts.push(`${field}: ${shown}`);
    }
    return parts.length === 0 ? key : parts.join(" · ");
  } catch {
    return key;
  }
}
