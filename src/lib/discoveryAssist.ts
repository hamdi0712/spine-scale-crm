// The discovery queue's model call — what it is asked, and how the answer is
// read.
//
// This is the lead scorecard's scoring assist (src/lib/icpAssist.ts) asked a
// longer question. Same model, same evidence, same rule that it scores what it
// was given and returns null where it cannot: what changes is that a candidate
// has nobody standing over it, so the queue needs the two things the lead
// assist leaves to a human — a verdict on the five hard disqualifiers, and the
// third Automation Gap box.
//
// Two things make that safe enough to run unattended.
//
//   The disqualifiers are asked for as *flags with evidence*, not as a
//   checklist. Only the ones the model can point at something for come back,
//   and the prompt says plainly that a disqualifier ends the clinic — because
//   the cost of a false one is a real prospect thrown away with a sentence of
//   explanation nobody will ever read.
//
//   The gaps are pre-checked before they are asked about. A keyword scan over
//   the website notes says what it found, the model is shown that finding and
//   asked to confirm or overturn it with a reason. Neither half is trusted
//   alone: the scan cannot read context, and the model cannot be relied on to
//   notice a booking widget it was not looking for.
//
// The framework text is the framework text: the disqualifier labels, category
// B's options and all three gap definitions are rendered into the prompt from
// src/lib/icp.ts verbatim, so re-wording one re-words the prompt with it.
//
// Nothing here touches the network or the database — building the prompt and
// reading the reply are pure, and src/lib/actions/discovery.ts does the call.

import {
  ICP_CATEGORIES,
  ICP_DISQUALIFIERS,
  ICP_DISQUALIFIER_RULE,
  ICP_GAPS,
  ICP_GAP_GUIDANCE,
  IcpDisqualifierKey,
  IcpGapKey,
} from "@/lib/icp";
import { ASSIST_NOTES_MAX_CHARS, IcpAssistEvidence } from "@/lib/icpAssist";

// This prompt asks for up to ten reasoned answers where the lead assist asks
// for four, so it carries its own output ceiling rather than living under that
// one. Still a ceiling against a runaway generation, not a target.
export const DISCOVERY_ASSIST_MAX_TOKENS = 1400;

// A reason is one sentence in a breakdown row; a summary is two or three.
const REASON_MAX_CHARS = 240;
const SUMMARY_MAX_CHARS = 700;

// ─── The keyword pre-check ─────────────────────────────────────────────────
//
// Each list holds the things a clinic's own site says when it *has* the thing
// the gap is the absence of. A hit therefore argues the gap is not present,
// which is why finding nothing is the interesting result: this framework
// scores gaps, so an empty scan is a point in the clinic's favour and exactly
// the kind of claim that should be confirmed by something that can read.
//
// Matched case-insensitively against the crawled text as substrings, so
// "Book Online" and "book online today" both hit. Deliberately short lists of
// unambiguous phrases — a scan that fires on "appointment" would fire on every
// clinic site ever written.

const GAP_EVIDENCE_TERMS: Record<IcpGapKey, string[]> = {
  icpGapBooking: [
    "book online",
    "book now",
    "book an appointment",
    "book your appointment",
    "schedule online",
    "online scheduling",
    "request an appointment",
    "self-schedule",
    "calendly",
    "acuity scheduling",
    "janeapp",
    "jane app",
    "chirotouch",
    "zocdoc",
    "nexhealth",
    "setmore",
    "simplepractice",
  ],
  icpGapReviews: [
    "leave us a review",
    "leave a review",
    "review us on",
    "write a review",
    "rate your visit",
    "birdeye",
    "podium",
    "nicejob",
    "reviewwave",
    "swell cx",
    "grade.us",
  ],
  icpGapRemarketing: [
    "subscribe to our newsletter",
    "join our newsletter",
    "sign up for our",
    "download our free",
    "free guide",
    "free ebook",
    "get our free",
    "join our mailing list",
    "email list",
    "retargeting",
  ],
};

export interface GapPrecheck {
  key: IcpGapKey;
  // The terms actually found, so the prompt can quote them rather than assert
  // a conclusion, and the breakdown can say what the scan was reading.
  matched: string[];
  // What the scan alone concludes: true = the gap looks present (nothing found
  // that says the clinic has this), false = it does not, null = there were no
  // website notes to scan and the scan has no opinion.
  gapPresent: boolean | null;
}

