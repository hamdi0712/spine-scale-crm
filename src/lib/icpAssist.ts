// Scoring assist — what the model is asked, and how its answer is read.
//
// The scorecard already has one suggestion in it: a staff count that came in
// with the lead pre-selects category A's band (suggestedStaffSizeScore in
// src/lib/icp.ts). This is the same arrangement with a model in the middle
// instead of arithmetic, and it is held to the same rule — a suggestion is
// pre-selected, shown with its reason, and stored by nothing until somebody
// opens the card and saves it. Scoring is a decision, not a side effect of a
// model call.
//
// Two things follow, and they are the whole design:
//
//   It scores the evidence, not the clinic. Everything the model sees is what
//   "Enrich this lead" gathered — website notes, the Meta ads signal, the
//   review count — and the prompt says so, so a category the evidence cannot
//   speak to comes back as null rather than as a guess.
//
//   The framework text is the framework text. Category B's options and the two
//   Automation Gap boxes are rendered into the prompt from src/lib/icp.ts
//   verbatim, so re-wording a scoring option re-words the prompt with it and
//   the model can never be scoring against a copy that has drifted.
//
// Nothing here touches the network or the database: building the prompt and
// reading the reply are pure, and src/lib/actions/icpAssist.ts does the call.

import {
  ICP_CATEGORIES,
  ICP_GAPS,
  ICP_GAP_GUIDANCE,
  IcpGap,
  IcpGapKey,
} from "@/lib/icp";

// The gaps this assist will offer an opinion on. Remarketing is deliberately
// not among them: it is judged on a retargeting pixel and on recurring ad
// creative, and neither is in anything the enrichment run brings back — a
// model asked for it anyway would be inventing the answer.
export const ASSIST_GAP_KEYS = ["icpGapBooking", "icpGapReviews"] as const;

export type AssistGapKey = (typeof ASSIST_GAP_KEYS)[number];

// The category it scores. One, and the highest-weighted one: it is the
// category whose answer is written on a clinic's own website, which is exactly
// what the crawl brings back.
export const ASSIST_CATEGORY_KEY = "icpPackageEconomics" as const;

// How much of the website notes to send. The crawler stores up to 20k
// characters (three pages), and the answer to "does this clinic name a program
// and price it" is on the first few thousand — the rest is a blog. Cut with an
// ellipsis so a truncated note never reads to the model as a complete one.
export const ASSIST_NOTES_MAX_CHARS = 12000;

// A reason is one sentence beside a radio button, and a summary is two or
// three. Held to that on the way in, because a model that ignores the
// instruction should cost the layout nothing.
const REASON_MAX_CHARS = 240;
const SUMMARY_MAX_CHARS = 700;

// ─── What it reads ─────────────────────────────────────────────────────────

// The enrichment fields, and nothing else off the lead. The clinic name goes
// with them so the summary can name the clinic; no contact, no stage, and no
// note anybody typed is ever sent.
export interface IcpAssistEvidence {
  clinicName: string;
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
}

// Whether there is anything to read at all. The button is disabled without it,
// and the action refuses without it — a lead that has never been enriched has
// nothing for a model to score, and asking anyway would produce three
// confident sentences about no evidence.
export function hasAssistEvidence(evidence: {
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
}): boolean {
  return (
    (evidence.websiteNotes ?? "").trim() !== "" ||
    (evidence.metaAdsSignal ?? "").trim() !== "" ||
    evidence.reviewCount !== null
  );
}

// ─── What comes back ───────────────────────────────────────────────────────

export interface IcpAssistScore {
  points: number;
  reason: string;
}

export interface IcpAssistGap {
  checked: boolean;
  reason: string;
}

export interface IcpAssistSuggestion {
  // Null where the evidence does not support a call. The model is told to use
  // it, and a category it declines to score is left alone in the form.
  packageEconomics: IcpAssistScore | null;
  gaps: Partial<Record<AssistGapKey, IcpAssistGap>>;
  summary: string;
}

export type IcpAssistResult =
  | {
      ok: true;
      suggestion: IcpAssistSuggestion;
      // Which enrichment fields the model actually had, so the card can say
      // what the suggestion was made from rather than implying it saw
      // everything.
      basedOn: string[];
    }
  | { ok: false; error: string };