export function precheckGaps(
  websiteNotes: string | null | undefined,
): Record<IcpGapKey, GapPrecheck> {
  const text = (websiteNotes ?? "").toLowerCase();
  const scanned = text.trim() !== "";
  const out = {} as Record<IcpGapKey, GapPrecheck>;
  for (const gap of ICP_GAPS) {
    const matched = scanned
      ? GAP_EVIDENCE_TERMS[gap.key].filter((term) => text.includes(term))
      : [];
    out[gap.key] = {
      key: gap.key,
      matched,
      gapPresent: scanned ? matched.length === 0 : null,
    };
  }
  return out;
}

// ─── What comes back ───────────────────────────────────────────────────────

export interface DiscoveryAssistScore {
  points: number;
  reason: string;
}

export interface DiscoveryAssistGap {
  checked: boolean;
  reason: string;
}

export interface DiscoveryAssistSuggestion {
  // Only the ones the model flagged. Anything absent did not fire, which is
  // the ordinary case and needs no sentence.
  disqualifiers: Partial<
    Record<IcpDisqualifierKey, { triggered: true; reason: string }>
  >;
  packageEconomics: DiscoveryAssistScore | null;
  gaps: Partial<Record<IcpGapKey, DiscoveryAssistGap>>;
  summary: string;
}

export type DiscoveryAssistResult =
  | { ok: true; suggestion: DiscoveryAssistSuggestion }
  | { ok: false; error: string };

// ─── The prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You qualify chiropractic and non-surgical spine clinics against a fixed scorecard for a marketing agency.",
  "You score the evidence you are given and nothing else. You have no knowledge of this clinic beyond the evidence block, and you never infer a fact it does not state — where the evidence cannot support a call, you return null for that item instead of guessing.",
  "You use the scorecard's own option text as written; you do not adjust what a score means to fit a clinic.",
  "You are especially careful with disqualifiers: flagging one ends this clinic's evaluation, so you flag one only when the evidence states the thing plainly, never when it merely fails to rule it out.",
  // The lowercase "json" is load-bearing, not a typo. DeepSeek refuses a
  // request that asks for response_format json_object unless the word appears
  // in a prompt, and its documentation writes that word in lower case
  // throughout. Saying it both ways costs a clause and satisfies the check
  // whichever way it is spelled.
  "You reply with a single JSON object in exactly the shape requested, and nothing else — your reply is parsed as json, so any prose around it breaks it.",
].join(" ");

export function buildDiscoveryPrompt(
  evidence: IcpAssistEvidence,
  precheck: Record<IcpGapKey, GapPrecheck>,
): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: userPrompt(evidence, precheck) };
}