// ─── The prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You help qualify chiropractic and non-surgical spine clinics against a fixed scorecard for a marketing agency.",
  "You score the evidence you are given and nothing else. You have no knowledge of this clinic beyond the evidence block, and you never infer a fact it does not state — where the evidence cannot support a call, you return null for that item instead of guessing.",
  "You use the scorecard's own option text as written; you do not adjust what a score means to fit a clinic.",
  // The lowercase "json" is load-bearing, not a typo. DeepSeek refuses a
  // request that asks for response_format json_object unless the word appears
  // in a prompt, and its documentation writes that word in lower case
  // throughout. Saying it both ways costs a clause and satisfies the check
  // whichever way it is spelled.
  "You reply with a single JSON object in exactly the shape requested, and nothing else — your reply is parsed as json, so any prose around it breaks it.",
].join(" ");

export function buildAssistPrompt(evidence: IcpAssistEvidence): {
  system: string;
  user: string;
} {
  return { system: SYSTEM_PROMPT, user: userPrompt(evidence) };
}

function userPrompt(evidence: IcpAssistEvidence): string {
  const category = ICP_CATEGORIES.find((c) => c.key === ASSIST_CATEGORY_KEY)!;
  const gaps = ICP_GAPS.filter(
    (g): g is IcpGap & { key: AssistGapKey } => isAssistGapKey(g.key),
  );

  const options = category.options
    .map(
      (o) =>
        `  ${o.points} — ${o.label}${o.signal ? ` (${o.signal})` : ""}`,
    )
    .join("\n");

  const gapLines = gaps
    .map(
      (g) =>
        `  ${gapId(g.key)} — ${g.label}${g.signal ? ` (${g.signal})` : ""}`,
    )
    .join("\n");

  return [
    `CLINIC: ${evidence.clinicName}`,
    "",
    "EVIDENCE",
    "Gathered by an automated enrichment run. This is everything you have.",
    "",
    evidenceBlock(evidence),
    "",
    "FRAMEWORK",
    `${category.letter} — ${category.title} (0–${category.max})`,
    category.guidance,
    options,
    category.note ?? null,
    "",
    `D — Automation Gap. ${ICP_GAP_GUIDANCE}`,
    gapLines,
    "",
    "TASK",
    `1. packageEconomics — pick the one option above whose text the evidence matches, and say why in one sentence. Judge it on what the website notes describe: a named treatment program with visible or inquire-for pricing scores highest, package or plan language without a name or a price is next, itemized per-visit services only is next, and pure insurance billing with no cash-pay component visible anywhere scores 0. Return null if the notes say nothing either way about how this clinic sells its care.`,
    `2. ${gapId("icpGapBooking")} — is the gap present? true means the gap is there (no real-time online booking widget), which is a point in the clinic's favour under this framework. Read it off the website notes: a booking widget shows up as scheduling copy, an appointment request form, or a named booking tool. Return null if the notes are silent on how patients book.`,
    `3. ${gapId("icpGapReviews")} — is the gap present? true means no visible automated review-request pattern. Judge it on the Google review count against what the website notes suggest about the clinic's size, age and patient volume: a long-established multi-practitioner clinic with a thin review count implies nobody is asking. Return null if you have neither a review count nor anything in the notes to weigh it against.`,
    "4. summary — 2 to 3 sentences on this clinic's overall fit for an agency selling booking, review and follow-up automation to cash-pay spine clinics. Say what the evidence shows and what it leaves open.",
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "packageEconomics": { "points": <integer 0-3>, "reason": "<one sentence>" } | null,',
    `  "${gapId("icpGapBooking")}": { "checked": <true|false>, "reason": "<one sentence>" } | null,`,
    `  "${gapId("icpGapReviews")}": { "checked": <true|false>, "reason": "<one sentence>" } | null,`,
    '  "summary": "<2-3 sentences>"',
    "}",
    "",
    `Each reason is one sentence, under ${REASON_MAX_CHARS} characters, and cites what in the evidence it is reading. Do not restate the option text as the reason.`,
  ]
    // Only the category's optional caveat is dropped when absent — the empty
    // strings above are the blank lines between sections.
    .filter((line): line is string => line !== null)
    .join("\n");
}