function userPrompt(
  evidence: IcpAssistEvidence,
  precheck: Record<IcpGapKey, GapPrecheck>,
): string {
  const category = ICP_CATEGORIES.find(
    (c) => c.key === "icpPackageEconomics",
  )!;

  const options = category.options
    .map((o) => `  ${o.points} — ${o.label}${o.signal ? ` (${o.signal})` : ""}`)
    .join("\n");

  const disqualifierLines = ICP_DISQUALIFIERS.map(
    (d) => `  ${dqId(d.key)} — ${d.label}${d.signal ? ` (${d.signal})` : ""}`,
  ).join("\n");

  const gapLines = ICP_GAPS.map(
    (g) => `  ${gapId(g.key)} — ${g.label}${g.signal ? ` (${g.signal})` : ""}`,
  ).join("\n");

  return [
    `CLINIC: ${evidence.clinicName}`,
    "",
    "EVIDENCE",
    "Gathered by an automated enrichment run. This is everything you have.",
    "",
    evidenceBlock(evidence),
    "",
    "KEYWORD PRE-CHECK",
    "A plain substring scan of the website notes, run before you were asked. It cannot read context and is often wrong; it is here to be confirmed or overturned, not obeyed.",
    precheckBlock(precheck),
    "",
    "FRAMEWORK — LAYER 1, HARD DISQUALIFIERS",
    ICP_DISQUALIFIER_RULE,
    disqualifierLines,
    "",
    `FRAMEWORK — ${category.letter}, ${category.title} (0–${category.max})`,
    category.guidance,
    options,
    category.note ?? null,
    "",
    `FRAMEWORK — D, Automation Gap. ${ICP_GAP_GUIDANCE}`,
    gapLines,
    "",
    "TASK",
    "1. disqualifiers — list only the ones the evidence plainly states are true, each with the sentence in the evidence you are reading it off. An empty list is the ordinary answer and the correct one whenever you are unsure. Never flag one because the evidence is silent: silence is not proof of a surgical practice, a solo practitioner, a franchise contract, a complete working system, or an out-of-region clinic.",
    `2. packageEconomics — pick the one option above whose text the evidence matches, and say why in one sentence. Judge it on what the website notes describe: a named treatment program with visible or inquire-for pricing scores highest, package or plan language without a name or a price is next, itemized per-visit services only is next, and pure insurance billing with no cash-pay component visible anywhere scores 0. Return null if the notes say nothing either way about how this clinic sells its care.`,
    `3. ${gapId("icpGapBooking")} — is the gap present? true means the gap is there (no real-time online booking widget), which is a point in the clinic's favour under this framework. Read it off the website notes and the pre-check above: a booking widget shows up as scheduling copy, an appointment request form, or a named booking tool. Return null if the notes are silent on how patients book.`,
    `4. ${gapId("icpGapReviews")} — is the gap present? true means no visible automated review-request pattern. Judge it on the Google review count against what the website notes suggest about the clinic's size, age and patient volume: a long-established multi-practitioner clinic with a thin review count implies nobody is asking. Return null if you have neither a review count nor anything in the notes to weigh it against.`,
    `5. ${gapId("icpGapRemarketing")} — is the gap present? true means no visible follow-up or remarketing evidence. The strongest signals you have are the ads signal (ads running now are evidence of remarketing capability) and any lead-magnet, newsletter or mailing-list copy in the website notes. This is the thinnest of the three — return null rather than guess if you have neither.`,
    "6. summary — 2 to 3 sentences on this clinic's overall fit for an agency selling booking, review and follow-up automation to cash-pay spine clinics. Say what the evidence shows and what it leaves open.",
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "disqualifiers": [ { "id": "<one of the ids above>", "reason": "<one sentence citing the evidence>" } ],',
    '  "packageEconomics": { "points": <integer 0-3>, "reason": "<one sentence>" } | null,',
    `  "${gapId("icpGapBooking")}": { "checked": <true|false>, "reason": "<one sentence>" } | null,`,
    `  "${gapId("icpGapReviews")}": { "checked": <true|false>, "reason": "<one sentence>" } | null,`,
    `  "${gapId("icpGapRemarketing")}": { "checked": <true|false>, "reason": "<one sentence>" } | null,`,
    '  "summary": "<2-3 sentences>"',
    "}",
    "",
    `Each reason is one sentence, under ${REASON_MAX_CHARS} characters, and cites what in the evidence it is reading. Do not restate the option text as the reason. Where you overturn the pre-check, say so.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

// The evidence, with its absences named. A missing field is stated rather than
// left out, so the model reads "no ads signal was gathered" instead of quietly
// scoring a clinic as though it had been checked and found to have none.
function evidenceBlock(evidence: IcpAssistEvidence): string {
  const notes = (evidence.websiteNotes ?? "").trim();
  const ads = (evidence.metaAdsSignal ?? "").trim();
  return [
    "Website notes — text crawled from the clinic's own site:",
    notes === ""
      ? "(not gathered — no website notes on this candidate)"
      : `"""\n${truncate(notes, ASSIST_NOTES_MAX_CHARS)}\n"""`,
    "",
    `Meta ads signal: ${ads === "" ? "(not gathered)" : ads}`,
    `Google review count: ${
      evidence.reviewCount === null ? "(not gathered)" : evidence.reviewCount
    }`,
  ].join("\n");
}

function precheckBlock(precheck: Record<IcpGapKey, GapPrecheck>): string {
  return ICP_GAPS.map((gap) => {
    const scan = precheck[gap.key];
    if (scan.gapPresent === null) {
      return `  ${gapId(gap.key)} — not scanned: there are no website notes.`;
    }
    if (scan.matched.length === 0) {
      return `  ${gapId(gap.key)} — nothing found, which argues the gap is present.`;
    }
    return `  ${gapId(gap.key)} — found ${scan.matched
      .map((m) => `“${m}”`)
      .join(", ")}, which argues the gap is not present.`;
  }).join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// The ids a disqualifier and a gap answer under. The scorecard's own keys with
// their prefixes dropped, which reads better in a prompt and maps back
// unambiguously because the mapping is these two functions and their inverses.
function dqId(key: IcpDisqualifierKey): string {
  return key.replace(/^icpDq/, "dq");
}

function dqKeyFromId(id: string): IcpDisqualifierKey | null {
  const found = ICP_DISQUALIFIERS.find((d) => dqId(d.key) === id);
  return found ? found.key : null;
}

function gapId(key: IcpGapKey): string {
  return key.replace(/^icpGap/, "gap");
}

// ─── Reading the reply ─────────────────────────────────────────────────────

// The model's JSON, held to the shape the breakdown can use. Returns null when
// nothing usable came back at all, which the queue reports as a malformed
// answer and treats as a scoring failure rather than as a clinic with no
// evidence against it.
//
// Anything partially usable is kept: a reply with a good category score and a
// gap that answered 7 is worth the category score.
export function parseDiscoverySuggestion(
  raw: string,
): DiscoveryAssistSuggestion | null {
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

  const category = ICP_CATEGORIES.find((c) => c.key === "icpPackageEconomics")!;
  const packageEconomics = readScore(
    body.packageEconomics,
    category.options.map((o) => o.points),
  );

  const gaps: Partial<Record<IcpGapKey, DiscoveryAssistGap>> = {};
  for (const gap of ICP_GAPS) {
    const answer = readGap(body[gapId(gap.key)]);
    if (answer) gaps[gap.key] = answer;
  }

  const disqualifiers = readDisqualifiers(body.disqualifiers);
  const summary = readText(body.summary, SUMMARY_MAX_CHARS);

  if (
    packageEconomics === null &&
    Object.keys(gaps).length === 0 &&
    Object.keys(disqualifiers).length === 0 &&
    summary === ""
  ) {
    return null;
  }
  return { disqualifiers, packageEconomics, gaps, summary };
}

// A flagged disqualifier is only taken when it names one of the five and says
// why. A flag with no reason is discarded rather than kept: this is the one
// answer that stops a clinic dead, and an unexplained one cannot be reviewed.
function readDisqualifiers(
  raw: unknown,
): Partial<Record<IcpDisqualifierKey, { triggered: true; reason: string }>> {
  const out: Partial<
    Record<IcpDisqualifierKey, { triggered: true; reason: string }>
  > = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "";
    const key = dqKeyFromId(id);
    if (!key) continue;
    const reason = readText(entry.reason, REASON_MAX_CHARS);
    if (reason === "") continue;
    out[key] = { triggered: true, reason };
  }
  return out;
}

// A score is only a score if it is one of the options the category actually
// offers. Anything else — 7 points, "3", a number the framework dropped in a
// re-word — is not clamped into range but discarded: a suggestion nobody can
// tie back to an option in the framework is not a suggestion.
function readScore(raw: unknown, allowed: number[]): DiscoveryAssistScore | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).points;
  if (typeof value !== "number" || !allowed.includes(value)) return null;
  const reason = readText(
    (raw as Record<string, unknown>).reason,
    REASON_MAX_CHARS,
  );
  if (reason === "") return null;
  return { points: value, reason };
}

function readGap(raw: unknown): DiscoveryAssistGap | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const checked = (raw as Record<string, unknown>).checked;
  if (typeof checked !== "boolean") return null;
  const reason = readText(
    (raw as Record<string, unknown>).reason,
    REASON_MAX_CHARS,
  );
  if (reason === "") return null;
  return { checked, reason };
}

function readText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// ─── Scoring on partial evidence ───────────────────────────────────────────
//
// The queue already refuses to score a candidate nothing was gathered for.
// This is the same rule applied one step in: a candidate two of whose scored
// categories were never *attempted* is not a low-scoring clinic either, it is
// a clinic nobody has looked at properly, and a stored 3/10 with the reasoning
// to match would say otherwise for as long as the record exists.
//
// The distinction this turns on, and the only one that matters here, is
// between a category that scored nothing because the evidence said nothing
// relevant and a category that scored nothing because the evidence for it was
// never gathered at all. The first is a real finding — Budget Signal scoring 0
// off a clinic with no ads and no reviews is the framework working — and is
// left alone. The second is an absence, and two of them mean the total is
// arithmetic on guesses.
//
// Which input each item needs is not invented here: it is read straight off
// the TASK block above, where each item is told what to return null on. Change
// a rule there and the matching entry below has to move with it, which is why
// the two live in the same file.

// The five the framework actually scores through evidence. Budget Signal is
// deliberately not among them: it is computed from the ads signal and the
// review count, both of whose absence is itself the finding, so it always has
// an answer and can never be "not attempted".
export type ScoredItemKey = "icpStaffSize" | "icpPackageEconomics" | IcpGapKey;

// The gathered fields an item can be attempted from.
export type EvidenceInputKey =
  | "staffCountRaw"
  | "websiteNotes"
  | "reviewCount"
  | "metaAdsSignal";

export interface ScoredItemInputs {
  staffCountRaw: number | null;
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
}

// What each item can be attempted from — any one of them is enough, which is
// why the two gaps with a fallback have two. A gap the model can answer off
// the ads signal alone has been answered off real evidence even with no
// website notes, and is not an absence.
const SCORED_ITEM_NEEDS: Record<ScoredItemKey, EvidenceInputKey[]> = {
  // Arithmetic on the headcount, and nothing else can stand in for it.
  icpStaffSize: ["staffCountRaw"],
  // "Return null if the notes say nothing either way about how this clinic
  // sells its care."
  icpPackageEconomics: ["websiteNotes"],
  // "Return null if the notes are silent on how patients book."
  icpGapBooking: ["websiteNotes"],
  // "Return null if you have neither a review count nor anything in the notes
  // to weigh it against."
  icpGapReviews: ["websiteNotes", "reviewCount"],
  // "…the ads signal … and any lead-magnet, newsletter or mailing-list copy in
  // the website notes … return null rather than guess if you have neither."
  icpGapRemarketing: ["websiteNotes", "metaAdsSignal"],
};

// Two. One category with nothing behind it is a thin card and the framework
// already handles it — Staff Size scores 0 with the absence named, and says
// so on the breakdown. Two is the point at which the total stops describing
// the clinic and starts describing the run.
export const MIN_UNGATHERED_TO_FAIL = 2;

export interface UngatheredItem {
  key: ScoredItemKey;
  // As the breakdown labels it, so the failure names what a reader would go
  // looking for.
  label: string;
  needs: EvidenceInputKey[];
}

// The scored items that were never attempted: nothing to attempt them on, and
// no answer for them either.
//
// Both halves are required, and each covers a case the other gets wrong. An
// item the model answered anyway is an item it found something real to answer
// from, whatever this module thinks it needed — so it is not an absence. An
// item with its input present but no answer is the model having read the
// evidence and declined, which is a finding and not this rule's business.
export function ungatheredItems(
  inputs: ScoredItemInputs,
  suggestion: DiscoveryAssistSuggestion | null,
): UngatheredItem[] {
  return scoredItems().filter(({ key, needs }) => {
    const attemptable = needs.some((need) => hasInput(inputs, need));
    return !attemptable && !wasAnswered(key, inputs, suggestion);
  });
}

function scoredItems(): UngatheredItem[] {
  const category = (key: "icpStaffSize" | "icpPackageEconomics") => {
    const found = ICP_CATEGORIES.find((c) => c.key === key)!;
    return `${found.letter} — ${found.title}`;
  };
  return [
    { key: "icpStaffSize" as const, label: category("icpStaffSize") },
    {
      key: "icpPackageEconomics" as const,
      label: category("icpPackageEconomics"),
    },
    ...ICP_GAPS.map((gap) => ({
      key: gap.key,
      label: `D — ${gap.label}`,
    })),
  ].map((item) => ({ ...item, needs: SCORED_ITEM_NEEDS[item.key] }));
}

function hasInput(inputs: ScoredItemInputs, key: EvidenceInputKey): boolean {
  switch (key) {
    case "staffCountRaw":
      return inputs.staffCountRaw !== null;
    case "reviewCount":
      return inputs.reviewCount !== null;
    case "websiteNotes":
      return (inputs.websiteNotes ?? "").trim() !== "";
    case "metaAdsSignal":
      return (inputs.metaAdsSignal ?? "").trim() !== "";
  }
}

function wasAnswered(
  key: ScoredItemKey,
  inputs: ScoredItemInputs,
  suggestion: DiscoveryAssistSuggestion | null,
): boolean {
  // Staff Size is arithmetic rather than an answer from the model: it has one
  // exactly when there is a headcount to do the arithmetic on.
  if (key === "icpStaffSize") return inputs.staffCountRaw !== null;
  if (key === "icpPackageEconomics") {
    return (suggestion?.packageEconomics ?? null) !== null;
  }
  return (suggestion?.gaps?.[key] ?? null) !== null;
}

// What to go and fix, in the order it is worth fixing: the website first,
// because it is the input four of the five items read.
const MISSING_INPUT_ORDER: EvidenceInputKey[] = [
  "websiteNotes",
  "staffCountRaw",
  "reviewCount",
  "metaAdsSignal",
];

// The candidate's own URLs, for telling the two kinds of absence apart. A
// website URL nobody has filled in is a field to fill in; a website URL that
// was crawled and gave nothing back is not, and saying "Missing: website URL"
// about a candidate that plainly has one would send somebody looking for a
// field that is already there.
export interface CandidateUrls {
  websiteUrl: string | null;
  companyLinkedinUrl: string | null;
  facebookUrl: string | null;
}

export function missingInputPhrases(
  items: UngatheredItem[],
  inputs: ScoredItemInputs,
  urls: CandidateUrls,
): string[] {
  const wanted = new Set<EvidenceInputKey>();
  for (const item of items) {
    // The first need only, where an item has more than one.
    //
    // Those are alternatives — either the website notes or the review count
    // will do for the reviews gap — so listing both would read as two things
    // that have to be fixed when fixing one is enough. The first is the one
    // the item is really read from, and the one that usually unblocks the
    // others too: four of the five items are attempted from the website.
    const primary = item.needs[0];
    if (primary !== undefined && !hasInput(inputs, primary)) wanted.add(primary);
  }
  return MISSING_INPUT_ORDER.filter((key) => wanted.has(key)).map((key) =>
    missingInputPhrase(key, urls),
  );
}

function missingInputPhrase(key: EvidenceInputKey, urls: CandidateUrls): string {
  const has = (v: string | null) => (v ?? "").trim() !== "";
  switch (key) {
    case "websiteNotes":
      return has(urls.websiteUrl)
        ? "website notes (the crawler returned nothing from the website URL on this candidate)"
        : "website URL";
    case "staffCountRaw":
      return has(urls.companyLinkedinUrl)
        ? "staff count (the company page reported none)"
        : "company LinkedIn URL";
    case "reviewCount":
      return "Google reviews (the Maps search found no listing to count)";
    case "metaAdsSignal":
      return has(urls.facebookUrl)
        ? "ads signal (the ads library returned nothing)"
        : "Facebook URL";
  }
}

// The sentence the candidate is failed with. Names what is missing first,
// because that is the thing to act on, and what it cost second.
export function ungatheredFailureReason(
  items: UngatheredItem[],
  inputs: ScoredItemInputs,
  urls: CandidateUrls,
): string {
  const missing = missingInputPhrases(items, inputs, urls);
  const total = Object.keys(SCORED_ITEM_NEEDS).length;
  return [
    `Missing: ${missing.join(", ")}.`,
    `${items.length} of the ${total} scored categories had nothing to attempt them on`,
    `(${items.map((i) => i.label).join("; ")}),`,
    "so nothing was scored rather than putting a total on the gaps.",
    "Add what is missing on the candidate and run the queue again.",
  ].join(" ");
}

// How the pre-check reads in the stored breakdown, appended to whatever reason
// the model gave so a gap's line says both halves of how it was decided.
export function precheckNote(scan: GapPrecheck): string {
  if (scan.gapPresent === null) return "";
  return scan.matched.length === 0
    ? " Keyword pre-check found nothing on the site saying otherwise."
    : ` Keyword pre-check found ${scan.matched.map((m) => `“${m}”`).join(", ")} on the site.`;
}