// The evidence, with its absences named. A missing field is stated rather than
// left out, so the model reads "no ads signal was gathered" instead of quietly
// scoring a clinic as though it had been checked and found to have none.
function evidenceBlock(evidence: IcpAssistEvidence): string {
  const notes = (evidence.websiteNotes ?? "").trim();
  const ads = (evidence.metaAdsSignal ?? "").trim();

  const parts = [
    "Website notes — text crawled from the clinic's own site:",
    notes === ""
      ? "(not gathered — no website notes on this lead)"
      : `"""\n${truncate(notes, ASSIST_NOTES_MAX_CHARS)}\n"""`,
    "",
    `Meta ads signal: ${ads === "" ? "(not gathered)" : ads}`,
    `Google review count: ${
      evidence.reviewCount === null ? "(not gathered)" : evidence.reviewCount
    }`,
  ];
  return parts.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// The JSON key a gap answers under — the scorecard's own key with its prefix
// dropped, which reads better in a prompt than icpGapBooking and maps back
// unambiguously because the mapping is this one function and its inverse.
function gapId(key: AssistGapKey): string {
  return key === "icpGapBooking" ? "gapBooking" : "gapReviews";
}

// ─── Reading the reply ─────────────────────────────────────────────────────

// The model's JSON, held to the shape the card can use. Returns null when
// nothing usable came back at all — an unparseable reply, or one carrying no
// suggestion and no summary — which the action reports as a malformed answer.
// Anything partially usable is kept: a reply with two good suggestions and a
// third that scored 7 points is worth two suggestions.
export function parseAssistSuggestion(raw: string): IcpAssistSuggestion | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const body = parsed as Record<string, unknown>;

  const category = ICP_CATEGORIES.find((c) => c.key === ASSIST_CATEGORY_KEY)!;
  const packageEconomics = readScore(
    body.packageEconomics,
    category.options.map((o) => o.points),
  );

  const gaps: Partial<Record<AssistGapKey, IcpAssistGap>> = {};
  for (const key of ASSIST_GAP_KEYS) {
    const gap = readGap(body[gapId(key)]);
    if (gap) gaps[key] = gap;
  }

  const summary = readText(body.summary, SUMMARY_MAX_CHARS);

  if (packageEconomics === null && Object.keys(gaps).length === 0 && summary === "") {
    return null;
  }
  return { packageEconomics, gaps, summary };
}

// A score is only a score if it is one of the options the category actually
// offers. Anything else — 7 points, "3", a number the framework dropped in a
// re-word — is not clamped into range but discarded: a suggestion nobody can
// tie back to an option on screen is not a suggestion.
function readScore(raw: unknown, allowed: number[]): IcpAssistScore | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).points;
  if (typeof value !== "number" || !allowed.includes(value)) return null;
  const reason = readText((raw as Record<string, unknown>).reason, REASON_MAX_CHARS);
  if (reason === "") return null;
  return { points: value, reason };
}

function readGap(raw: unknown): IcpAssistGap | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const checked = (raw as Record<string, unknown>).checked;
  if (typeof checked !== "boolean") return null;
  const reason = readText((raw as Record<string, unknown>).reason, REASON_MAX_CHARS);
  if (reason === "") return null;
  return { checked, reason };
}

function readText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// What the suggestion was made from, named for the card. Same labels the
// enrichment panel uses, so "based on Website notes, Review count" reads as
// the same fields the run reported writing.
export function assistEvidenceLabels(evidence: {
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
}): string[] {
  const labels: string[] = [];
  if ((evidence.websiteNotes ?? "").trim() !== "") labels.push("Website notes");
  if ((evidence.metaAdsSignal ?? "").trim() !== "") labels.push("Meta ads signal");
  if (evidence.reviewCount !== null) labels.push("Review count");
  return labels;
}

// The scorecard's key for a gap this assist can speak to, for the card's own
// lookups. Kept beside ASSIST_GAP_KEYS so the two never disagree about which
// gaps are in scope.
export function isAssistGapKey(key: IcpGapKey): key is AssistGapKey {
  return (ASSIST_GAP_KEYS as readonly string[]).includes(key);
}
