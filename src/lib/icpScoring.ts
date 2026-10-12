// The new scoring model — fit first, then signals, out of 100.
//
// The old scorecard (src/lib/icp.ts) added everything up and let the total
// decide. This one asks two questions in order, and only the first can make a
// clinic a fit:
//
//   1. The gate. Any disqualifier on the active ICP Definition that has
//      positive, cited evidence behind it — a quote and where it came from —
//      scores the clinic 0 and rejects it, with the disqualifier and the
//      citation on the record. Not finding something is never a hit.
//
//   2. Fit, out of 60: service match, decision-maker title, location, size.
//      Every point needs a citation. Below the fit floor the clinic is
//      rejected as "Not a confirmed fit", whatever its signals add up to.
//
//   3. Signals, out of 40: buying triggers, budget, automation gaps. They rank
//      fits against each other and nothing more.
//
// Then a chiropractic-first clinic that would be promoted has to show a real
// program — at least two of five cited signals (a dedicated page, named
// equipment, a consult offer, a named team, running ads) — or it is rejected
// as "Chiro without a real program". Nothing is held; everything else is
// promoted at or above the bar. Weights, the floor and
// the tier bands are all in src/lib/icpWeights.ts.
//
// Pure, like src/lib/discovery.ts: no network, no database. The model's reply
// arrives already parsed (src/lib/icpScoringAssist.ts) and this module decides
// what of it to believe. That last part is the point of it. A quote the model
// returns is checked word for word against the stored evidence before it earns
// anything, so a citation it made up is a citation that scores nothing; and
// the disqualifier rules the brief is strictest about are enforced here in
// code as well as asked for in the prompt, because a prompt is a request and a
// rejected clinic is gone.

import { budgetSignalScore, hasActiveAds } from "@/lib/discovery";
import { isProgramLink, isProgramPageUrl, parseLinks } from "@/lib/websiteCrawl";
import { GapPrecheck, precheckNote } from "@/lib/discoveryAssist";
import { ICP_GAPS, IcpGapKey, IcpTier } from "@/lib/icp";
import {
  IcpDefinitionData,
  buyingTriggerLines,
  disqualifierLines,
  sizeInRange,
  sizeRangeLabel,
} from "@/lib/icpDefinition";
import {
  BUDGET_MAX,
  CHIRO_CONSULT_PHRASES,
  CHIRO_EQUIPMENT,
  CHIRO_PROGRAM_MIN_SIGNALS,
  FIT_FLOOR,
  FIT_MAX,
  FIT_WEIGHTS,
  GAPS_MAX,
  SIGNALS_MAX,
  SIGNAL_WEIGHTS,
  V2_MAX_SCORE,
  V2_TIER_A_MIN,
  V2_TIER_B_MIN,
} from "@/lib/icpWeights";

// ─── What it reads ─────────────────────────────────────────────────────────

// The stored record, as the scorer sees it. Enrichment plus the handful of
// record fields a fit criterion can cite. Nothing here is fetched: the queue
// passes what this run just gathered, Compare scoring passes what was stored.
export interface ScoringEvidence {
  clinicName: string;
  websiteUrl: string | null;
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
  staffCountRaw: number | null;
  location: string | null;
  contactName: string | null;
  contactTitle: string | null;
  // JSON [{ text, url, page }] — every link on the crawled pages, where the
  // crawl stored them (src/lib/websiteCrawl.ts). Absent on records crawled
  // before links were kept.
  websiteLinks?: string | null;
}

// A claim and where it was read. `source` is a page URL for anything off the
// website, or the name of the record it came from ("Google Maps listing",
// "LinkedIn company page", "Location on record").
export interface Citation {
  quote: string;
  source: string;
}

// Named sources for the citations the app builds itself rather than the model.
export const SOURCE_MAPS = "Google Maps listing";
export const SOURCE_LINKEDIN = "LinkedIn company page";
export const SOURCE_ADS = "Meta ads signal";
export const SOURCE_LOCATION = "Location on record";
export const SOURCE_CONTACT = "Contact title on record";
export const SOURCE_CLINIC_NAME = "Clinic name";
export const SOURCE_WEBSITE = "Clinic website";
export const SOURCE_PRECHECK = "Keyword pre-check of the crawled pages";

// ─── What the model is allowed to say ──────────────────────────────────────
//
// The parsed reply. Every claim carries a quote and a source; none of them is
// believed until verifyQuote has found the quote in the evidence.

export interface ReplyClaim {
  quote: string;
  source: string;
  reason?: string;
}

export const PRIMARY_SERVICES = [
  "chiropractic",
  "physical therapy",
  "pain management",
  "spine and disc care",
  "other",
] as const;
export type PrimaryService = (typeof PRIMARY_SERVICES)[number];

export const PAYMENT_MODELS = ["cash", "hybrid", "insurance", "unknown"] as const;
export type PaymentModel = (typeof PAYMENT_MODELS)[number];

export const PAYMENT_MODEL_LABELS: Record<PaymentModel, string> = {
  cash: "Cash-pay",
  hybrid: "Hybrid (insurance + cash/packages)",
  insurance: "Insurance-only",
  unknown: "Not stated",
};

export type GapAnswerKey = "gapBooking" | "gapReviews" | "gapRemarketing";

export interface ScoringReply {
  disqualifiers: (ReplyClaim & { id: string })[];
  coreService: (ReplyClaim & { service: string }) | null;
  adjacentService: (ReplyClaim & { service: string }) | null;
  spineProgram: ReplyClaim | null;
  primaryService: (ReplyClaim & { service: PrimaryService }) | null;
  decisionMaker: (ReplyClaim & { title: string; name: string | null }) | null;
  location: (ReplyClaim & { place: string }) | null;
  locationCount: (ReplyClaim & { count: number }) | null;
  team: (ReplyClaim & { providers: number | null }) | null;
  buyingTriggers: (ReplyClaim & { id: string })[];
  paymentModel: (ReplyClaim & { model: Exclude<PaymentModel, "unknown"> }) | null;
  gaps: Partial<Record<GapAnswerKey, { checked: boolean; reason: string }>>;
  summary: string;
}

// ─── The stored breakdown ──────────────────────────────────────────────────

export type CriterionSource = "computed" | "assist" | "override" | "unanswered";

export const CRITERION_SOURCE_LABELS: Record<CriterionSource, string> = {
  computed: "Computed",
  assist: "DeepSeek, cited",
  override: "Override",
  unanswered: "No evidence",
};

export const FIT_KEYS = ["service", "title", "location", "size"] as const;
export const SIGNAL_KEYS = ["triggers", "budget", "gaps"] as const;
export type FitKey = (typeof FIT_KEYS)[number];
export type SignalKey = (typeof SIGNAL_KEYS)[number];
export type CriterionKey = FitKey | SignalKey;

export const CRITERION_LABELS: Record<CriterionKey, string> = {
  service: "Service match",
  title: "Decision-maker title",
  location: "Location",
  size: "Size",
  triggers: "Buying triggers",
  budget: "Budget signal",
  gaps: "Automation gaps",
};

export const CRITERION_MAX: Record<CriterionKey, number> = {
  service: FIT_WEIGHTS.serviceCore,
  title: FIT_WEIGHTS.title,
  location: FIT_WEIGHTS.location,
  size: FIT_WEIGHTS.size,
  triggers: SIGNAL_WEIGHTS.buyingTriggersMax,
  budget: BUDGET_MAX,
  gaps: GAPS_MAX,
};

// One line of a multi-part criterion — a trigger, or one automation gap.
export interface CriterionPart {
  label: string;
  points: number;
  max: number;
  reason: string;
  citation: Citation | null;
}

export interface CriterionEntry {
  key: CriterionKey;
  label: string;
  points: number;
  max: number;
  // Every citation behind the points, first the one that matters most.
  citations: Citation[];
  // One line, in words, on why it scored what it scored.
  reason: string;
  source: CriterionSource;
  // What was missing, in a few words, for the "Not a confirmed fit" sentence.
  // Null when the criterion earned its full points.
  shortfall: string | null;
  parts?: CriterionPart[];
  // What the run scored before somebody overrode it on the lead.
  scoredPoints?: number;
}

export interface DisqualifierHit {
  id: string;
  label: string;
  triggered: boolean;
  citation: Citation | null;
  reason: string;
  source: CriterionSource;
  // A flag the model raised and the app threw out, and why — kept so a reader
  // can see the guard working rather than wonder whether it ran.
  discarded: string | null;
  // What the run decided before an override on the lead.
  scoredTriggered?: boolean;
}

export type V2Status = "PROMOTED" | "REJECTED";
export type V2VerdictKind =
  | "disqualified"
  | "not_a_fit"
  | "below_threshold"
  | "chiro_no_program"
  | "promoted";

// The five signals that make a chiropractic-first clinic's program real.
export const CHIRO_SIGNAL_KEYS = ["page", "equipment", "consult", "team", "ads"] as const;
export type ChiroSignalKey = (typeof CHIRO_SIGNAL_KEYS)[number];

export const CHIRO_SIGNAL_LABELS: Record<ChiroSignalKey, string> = {
  page: "Dedicated decompression, disc, sciatica or avoid-surgery page",
  equipment: "Named equipment",
  consult: "Consult offer",
  team: "Team of 2+ named providers or staff",
  ads: "Running ads",
};

export interface ChiroSignal {
  key: ChiroSignalKey;
  label: string;
  found: boolean;
  citations: Citation[];
  reason: string;
}

export interface ChiroProgramCheck {
  signals: ChiroSignal[];
  count: number;
  required: number;
}

export interface V2Verdict {
  status: V2Status;
  kind: V2VerdictKind;
  reason: string;
  threshold: number;
  fitFloor: number;
}

export interface PrimaryServiceFinding {
  service: PrimaryService | null;
  chiropractic: boolean;
  citation: Citation | null;
  reason: string;
}

export interface PaymentModelFinding {
  model: PaymentModel;
  citation: Citation | null;
  reason: string;
}

export const BREAKDOWN_V2_VERSION = 1;

export interface IcpBreakdownV2 {
  model: "v2";
  version: number;
  // The definition it was scored against, as it stood. A later edit to the
  // ICP does not rewrite what this run was measured with.
  icp: { id: string; name: string; updatedAt: string };
  disqualifiers: DisqualifierHit[];
  fit: CriterionEntry[];
  signals: CriterionEntry[];
  fitTotal: number;
  signalsTotal: number;
  // Fit + signals, before the gate. Equal to total unless a disqualifier fired;
  // kept so "disqualified, and would have scored 85" stays findable.
  ungatedTotal: number;
  total: number;
  tier: IcpTier;
  primaryService: PrimaryServiceFinding;
  paymentModel: PaymentModelFinding;
  // The real-program check. Worked out for every clinic and decisive only for
  // a chiropractic-first one; null on a breakdown written before it existed.
  chiroProgram: ChiroProgramCheck | null;
  verdict: V2Verdict;
  summary: string;
  evidence: string[];
  notes: string[];
  scoredAt: string;
  // Set when somebody saved an override on the lead's card.
  overriddenAt?: string;
  overrideNote?: string;
}

// ─── Verifying a citation ──────────────────────────────────────────────────

// One searchable piece of evidence and the source a quote off it is cited as.
export interface EvidenceDoc {
  source: string;
  text: string;
  norm: string;
}

// Lowercase, punctuation to spaces, whitespace collapsed, padded — so a quote
// matches on whole words whatever the model did with curly quotes, dashes,
// line breaks or a trailing full stop.
export function normalizeForMatch(text: string): string {
  const flat = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return flat === "" ? "" : ` ${flat} `;
}

const URL_LINE = /^https?:\/\/\S+$/;

// The crawler stores each page as its URL on a line of its own followed by the
// page's text (labelled() in src/lib/leadEnrich.ts). Split back along those
// lines, so a quote is cited to the page it was actually read off.
export function websitePages(
  notes: string | null,
  fallbackSource: string,
): { source: string; text: string }[] {
  const text = (notes ?? "").trim();
  if (text === "") return [];
  const pages: { source: string; lines: string[] }[] = [];
  let current: { source: string; lines: string[] } = { source: fallbackSource, lines: [] };
  for (const line of text.split(/\r?\n/)) {
    if (URL_LINE.test(line.trim())) {
      if (current.lines.join("").trim() !== "") pages.push(current);
      current = { source: line.trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.join("").trim() !== "") pages.push(current);
  return pages.map((p) => ({ source: p.source, text: p.lines.join("\n") }));
}

export function evidenceDocs(evidence: ScoringEvidence): EvidenceDoc[] {
  const website = (evidence.websiteUrl ?? "").trim() || SOURCE_WEBSITE;
  const docs: { source: string; text: string }[] = [
    ...websitePages(evidence.websiteNotes, website),
  ];
  if ((evidence.metaAdsSignal ?? "").trim() !== "") {
    docs.push({ source: SOURCE_ADS, text: evidence.metaAdsSignal! });
  }
  if ((evidence.location ?? "").trim() !== "") {
    docs.push({ source: SOURCE_LOCATION, text: evidence.location! });
  }
  if ((evidence.contactTitle ?? "").trim() !== "") {
    docs.push({ source: SOURCE_CONTACT, text: evidence.contactTitle! });
  }
  return docs.map((d) => ({ ...d, norm: normalizeForMatch(d.text) }));
}

const QUOTE_MAX_CHARS = 400;
const QUOTE_MIN_CHARS = 6;

function sameSource(claimed: string, actual: string): boolean {
  const strip = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/#?]+$/, "");
  return strip(claimed) !== "" && strip(claimed) === strip(actual);
}

// The quote, found word for word in one piece of evidence, or null. A quote
// split with an ellipsis is accepted when every fragment is on the same page.
// The page the model named is tried first; a quote it attributed to the wrong
// page but that is genuinely in the evidence is kept and re-attributed, because
// the words are what is being verified and the source is then read off where
// they actually are.
export function verifyQuote(
  quote: unknown,
  claimedSource: unknown,
  docs: EvidenceDoc[],
): Citation | null {
  if (typeof quote !== "string") return null;
  const clean = quote.replace(/\s+/g, " ").trim().replace(/^["“”']+|["“”']+$/g, "");
  if (clean.length < QUOTE_MIN_CHARS || clean.length > QUOTE_MAX_CHARS) return null;
  const fragments = clean
    .split(/\.{3,}|…/)
    .map(normalizeForMatch)
    .filter((f) => f !== "");
  if (fragments.length === 0) return null;
  const words = fragments.join(" ").trim().split(/\s+/).length;
  if (words < 2) return null;

  const claimed = typeof claimedSource === "string" ? claimedSource : "";
  const ordered = [
    ...docs.filter((d) => sameSource(claimed, d.source)),
    ...docs.filter((d) => !sameSource(claimed, d.source)),
  ];
  for (const doc of ordered) {
    if (fragments.every((f) => doc.norm.includes(f))) {
      return { quote: clean, source: doc.source };
    }
  }
  return null;
}

// ─── The guards ────────────────────────────────────────────────────────────

// A reason that rests on what the evidence did not say, or hedges on the one
// fact a disqualifier turns on. Either way it is not positive evidence, and a
// disqualifier never fires on it.
const ABSENCE_OR_HEDGE =
  /\b(no mention|not mentioned|does(?:n't| not) (?:say|state|mention|list|show|appear|offer|include)|did(?:n't| not) find|could(?:n't| not) find|can(?:not|'t) find|unable to find|not found|no evidence|no indication|unclear|not clear|appears? to|seems? to|likely|probably|possibly|presumably|may be|might be|suggests?|implies|implying|no pricing|no prices|not listed|absence of)\b/i;

export function isAbsenceOrHedge(reason: string): boolean {
  return ABSENCE_OR_HEDGE.test(reason);
}

// What counts as an explicit insurance-only statement. A list of accepted
// insurers is not one (most hybrid clinics publish theirs), and neither is a
// site that simply prints no prices.
const EXPLICIT_INSURANCE_ONLY =
  /\b(insurance[- ]only|only (?:accept|take|bill|work with|see patients with) (?:your )?insurance|in[- ]network only|we (?:only|exclusively) (?:accept|take|bill) insurance|exclusively (?:bill|accept|take) insurance|no (?:self|cash)[- ]?pay|(?:do not|don't|does not|doesn't) (?:offer|accept|provide) (?:self|cash)[- ]?pay|(?:do not|don't|does not|doesn't) offer (?:any )?(?:packages|cash (?:options|plans|pricing)|payment plans)|no (?:treatment )?packages|no cash (?:option|options|plans|pricing)|insurance (?:is )?required)\b/i;

export function isExplicitInsuranceOnly(quote: string): boolean {
  return EXPLICIT_INSURANCE_ONLY.test(quote);
}

type DisqualifierKind =
  | "no_website"
  | "insurance_only"
  | "single_provider"
  | "outside_us"
  | "general";

// Which of the brief's specially-ruled disqualifiers a line of the operator's
// own text is. Read off the words, because the list is free text somebody can
// rewrite; a line this does not recognise is held to the general rule (a
// verified, positive, unhedged citation) and nothing more.
export function disqualifierKind(label: string): DisqualifierKind {
  if (/\bno website\b/i.test(label)) return "no_website";
  if (/insurance/i.test(label) && /\b(only|no cash|no self|without cash)\b/i.test(label)) {
    return "insurance_only";
  }
  if (/\b(single provider|one provider|solo practi\w*)\b/i.test(label)) return "single_provider";
  if (/\boutside (?:the )?(?:us|u\.s\.?|usa|united states)\b/i.test(label)) return "outside_us";
  return "general";
}

// ─── Locations and titles ──────────────────────────────────────────────────

const US_STATES: [string, string][] = [
  ["alabama", "AL"], ["alaska", "AK"], ["arizona", "AZ"], ["arkansas", "AR"],
  ["california", "CA"], ["colorado", "CO"], ["connecticut", "CT"], ["delaware", "DE"],
  ["florida", "FL"], ["georgia", "GA"], ["hawaii", "HI"], ["idaho", "ID"],
  ["illinois", "IL"], ["indiana", "IN"], ["iowa", "IA"], ["kansas", "KS"],
  ["kentucky", "KY"], ["louisiana", "LA"], ["maine", "ME"], ["maryland", "MD"],
  ["massachusetts", "MA"], ["michigan", "MI"], ["minnesota", "MN"], ["mississippi", "MS"],
  ["missouri", "MO"], ["montana", "MT"], ["nebraska", "NE"], ["nevada", "NV"],
  ["new hampshire", "NH"], ["new jersey", "NJ"], ["new mexico", "NM"], ["new york", "NY"],
  ["north carolina", "NC"], ["north dakota", "ND"], ["ohio", "OH"], ["oklahoma", "OK"],
  ["oregon", "OR"], ["pennsylvania", "PA"], ["rhode island", "RI"], ["south carolina", "SC"],
  ["south dakota", "SD"], ["tennessee", "TN"], ["texas", "TX"], ["utah", "UT"],
  ["vermont", "VT"], ["virginia", "VA"], ["washington", "WA"], ["west virginia", "WV"],
  ["wisconsin", "WI"], ["wyoming", "WY"], ["district of columbia", "DC"],
];

const US_ABBR = US_STATES.map(([, abbr]) => abbr).join("|");
// ", TX" or "TX 78701" — the two ways an address writes its state.
const US_ADDRESS = new RegExp(`(?:,\\s*(?:${US_ABBR})\\b|\\b(?:${US_ABBR})\\s+\\d{5}(?:-\\d{4})?\\b)`);

export function looksUs(place: string): boolean {
  const norm = normalizeForMatch(place);
  if (/ (united states|usa|u s a) /.test(norm)) return true;
  if (US_STATES.some(([name]) => norm.includes(` ${name} `))) return true;
  return US_ADDRESS.test(place);
}

const US_TARGETS = new Set(["united states", "usa", "us", "u s", "u s a", "united states of america", "america"]);

// The target a place falls in, or null. "united states" (or USA, US) is read
// as "anywhere in the US" — a state, a state abbreviation in an address, or the
// country named; any other target is matched as the words it is.
export function placeMatchesTarget(place: string, targets: string[]): string | null {
  const norm = normalizeForMatch(place);
  for (const target of targets) {
    const t = normalizeForMatch(target).trim();
    if (t === "") continue;
    if (US_TARGETS.has(t)) {
      if (looksUs(place)) return target;
    } else if (norm.includes(` ${t} `)) {
      return target;
    }
  }
  return null;
}

// The target title a stated title matches, on whole words with the full stops
// taken out — so "D.C." is "dc" and "Clinic Director & Owner" matches both.
export function titleMatchesTarget(title: string, targets: string[]): string | null {
  const norm = normalizeForMatch(title.replace(/\./g, ""));
  for (const target of targets) {
    const t = normalizeForMatch(target.replace(/\./g, "")).trim();
    if (t !== "" && norm.includes(` ${t} `)) return target;
  }
  return null;
}

// Whether a service the model named is one on the ICP's list, read loosely —
// "spinal decompression therapy" is "spinal decompression". The tag it
// matched, or null for a service the operator never listed.
function matchServiceTag(service: string, tags: string[]): string | null {
  const s = normalizeForMatch(service).trim();
  if (s === "") return null;
  for (const tag of tags) {
    const t = normalizeForMatch(tag).trim();
    if (t === "") continue;
    if (s === t || ` ${s} `.includes(` ${t} `) || ` ${t} `.includes(` ${s} `)) return tag;
  }
  return null;
}

// ─── The evidence check ────────────────────────────────────────────────────

const META_ONLY_PREFIX = "[Page metadata only";

export type EvidenceGate =
  | { kind: "ok" }
  // No website copy, and a Maps listing that exists and shows no site: the
  // "No website" disqualifier can be decided from the data alone.
  | { kind: "no_website"; disqualifierId: string; label: string }
  | { kind: "failed"; reason: string };

// Whether there is enough to judge fit at all. The website is where every fit
// criterion is read, so a clinic with no website copy is either one the data
// itself shows has no website (rejected, cited to the Maps listing) or one
// nobody has managed to look at — Failed, with what is missing, never
// Rejected.
export function evidenceGate(
  evidence: ScoringEvidence,
  icp: IcpDefinitionData,
): EvidenceGate {
  if ((evidence.websiteNotes ?? "").trim() !== "") return { kind: "ok" };

  const hasUrl = (evidence.websiteUrl ?? "").trim() !== "";
  const lines = disqualifierLines(icp);
  const noWebsiteIndex = lines.findIndex((l) => disqualifierKind(l) === "no_website");

  if (!hasUrl && evidence.reviewCount !== null && noWebsiteIndex !== -1) {
    return {
      kind: "no_website",
      disqualifierId: dqId(noWebsiteIndex),
      label: lines[noWebsiteIndex],
    };
  }
  const missing = hasUrl
    ? `the website at ${evidence.websiteUrl} was crawled but returned no readable copy`
    : evidence.reviewCount === null
      ? "no website was found, and no Google Maps listing was found to confirm the clinic has none"
      : "no website was found, and the active ICP has no “No website” disqualifier to decide that on";
  return {
    kind: "failed",
    reason: `Not enough evidence to judge fit: ${missing}. Nothing was scored — add a website URL on the candidate and run it again.`,
  };
}

export function dqId(index: number): string {
  return `dq${index + 1}`;
}

export function triggerId(index: number): string {
  return `t${index + 1}`;
}

// ─── Building one ──────────────────────────────────────────────────────────

export interface BuildInput {
  icp: IcpDefinitionData;
  evidence: ScoringEvidence;
  // Null on the no-website path, where nothing was asked.
  reply: ScoringReply | null;
  precheck: Record<IcpGapKey, GapPrecheck> | null;
  threshold: number;
  evidenceLabels: string[];
  notes: string[];
  now: Date;
}

export function buildBreakdownV2(input: BuildInput): IcpBreakdownV2 {
  const { icp, evidence, reply, precheck, now } = input;
  const docs = evidenceDocs(evidence);
  const notes = [...input.notes];

  const disqualifiers = judgeDisqualifiers(icp, evidence, reply, docs);
  const locations = locationCountFinding(reply, docs);
  const fit = summaryConsistency(
    reply?.summary ?? "",
    [
      serviceEntry(icp, reply, docs),
      titleEntry(icp, evidence, reply, docs, locations),
      locationEntry(icp, evidence, reply, docs),
      sizeEntry(icp, evidence, reply, docs, locations),
    ],
    icp,
    notes,
  );
  const signals = [
    triggersEntry(icp, reply, docs),
    budgetEntry(evidence),
    gapsEntry(reply, precheck),
  ];
  const primaryService = primaryServiceFinding(evidence, reply, docs);
  const paymentModel = paymentModelFinding(reply, docs);
  const chiroProgram = chiroProgramCheck(evidence, reply, docs);

  return finish(
    {
      model: "v2",
      version: BREAKDOWN_V2_VERSION,
      icp: { id: icp.id, name: icp.name, updatedAt: icp.updatedAt },
      disqualifiers,
      fit,
      signals,
      primaryService,
      paymentModel,
      chiroProgram,
      summary: reply?.summary ?? "",
      evidence: input.evidenceLabels,
      notes,
      scoredAt: now.toISOString(),
    },
    input.threshold,
  );
}

// Totals, tier and verdict from the entries. One function for a fresh run and
// for an override saved on a lead, so a hand-edited card is judged by exactly
// the rules a run is.
type Unfinished = Omit<
  IcpBreakdownV2,
  "fitTotal" | "signalsTotal" | "ungatedTotal" | "total" | "tier" | "verdict"
>;

export function finish(b: Unfinished, threshold: number): IcpBreakdownV2 {
  const fitTotal = sum(b.fit);
  const signalsTotal = sum(b.signals);
  const ungatedTotal = fitTotal + signalsTotal;
  const triggered = b.disqualifiers.filter((d) => d.triggered);
  const gated = triggered.length > 0;
  const total = gated ? 0 : ungatedTotal;
  const verdict = decideVerdict({
    triggered,
    fit: b.fit,
    fitTotal,
    total,
    chiropractic: b.primaryService.chiropractic,
    chiroProgram: b.chiroProgram,
    threshold,
  });
  const tier: IcpTier = gated
    ? "DISQUALIFIED"
    : verdict.kind === "not_a_fit" || verdict.kind === "chiro_no_program"
      ? "C"
      : v2TierForScore(total);
  return { ...b, fitTotal, signalsTotal, ungatedTotal, total, tier, verdict };
}

function sum(entries: CriterionEntry[]): number {
  return entries.reduce((s, e) => s + e.points, 0);
}

export function v2TierForScore(total: number): Exclude<IcpTier, "DISQUALIFIED"> {
  if (total >= V2_TIER_A_MIN) return "A";
  if (total >= V2_TIER_B_MIN) return "B";
  return "C";
}

export const V2_TIER_BANDS = `${V2_TIER_A_MIN}+ A-tier · ${V2_TIER_B_MIN}–${V2_TIER_A_MIN - 1} B-tier · below ${V2_TIER_B_MIN} C-tier`;

// The order the brief sets: the gate, the fit floor, the bar, then the
// real-program check for a chiropractic-first clinic.
function decideVerdict(args: {
  triggered: DisqualifierHit[];
  fit: CriterionEntry[];
  fitTotal: number;
  total: number;
  chiropractic: boolean;
  chiroProgram: ChiroProgramCheck | null;
  threshold: number;
}): V2Verdict {
  const base = { threshold: args.threshold, fitFloor: FIT_FLOOR };

  if (args.triggered.length > 0) {
    const first = args.triggered[0];
    const cite = first.citation
      ? ` — “${clip(first.citation.quote, 140)}” (${first.citation.source})`
      : "";
    const more =
      args.triggered.length > 1 ? ` (+${args.triggered.length - 1} more)` : "";
    return {
      ...base,
      status: "REJECTED",
      kind: "disqualified",
      reason: `Disqualified: ${first.label}${cite}${more}`,
    };
  }

  if (args.fitTotal < FIT_FLOOR) {
    const missing = args.fit
      .filter((e) => e.shortfall !== null)
      .map((e) => `${e.label.toLowerCase()} (${e.shortfall})`);
    return {
      ...base,
      status: "REJECTED",
      kind: "not_a_fit",
      reason: `Not a confirmed fit — fit ${args.fitTotal}/${FIT_MAX}, needs ${FIT_FLOOR}. Missing: ${missing.join("; ") || "cited evidence for every criterion"}.`,
    };
  }

  if (args.total < args.threshold) {
    return {
      ...base,
      status: "REJECTED",
      kind: "below_threshold",
      reason: `Scored ${args.total}/${V2_MAX_SCORE} — a confirmed fit (${args.fitTotal}/${FIT_MAX}), but below the promotion threshold of ${args.threshold}.`,
    };
  }

  if (args.chiropractic) {
    const check = args.chiroProgram;
    const found = check ? check.signals.filter((x) => x.found) : [];
    const required = check?.required ?? CHIRO_PROGRAM_MIN_SIGNALS;
    if (found.length < required) {
      return {
        ...base,
        status: "REJECTED",
        kind: "chiro_no_program",
        reason: `Chiro without a real program (${found.length} of 5 signals)${
          found.length > 0 ? ` — found: ${found.map((x) => x.label.toLowerCase()).join("; ")}` : " — none found"
        }. Needs ${required}.`,
      };
    }
    return {
      ...base,
      status: "PROMOTED",
      kind: "promoted",
      reason: `Promoted — ${v2TierForScore(args.total)}-tier, ${args.total}/${V2_MAX_SCORE} (fit ${args.fitTotal}/${FIT_MAX}); chiropractic-first with a real program (${found.length} of 5 signals: ${found.map((x) => x.label.toLowerCase()).join("; ")}).`,
    };
  }

  return {
    ...base,
    status: "PROMOTED",
    kind: "promoted",
    reason: `Promoted — ${v2TierForScore(args.total)}-tier, ${args.total}/${V2_MAX_SCORE} (fit ${args.fitTotal}/${FIT_MAX}).`,
  };
}

// ─── The gate ──────────────────────────────────────────────────────────────

function judgeDisqualifiers(
  icp: IcpDefinitionData,
  evidence: ScoringEvidence,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): DisqualifierHit[] {
  const lines = disqualifierLines(icp);
  return lines.map((label, index) => {
    const id = dqId(index);
    const kind = disqualifierKind(label);
    const clear = (reason: string, discarded: string | null = null): DisqualifierHit => ({
      id,
      label,
      triggered: false,
      citation: null,
      reason,
      source: discarded ? "assist" : "unanswered",
      discarded,
    });

    // Decided from the data, never from the model: a Maps listing that exists,
    // and no website from it, from LinkedIn, or from a search.
    if (kind === "no_website") {
      const noSite =
        (evidence.websiteNotes ?? "").trim() === "" &&
        (evidence.websiteUrl ?? "").trim() === "" &&
        evidence.reviewCount !== null;
      if (noSite) {
        return {
          id,
          label,
          triggered: true,
          citation: {
            quote: `Google Maps listing found (${evidence.reviewCount} reviews) with no website on it; no website from LinkedIn or a Google search either`,
            source: SOURCE_MAPS,
          },
          reason: "The clinic's own Maps listing exists and shows no site.",
          source: "computed",
          discarded: null,
        };
      }
      return {
        ...clear(
          (evidence.websiteNotes ?? "").trim() !== "" || (evidence.websiteUrl ?? "").trim() !== ""
            ? "The clinic has a website."
            : "No Maps listing was found to confirm there is no website, so this cannot fire.",
        ),
        source: "computed",
      };
    }

    const flagged = (reply?.disqualifiers ?? []).find((d) => d.id === id);
    if (!flagged) return clear("Nothing in the evidence states this.");

    const citation = verifyQuote(flagged.quote, flagged.source, docs);
    if (!citation) {
      return clear(
        "Not triggered.",
        "Flagged, but its quote is not in the stored evidence word for word — an unverifiable citation never disqualifies.",
      );
    }
    const reason = (flagged.reason ?? "").trim();
    if (reason === "" || isAbsenceOrHedge(reason)) {
      return clear(
        "Not triggered.",
        `Flagged on reasoning that rests on an absence or a hedge (“${clip(reason, 120)}”) — not finding something is never a hit.`,
      );
    }
    if (kind === "insurance_only" && !isExplicitInsuranceOnly(citation.quote)) {
      return clear(
        "Not triggered.",
        "Flagged, but the quote is not an explicit insurance-only statement. A list of accepted insurers, or no published prices, is not evidence of insurance-only.",
      );
    }
    if (kind === "single_provider") {
      if (evidence.staffCountRaw !== null && evidence.staffCountRaw >= 2) {
        return clear(
          "Not triggered.",
          `Flagged, but the LinkedIn company page reports ${evidence.staffCountRaw} staff — this is not a one-person clinic.`,
        );
      }
      const team = reply?.team ? verifyQuote(reply.team.quote, reply.team.source, docs) : null;
      if (team && (reply?.team?.providers ?? 0) >= 2) {
        return clear(
          "Not triggered.",
          `Flagged, but the site also shows a team (“${clip(team.quote, 100)}”).`,
        );
      }
    }
    if (kind === "outside_us" && looksUs(citation.quote)) {
      return clear(
        "Not triggered.",
        "Flagged, but the quote it cites is a US address.",
      );
    }
    return {
      id,
      label,
      triggered: true,
      citation,
      reason: clip(reason, 240),
      source: "assist",
      discarded: null,
    };
  });
}

// ─── Fit ───────────────────────────────────────────────────────────────────

function entry(
  key: CriterionKey,
  points: number,
  reason: string,
  citations: Citation[],
  source: CriterionSource,
  shortfall: string | null,
  parts?: CriterionPart[],
): CriterionEntry {
  const max = CRITERION_MAX[key];
  const clamped = Math.min(Math.max(Math.round(points), 0), max);
  return {
    key,
    label: CRITERION_LABELS[key],
    points: clamped,
    max,
    citations,
    reason,
    source,
    shortfall: clamped >= max ? null : shortfall,
    ...(parts ? { parts } : {}),
  };
}

function serviceEntry(
  icp: IcpDefinitionData,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): CriterionEntry {
  if (reply?.coreService) {
    const tag = matchServiceTag(reply.coreService.service, icp.coreServices);
    const citation = verifyQuote(reply.coreService.quote, reply.coreService.source, docs);
    if (tag && citation) {
      return entry(
        "service",
        FIT_WEIGHTS.serviceCore,
        `Core service — ${tag}.`,
        [citation],
        "assist",
        null,
      );
    }
  }

  // A core service named anywhere on the site — usually in the clinic's list
  // of services, often beside unrelated wellness services — is a core-service
  // match whether or not the model reported it. Found by a word-for-word scan,
  // so the quote it is cited with is the site's own line.
  const found = findCoreServiceInText(icp, docs);
  if (found) {
    return entry(
      "service",
      FIT_WEIGHTS.serviceCore,
      `Core service — ${found.tag} — named on the site.`,
      [found.citation],
      "computed",
      null,
    );
  }

  const adjacent = reply?.adjacentService
    ? {
        tag: matchServiceTag(reply.adjacentService.service, icp.adjacentServices),
        citation: verifyQuote(reply.adjacentService.quote, reply.adjacentService.source, docs),
      }
    : null;
  const claimedProgram = reply?.spineProgram
    ? verifyQuote(reply.spineProgram.quote, reply.spineProgram.source, docs)
    : null;
  // Generic back-pain copy is not a program: it has to name something.
  const program =
    claimedProgram && isSpecificSpineProgram(claimedProgram) ? claimedProgram : null;

  if (adjacent?.tag && adjacent.citation) {
    if (program) {
      return entry(
        "service",
        FIT_WEIGHTS.serviceAdjacentWithSpineProgram,
        `Adjacent service — ${adjacent.tag} — with a cited spine, disc or back-pain program.`,
        [program, adjacent.citation],
        "assist",
        "adjacent service, not a core one",
      );
    }
    return entry(
      "service",
      0,
      claimedProgram
        ? `General ${adjacent.tag}. The back-pain line cited (“${clip(claimedProgram.quote, 100)}”) is general copy, not a named program, a dedicated service page or a specific modality.`
        : `General ${adjacent.tag} with no cited spine, disc or back-pain program — not a fit on service.`,
      [adjacent.citation],
      "assist",
      `general ${adjacent.tag}, no specific spine/disc/back-pain program`,
    );
  }

  return entry(
    "service",
    0,
    "No core or adjacent service on the ICP was found with a verifiable citation.",
    [],
    "unanswered",
    "no cited core or adjacent service",
  );
}

function titleEntry(
  icp: IcpDefinitionData,
  evidence: ScoringEvidence,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
  locations: LocationCount | null,
): CriterionEntry {
  const onRecord = (evidence.contactTitle ?? "").trim();
  if (onRecord !== "") {
    const match = titleMatchesTarget(onRecord, icp.targetTitles);
    if (match) {
      const who = (evidence.contactName ?? "").trim();
      return entry(
        "title",
        FIT_WEIGHTS.title,
        `${who === "" ? "The contact" : who} is listed as ${onRecord} — a target title (${match}).`,
        [{ quote: onRecord, source: SOURCE_CONTACT }],
        "computed",
        null,
      );
    }
  }
  if (reply?.decisionMaker) {
    const citation = verifyQuote(reply.decisionMaker.quote, reply.decisionMaker.source, docs);
    const match = titleMatchesTarget(reply.decisionMaker.title, icp.targetTitles);
    // The title has to be in the quote, not only in the model's summary of it.
    const inQuote =
      citation !== null &&
      normalizeForMatch(citation.quote.replace(/\./g, "")).includes(
        normalizeForMatch(reply.decisionMaker.title.replace(/\./g, "")),
      );
    if (citation && match && inQuote) {
      const name = reply.decisionMaker.name ? `${reply.decisionMaker.name}, ` : "";
      return entry(
        "title",
        FIT_WEIGHTS.title,
        `${name}${reply.decisionMaker.title} on the site — a target title (${match}).`,
        [citation],
        "assist",
        null,
      );
    }
  }
  // A named doctor at a one- or two-location clinic is, in practice, the
  // person who decides — so "Dr. Welty, DC" on the site counts.
  const smallClinic = locations === null || locations.n <= 2;
  if (smallClinic) {
    const doctor = findNamedDoctor(reply, docs);
    if (doctor) {
      return entry(
        "title",
        FIT_WEIGHTS.title,
        `${doctor.name} is named on the site at a ${locations ? `${locations.n}-location` : "single-address"} clinic — counted as the decision-maker.`,
        [doctor.citation],
        doctor.fromModel ? "assist" : "computed",
        null,
      );
    }
  }
  return entry(
    "title",
    0,
    onRecord !== ""
      ? `The contact on record is “${onRecord}”, which is not a target title, and no named doctor or target title was cited on the site.`
      : "No named person was cited on the record or the site. This alone cannot sink a clinic: the fit floor is set to clear without it.",
    [],
    "unanswered",
    "no named decision-maker",
  );
}

function locationEntry(
  icp: IcpDefinitionData,
  evidence: ScoringEvidence,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): CriterionEntry {
  if (icp.targetLocations.length === 0) {
    return entry("location", 0, "The active ICP lists no target locations.", [], "unanswered", "no target locations on the ICP");
  }
  if (reply?.location) {
    const citation = verifyQuote(reply.location.quote, reply.location.source, docs);
    const match = citation ? placeMatchesTarget(citation.quote, icp.targetLocations) : null;
    if (citation && match) {
      return entry(
        "location",
        FIT_WEIGHTS.location,
        `Located in ${reply.location.place || "a target location"} — inside ${match}.`,
        [citation],
        "assist",
        null,
      );
    }
  }
  const onRecord = (evidence.location ?? "").trim();
  if (onRecord !== "") {
    const match = placeMatchesTarget(onRecord, icp.targetLocations);
    if (match) {
      return entry(
        "location",
        FIT_WEIGHTS.location,
        `The record places it in ${onRecord} — inside ${match}.`,
        [{ quote: onRecord, source: SOURCE_LOCATION }],
        "computed",
        null,
      );
    }
  }
  return entry(
    "location",
    0,
    "No cited address or recorded location inside the ICP's target locations.",
    [],
    "unanswered",
    "no cited location in target",
  );
}

function sizeEntry(
  icp: IcpDefinitionData,
  evidence: ScoringEvidence,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
  count: LocationCount | null,
): CriterionEntry {
  const band = sizeRangeLabel(icp);
  const team = teamEvidence(evidence, reply, docs);

  if (!count) {
    return entry("size", 0, `No cited location count or street address to place it in the ${band} band.`, team ? [team] : [], "unanswered", "no cited location count");
  }
  if (!sizeInRange(count.n, icp)) {
    return entry(
      "size",
      0,
      `${count.n} location${count.n === 1 ? "" : "s"} — outside the ${band} band.`,
      [count.citation],
      count.source,
      `${count.n} locations, outside ${band}`,
    );
  }
  if (!team) {
    return entry(
      "size",
      0,
      `${count.n} location${count.n === 1 ? "" : "s"}${count.inferred ? " (one street address, no other locations on the site)" : ""}, inside the band, but no named provider or staff — an unclear single provider earns no size points.`,
      [count.citation],
      count.source,
      "no named provider or staff",
    );
  }
  return entry(
    "size",
    FIT_WEIGHTS.size,
    `${count.n} location${count.n === 1 ? "" : "s"}${count.inferred ? " (one street address, no other locations on the site)" : ""}, inside the ${band} band, with named providers or staff.`,
    [count.citation, team],
    count.source,
    null,
  );
}

// ─── Reading the site directly ─────────────────────────────────────────────
//
// What the model can miss and the site states plainly. Every one of these
// returns a quote cut verbatim out of a stored page and run back through
// verifyQuote, so a fallback is held to exactly the citation rule the model is.

function websiteDocs(docs: EvidenceDoc[]): EvidenceDoc[] {
  return docs.filter(
    (d) => /^https?:\/\//i.test(d.source) || d.source === SOURCE_WEBSITE,
  );
}

// The line a match sits on, cut to a readable length around it — verbatim, so
// it verifies as a quote.
function snippetAround(text: string, index: number, length: number): string {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEndRaw = text.indexOf("\n", index + length);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  let start = lineStart;
  let end = lineEnd;
  if (end - start > 220) {
    start = Math.max(lineStart, index - 100);
    end = Math.min(lineEnd, index + length + 100);
    while (start > lineStart && /\S/.test(text[start - 1])) start--;
    while (end < lineEnd && /\S/.test(text[end])) end++;
  }
  // A one-word line — "Decompression" in a bare list of services — is too
  // short to cite on its own. Take in the list lines either side of it until
  // the quote says enough to be read, still verbatim.
  let quote = text.slice(start, end);
  for (let i = 0; i < 4 && quote.trim().split(/\s+/).length < 4; i++) {
    const before = text.lastIndexOf("\n", Math.max(0, start - 2));
    const after = text.indexOf("\n", end + 1);
    start = before === -1 ? 0 : before + 1;
    end = after === -1 ? text.length : after;
    quote = text.slice(start, end);
  }
  return quote.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findInPages(
  docs: EvidenceDoc[],
  pattern: RegExp,
): { citation: Citation; match: RegExpExecArray } | null {
  for (const doc of websiteDocs(docs)) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(doc.text)) !== null) {
      const quote = snippetAround(doc.text, m.index, m[0].length);
      const citation = verifyQuote(quote, doc.source, docs);
      if (citation) return { citation, match: m };
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return null;
}

// Every core service on the ICP, as words to look for — and "decompression"
// on its own wherever a core service is a kind of decompression, because at a
// chiropractic, PT or pain clinic that is what the word means.
export function findCoreServiceInText(
  icp: IcpDefinitionData,
  docs: EvidenceDoc[],
): { tag: string; citation: Citation } | null {
  const terms: { term: string; tag: string }[] = icp.coreServices.map((tag) => ({ term: tag, tag }));
  const decompression = icp.coreServices.find((t) => /\bdecompression\b/.test(t));
  if (decompression && !icp.coreServices.includes("decompression")) {
    terms.push({ term: "decompression", tag: decompression });
  }
  for (const { term, tag } of terms) {
    const words = term.split(/[\s-]+/).filter(Boolean).map(escapeRegExp);
    if (words.length === 0) continue;
    const found = findInPages(docs, new RegExp(`\\b${words.join("[\\s-]+")}\\b`, "i"));
    if (found) return { tag, citation: found.citation };
  }
  return null;
}

const SPECIFIC_PROGRAM =
  /\b(program|programme|protocol|decompression|disc|discs|herniat\w*|bulging|sciatica|stenosis|degenerative|flexion[- ]distraction|cox technique|drx\d*|idd therapy|spinal rehab\w*|spine center|spine centre)\b/i;
const GENERIC_PAIN_COPY =
  /\b(if you (?:suffer|have|are suffering|struggle)|suffer(?:ing)? from|do you (?:suffer|have|struggle)|struggling with|whether you)\b/i;
const NAMED_PROGRAM_IN_GENERIC = /\b(program|programme|protocol|decompression|disc treatment)\b/i;
const CONDITION_PAGE = /\/[^?#]*(back[-_]?pain|sciatica|disc|spine|spinal|herniat)/i;

// A spine, disc or back-pain program has to be something specific: a named
// program, a page of its own, or a specific modality. "If you suffer from
// back pain or a spinal condition" is a sentence every clinic site has.
export function isSpecificSpineProgram(c: Citation): boolean {
  if (/^https?:\/\//i.test(c.source) && CONDITION_PAGE.test(c.source.replace(/^https?:\/\/[^/]+/i, ""))) {
    return true;
  }
  if (GENERIC_PAIN_COPY.test(c.quote)) return NAMED_PROGRAM_IN_GENERIC.test(c.quote);
  return SPECIFIC_PROGRAM.test(c.quote);
}

export interface LocationCount {
  n: number;
  citation: Citation;
  source: CriterionSource;
  // True when read as one location from a single street address rather than
  // from a stated count.
  inferred: boolean;
}

const STREET_ADDRESS =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|ct|court|pl|place|pike|cir|circle|trl|trail)\b\.?/i;
const MULTIPLE_LOCATIONS =
  /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|several|multiple)\s+(?:locations|offices|clinics)\b|\bour locations\b|\bboth (?:locations|offices|clinics)\b|\ball locations\b|\blocations nationwide\b/i;

// How many locations, cited. A stated count first; failing that, one cited
// street address on a site that says nothing about other locations is one.
export function locationCountFinding(
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): LocationCount | null {
  if (reply?.locationCount) {
    const citation = verifyQuote(reply.locationCount.quote, reply.locationCount.source, docs);
    if (citation) return { n: reply.locationCount.count, citation, source: "assist", inferred: false };
  }
  const pages = websiteDocs(docs);
  if (pages.some((d) => MULTIPLE_LOCATIONS.test(d.text))) return null;
  const fromModel = reply?.location
    ? verifyQuote(reply.location.quote, reply.location.source, docs)
    : null;
  if (fromModel && STREET_ADDRESS.test(fromModel.quote)) {
    return { n: 1, citation: fromModel, source: "assist", inferred: true };
  }
  const found = findInPages(docs, STREET_ADDRESS);
  return found ? { n: 1, citation: found.citation, source: "computed", inferred: true } : null;
}

const NAMED_DOCTOR =
  /\bDr\.?\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?(?:,?\s+(?:D\.?C\.?|DPT|D\.?P\.?T\.?|M\.?D\.?|D\.?O\.?|PT|NP|PA-C))?/;

function findNamedDoctor(
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): { name: string; citation: Citation; fromModel: boolean } | null {
  if (reply?.decisionMaker) {
    const citation = verifyQuote(reply.decisionMaker.quote, reply.decisionMaker.source, docs);
    const m = citation ? NAMED_DOCTOR.exec(citation.quote) : null;
    if (citation && m) return { name: m[0].replace(/,\s*$/, ""), citation, fromModel: true };
  }
  const found = findInPages(docs, NAMED_DOCTOR);
  return found ? { name: found.match[0].replace(/,\s*$/, ""), citation: found.citation, fromModel: false } : null;
}

// Named providers or staff on the site, a LinkedIn headcount of two or more,
// or the model's cited team.
function teamEvidence(
  evidence: ScoringEvidence,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): Citation | null {
  if (evidence.staffCountRaw !== null && evidence.staffCountRaw >= 2) {
    return { quote: `${evidence.staffCountRaw} staff`, source: SOURCE_LINKEDIN };
  }
  if (reply?.team) {
    const citation = verifyQuote(reply.team.quote, reply.team.source, docs);
    if (citation) return citation;
  }
  return findNamedDoctor(reply, docs)?.citation ?? null;
}

// ─── The chiro real-program check ──────────────────────────────────────────
//
// Five signals, each needing its own citation under the same verbatim rule as
// every other line: a quote off a stored page, or the computed ads signal.
// Two or more and a chiropractic-first clinic's program is real.

function wordsPattern(phrase: string): string {
  return phrase
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join("[\\s-]*");
}

export function chiroProgramCheck(
  evidence: ScoringEvidence,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): ChiroProgramCheck {
  const signal = (key: ChiroSignalKey, citations: Citation[], reason: string): ChiroSignal => ({
    key,
    label: CHIRO_SIGNAL_LABELS[key],
    found: citations.length > 0,
    citations,
    reason,
  });

  // 1. A page of its own: a crawled page whose URL names it, cited with a
  // line from that page — or, where that page was not among the pages read, a
  // link to it on any page that was (menu, footer, button), cited with the
  // link's own text and target.
  let page: Citation[] = [];
  let pageReason = "A page of the site is dedicated to it.";
  for (const doc of websiteDocs(docs)) {
    if (!/^https?:\/\//i.test(doc.source)) continue;
    if (!isProgramPageUrl(doc.source)) continue;
    const firstLine = doc.text.split(/\n/).map((l) => l.trim()).find((l) => l.split(/\s+/).length >= 4);
    const citation = firstLine ? verifyQuote(clip(firstLine, 300).replace(/…$/, ""), doc.source, docs) : null;
    if (citation) {
      page = [citation];
      break;
    }
  }
  if (page.length === 0) {
    const link = parseLinks(evidence.websiteLinks ?? null).find(
      (l) => l.text.trim() !== "" && isProgramLink(l),
    );
    if (link) {
      page = [{ quote: link.text, source: link.url }];
      pageReason = `The site links to a dedicated page (found on ${link.page || "a crawled page"}).`;
    }
  }

  // 2. Named equipment, from the editable list.
  const equipment = findInPages(
    docs,
    new RegExp(`\\b(${CHIRO_EQUIPMENT.map(wordsPattern).join("|")})\\b`, "i"),
  );

  // 3. A consult offer.
  const consult = findInPages(
    docs,
    new RegExp(`\\b(${CHIRO_CONSULT_PHRASES.map((p) => wordsPattern(p.replace(/'/g, "'?"))).join("|")})`, "i"),
  );

  // 4. Two or more named providers or staff: the model's cited team, or two
  // different named doctors on the site.
  // Named means named: "and our associate doctors" is a team, but not one
  // with two names in it, so only a quote carrying two names counts.
  let team: Citation[] = [];
  if (reply?.team && (reply.team.providers ?? 0) >= 2) {
    const citation = verifyQuote(reply.team.quote, reply.team.source, docs);
    const names = citation ? citation.quote.match(new RegExp(NAMED_DOCTOR.source, "g")) ?? [] : [];
    if (citation && new Set(names.map((n) => n.replace(/,.*$/, "").trim())).size >= 2) team = [citation];
  }
  if (team.length === 0) {
    const names = new Map<string, Citation>();
    for (const doc of websiteDocs(docs)) {
      const re = new RegExp(NAMED_DOCTOR.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(doc.text)) !== null) {
        const name = m[0].replace(/,.*$/, "").replace(/\s+/g, " ").trim();
        if (names.has(name)) continue;
        const citation = verifyQuote(snippetAround(doc.text, m.index, m[0].length), doc.source, docs);
        if (citation) names.set(name, citation);
      }
    }
    if (names.size >= 2) team = Array.from(names.values()).slice(0, 3);
  }

  // 5. Running ads — the existing computed signal.
  const ads = hasActiveAds(evidence.metaAdsSignal)
    ? [{ quote: (evidence.metaAdsSignal ?? "").trim(), source: SOURCE_ADS }]
    : [];

  const signals = [
    signal("page", page, page.length ? pageReason : "No crawled page, and no link on one, is dedicated to decompression, disc, sciatica or avoiding surgery."),
    signal("equipment", equipment ? [equipment.citation] : [], equipment ? `Names ${equipment.match[0]}.` : "No named table or laser on the site."),
    signal("consult", consult ? [consult.citation] : [], consult ? "Offers a consult." : "No consult offer on the site."),
    signal("team", team, team.length ? "Two or more providers or staff are named." : "Fewer than two named providers or staff."),
    signal("ads", ads, ads.length ? "Ads are running now." : "No ads running."),
  ];
  return {
    signals,
    count: signals.filter((x) => x.found).length,
    required: CHIRO_PROGRAM_MIN_SIGNALS,
  };
}

// ─── The summary has to agree with the scores ──────────────────────────────
//
// The model's "Overall fit" sentence is read for the facts it states. Where it
// states one — a service offered, a single location, a named doctor — the
// matching criterion may not sit at "no evidence": the fallbacks above have
// already looked for the quote, and if none was found the criterion is marked
// for review rather than silently scored as if nothing were said.
const SUMMARY_CLAIMS: { key: FitKey; pattern: (icp: IcpDefinitionData) => RegExp; said: string }[] = [
  {
    key: "service",
    pattern: (icp) =>
      new RegExp(
        `\\b(${[...icp.coreServices, "decompression"].map((t) => t.split(/\s+/).map(escapeRegExp).join("\\s+")).join("|")})\\b`,
        "i",
      ),
    said: "names a core service",
  },
  { key: "size", pattern: () => /\b(single|one|1)[- ](location|office|clinic)\b|\bsingle-site\b/i, said: "says it is a single location" },
  { key: "title", pattern: () => /\bDr\.?\s+[A-Z]/, said: "names a doctor" },
];

export function summaryConsistency(
  summary: string,
  fit: CriterionEntry[],
  icp: IcpDefinitionData,
  notes: string[],
): CriterionEntry[] {
  if (summary.trim() === "") return fit;
  return fit.map((e) => {
    const claim = SUMMARY_CLAIMS.find((c) => c.key === e.key);
    if (!claim || e.source !== "unanswered" || !claim.pattern(icp).test(summary)) return e;
    notes.push(
      `The overall-fit summary ${claim.said}, but no quote for it was found in the stored evidence — ${e.label.toLowerCase()} needs a look by hand.`,
    );
    return {
      ...e,
      source: "assist",
      reason: `The summary ${claim.said} (“${clip(summary, 160)}”), but no quote for it was found in the stored evidence, so it earns no points until checked by hand. ${e.reason}`,
      shortfall: `${e.shortfall ?? "no citation"} — summary disagrees, check by hand`,
    };
  });
}

// ─── Signals ───────────────────────────────────────────────────────────────

function triggersEntry(
  icp: IcpDefinitionData,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): CriterionEntry {
  const lines = buyingTriggerLines(icp);
  if (lines.length === 0) {
    return entry("triggers", 0, "The active ICP lists no buying triggers yet, so there is nothing to find.", [], "unanswered", "no triggers defined");
  }
  const parts: CriterionPart[] = [];
  const seen = new Set<string>();
  for (const found of reply?.buyingTriggers ?? []) {
    const index = lines.findIndex((_, i) => triggerId(i) === found.id);
    if (index === -1 || seen.has(found.id)) continue;
    const citation = verifyQuote(found.quote, found.source, docs);
    if (!citation) continue;
    seen.add(found.id);
    parts.push({
      label: lines[index],
      points: SIGNAL_WEIGHTS.buyingTriggerEach,
      max: SIGNAL_WEIGHTS.buyingTriggerEach,
      reason: clip((found.reason ?? "").trim(), 200),
      citation,
    });
  }
  const points = Math.min(
    parts.length * SIGNAL_WEIGHTS.buyingTriggerEach,
    SIGNAL_WEIGHTS.buyingTriggersMax,
  );
  return entry(
    "triggers",
    points,
    parts.length === 0
      ? `None of the ${lines.length} buying trigger${lines.length === 1 ? "" : "s"} was found with a citation.`
      : `${parts.length} buying trigger${parts.length === 1 ? "" : "s"} found: ${parts.map((p) => p.label).join("; ")}.`,
    parts.flatMap((p) => (p.citation ? [p.citation] : [])),
    parts.length === 0 ? "unanswered" : "assist",
    "no cited trigger",
    parts,
  );
}

// The existing Budget Signal computation, read onto this scale.
function budgetEntry(evidence: ScoringEvidence): CriterionEntry {
  const score = budgetSignalScore(evidence.metaAdsSignal, evidence.reviewCount);
  const points =
    score.points >= 2
      ? SIGNAL_WEIGHTS.budgetActiveAds
      : score.points === 1
        ? SIGNAL_WEIGHTS.budgetHealthyReviews
        : 0;
  const citations: Citation[] = [];
  if (score.points >= 2) citations.push({ quote: (evidence.metaAdsSignal ?? "").trim(), source: SOURCE_ADS });
  else if (score.points === 1 && evidence.reviewCount !== null) {
    citations.push({ quote: `${evidence.reviewCount} Google reviews`, source: SOURCE_MAPS });
  }
  return entry("budget", points, score.reason, citations, "computed", "no ads running and no healthy review count");
}

const GAP_ANSWER_KEYS: Record<IcpGapKey, GapAnswerKey> = {
  icpGapBooking: "gapBooking",
  icpGapReviews: "gapReviews",
  icpGapRemarketing: "gapRemarketing",
};

const GAP_POINTS: Record<IcpGapKey, number> = {
  icpGapBooking: SIGNAL_WEIGHTS.gapBooking,
  icpGapReviews: SIGNAL_WEIGHTS.gapReviews,
  icpGapRemarketing: SIGNAL_WEIGHTS.gapRemarketing,
};

// The existing automation-gap computation: the keyword pre-check over the
// crawled pages, confirmed or overturned by the model with a reason.
function gapsEntry(
  reply: ScoringReply | null,
  precheck: Record<IcpGapKey, GapPrecheck> | null,
): CriterionEntry {
  const parts: CriterionPart[] = ICP_GAPS.map((gap) => {
    const answer = reply?.gaps[GAP_ANSWER_KEYS[gap.key]];
    const scan = precheck?.[gap.key] ?? null;
    const note = scan ? precheckNote(scan).trim() : "";
    return {
      label: gap.label,
      points: answer?.checked ? GAP_POINTS[gap.key] : 0,
      max: GAP_POINTS[gap.key],
      reason: answer
        ? `${answer.reason}${note ? ` ${note}` : ""}`
        : "The evidence said nothing about this gap either way.",
      citation: note ? { quote: note, source: SOURCE_PRECHECK } : null,
    };
  });
  const points = parts.reduce((s, p) => s + p.points, 0);
  const found = parts.filter((p) => p.points > 0);
  return entry(
    "gaps",
    points,
    found.length === 0
      ? "No automation gap confirmed."
      : `${found.length} gap${found.length === 1 ? "" : "s"} confirmed: ${found.map((p) => p.label.toLowerCase()).join("; ")}.`,
    parts.flatMap((p) => (p.citation ? [p.citation] : [])),
    reply ? "assist" : "unanswered",
    "no confirmed gaps",
    parts,
  );
}

// ─── Chiro hold and payment model ──────────────────────────────────────────

function primaryServiceFinding(
  evidence: ScoringEvidence,
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): PrimaryServiceFinding {
  if (reply?.primaryService) {
    const citation = verifyQuote(reply.primaryService.quote, reply.primaryService.source, docs);
    if (citation) {
      const chiro = reply.primaryService.service === "chiropractic";
      return {
        service: reply.primaryService.service,
        chiropractic: chiro,
        citation,
        reason: `Primary service read as ${reply.primaryService.service}.`,
      };
    }
  }
  // No cited answer. The clinic's own name is a citation the app can make for
  // itself, and "Smith Chiropractic" is a clinic that leads with chiropractic.
  if (/\bchiropract/i.test(evidence.clinicName)) {
    return {
      service: "chiropractic",
      chiropractic: true,
      citation: { quote: evidence.clinicName, source: SOURCE_CLINIC_NAME },
      reason: "Primary service read off the clinic's name.",
    };
  }
  return {
    service: null,
    chiropractic: false,
    citation: null,
    reason: "No cited primary service.",
  };
}

function paymentModelFinding(
  reply: ScoringReply | null,
  docs: EvidenceDoc[],
): PaymentModelFinding {
  if (reply?.paymentModel) {
    const citation = verifyQuote(reply.paymentModel.quote, reply.paymentModel.source, docs);
    if (citation) {
      // The same rule as the disqualifier: insurance-only takes an explicit
      // statement, not an insurer list.
      if (reply.paymentModel.model === "insurance" && !isExplicitInsuranceOnly(citation.quote)) {
        return {
          model: "unknown",
          citation,
          reason: "Insurers are listed, but nothing says insurance is the only option.",
        };
      }
      return {
        model: reply.paymentModel.model,
        citation,
        reason: clip((reply.paymentModel.reason ?? "").trim(), 200) || `Read as ${PAYMENT_MODEL_LABELS[reply.paymentModel.model].toLowerCase()}.`,
      };
    }
  }
  return { model: "unknown", citation: null, reason: "No cited statement of how the clinic is paid." };
}

// ─── After the run ─────────────────────────────────────────────────────────

// The one post-model evidence check. A crawl that only returned page titles is
// real evidence but thin, and a clinic that earned nothing on fit from it has
// not been judged — it has not been read. Failed rather than "Not a fit".
export function thinEvidenceFailure(
  evidence: ScoringEvidence,
  breakdown: IcpBreakdownV2,
): string | null {
  const notes = (evidence.websiteNotes ?? "").trim();
  if (!notes.startsWith(META_ONLY_PREFIX)) return null;
  if (breakdown.disqualifiers.some((d) => d.triggered)) return null;
  if (breakdown.fitTotal > 0) return null;
  return "Not enough evidence to judge fit: the website returned only page titles and descriptions, and none of them cited a service, a person or a location. Nothing was scored — check the website URL and run it again.";
}

// ─── Overrides, from the lead's card ───────────────────────────────────────

export interface V2Override {
  points: Partial<Record<CriterionKey, number>>;
  disqualifiers: Record<string, boolean>;
  chiropractic?: boolean;
  note: string | null;
}

// Applies what somebody set by hand on the card. Each changed line is marked
// as an override and keeps what the run had scored, so the card can show both;
// the verdict is then decided by the same rules a run uses.
export function applyOverride(
  b: IcpBreakdownV2,
  override: V2Override,
  now: Date,
): IcpBreakdownV2 {
  // What the run said stays on each line untouched — its source, its reason,
  // its citations. An override is recorded only as the value the run had
  // (scoredPoints, scoredTriggered), which is what the card reads to say
  // "Overridden — was 10", and setting a line back to that value removes it.
  const adjust = (e: CriterionEntry): CriterionEntry => {
    const wanted = override.points[e.key];
    if (wanted === undefined || !Number.isFinite(wanted)) return e;
    const points = Math.min(Math.max(Math.round(wanted), 0), e.max);
    const original = e.scoredPoints ?? e.points;
    const { scoredPoints: _drop, ...rest } = e;
    void _drop;
    return {
      ...rest,
      points,
      shortfall: points >= e.max ? null : e.shortfall ?? "set by hand",
      ...(points === original ? {} : { scoredPoints: original }),
    };
  };
  const disqualifiers = b.disqualifiers.map((d) => {
    const wanted = override.disqualifiers[d.id];
    if (wanted === undefined) return d;
    const original = d.scoredTriggered ?? d.triggered;
    const { scoredTriggered: _drop, ...rest } = d;
    void _drop;
    return {
      ...rest,
      triggered: wanted,
      ...(wanted === original ? {} : { scoredTriggered: original }),
    };
  });
  const primaryService =
    override.chiropractic === undefined
      ? b.primaryService
      : { ...b.primaryService, chiropractic: override.chiropractic };
  return finish(
    {
      ...b,
      fit: b.fit.map(adjust),
      signals: b.signals.map(adjust),
      disqualifiers,
      primaryService,
      overriddenAt: now.toISOString(),
      overrideNote: override.note ?? b.overrideNote,
    },
    b.verdict.threshold,
  );
}

// Whether a line on the card was changed by hand from what the run scored.
export function isOverridden(e: CriterionEntry): boolean {
  return e.scoredPoints !== undefined;
}

// The point values a criterion can actually take, for the card's override
// controls and for checking what a posted override asks for. Anything else is
// not a score this model can give.
export function allowedPoints(key: CriterionKey): number[] {
  const values = new Set<number>([0]);
  switch (key) {
    case "service":
      values.add(FIT_WEIGHTS.serviceAdjacentWithSpineProgram);
      values.add(FIT_WEIGHTS.serviceCore);
      break;
    case "title":
    case "location":
    case "size":
      values.add(CRITERION_MAX[key]);
      break;
    case "triggers":
      for (let p = SIGNAL_WEIGHTS.buyingTriggerEach; p <= SIGNAL_WEIGHTS.buyingTriggersMax; p += SIGNAL_WEIGHTS.buyingTriggerEach) {
        values.add(p);
      }
      break;
    case "budget":
      values.add(SIGNAL_WEIGHTS.budgetHealthyReviews);
      values.add(SIGNAL_WEIGHTS.budgetActiveAds);
      break;
    case "gaps": {
      // Every combination of the three gaps.
      const gaps = [SIGNAL_WEIGHTS.gapBooking, SIGNAL_WEIGHTS.gapReviews, SIGNAL_WEIGHTS.gapRemarketing];
      for (let mask = 1; mask < 1 << gaps.length; mask++) {
        values.add(gaps.reduce((sum, g, i) => (mask & (1 << i) ? sum + g : sum), 0));
      }
      break;
    }
  }
  return Array.from(values).sort((a, b) => a - b);
}

// A disqualifier set from outside the card — the copilot's DISQUALIFY_LEAD,
// confirmed by a person. It names the old scorecard's disqualifier it was
// proposed as, so it is added as its own line rather than mapped onto one of
// the ICP's, and it gates the card exactly as a cited one does.
export function addManualDisqualifier(
  b: IcpBreakdownV2,
  label: string,
  reason: string,
  now: Date,
): IcpBreakdownV2 {
  const id = `manual${b.disqualifiers.filter((d) => d.id.startsWith("manual")).length + 1}`;
  return finish(
    {
      ...b,
      disqualifiers: [
        ...b.disqualifiers,
        {
          id,
          label,
          triggered: true,
          citation: null,
          reason,
          source: "override",
          discarded: null,
          scoredTriggered: false,
        },
      ],
      overriddenAt: now.toISOString(),
    },
    b.verdict.threshold,
  );
}

// A card nobody has scored yet, against the active ICP: every line at zero
// and waiting, for a lead somebody wants to score by hand.
export function emptyBreakdownV2(
  icp: IcpDefinitionData,
  threshold: number,
  now: Date,
): IcpBreakdownV2 {
  const blank = (key: CriterionKey): CriterionEntry =>
    entry(key, 0, "Not scored yet.", [], "unanswered", "not scored");
  return finish(
    {
      model: "v2",
      version: BREAKDOWN_V2_VERSION,
      icp: { id: icp.id, name: icp.name, updatedAt: icp.updatedAt },
      disqualifiers: disqualifierLines(icp).map((label, i) => ({
        id: dqId(i),
        label,
        triggered: false,
        citation: null,
        reason: "Not checked.",
        source: "unanswered",
        discarded: null,
      })),
      fit: FIT_KEYS.map(blank),
      signals: SIGNAL_KEYS.map(blank),
      primaryService: { service: null, chiropractic: false, citation: null, reason: "Not checked." },
      paymentModel: { model: "unknown", citation: null, reason: "Not checked." },
      chiroProgram: {
        signals: CHIRO_SIGNAL_KEYS.map((key) => ({
          key,
          label: CHIRO_SIGNAL_LABELS[key],
          found: false,
          citations: [],
          reason: "Not checked — score against the ICP to read the site.",
        })),
        count: 0,
        required: CHIRO_PROGRAM_MIN_SIGNALS,
      },
      summary: "",
      evidence: [],
      notes: [],
      scoredAt: now.toISOString(),
    },
    threshold,
  );
}

// ─── Storing and reading ───────────────────────────────────────────────────

export function serializeBreakdownV2(b: IcpBreakdownV2): string {
  return JSON.stringify(b);
}

// Whether a stored breakdown string is a new-model one, without reading it.
export function isV2BreakdownJson(raw: string | null | undefined): boolean {
  return typeof raw === "string" && raw.includes('"model":"v2"');
}

// Reads a stored v2 breakdown back. Never throws, never half-reads: anything
// that is not one comes back null, exactly as parseBreakdown treats an old one.
export function parseBreakdownV2(raw: string | null | undefined): IcpBreakdownV2 | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const b = parsed as Partial<IcpBreakdownV2>;
  if (b.model !== "v2") return null;
  if (!Array.isArray(b.fit) || !Array.isArray(b.signals) || !Array.isArray(b.disqualifiers)) {
    return null;
  }
  const tier = b.tier;
  if (tier !== "A" && tier !== "B" && tier !== "C" && tier !== "DISQUALIFIED") return null;
  if (!b.verdict || typeof b.verdict !== "object") return null;
  return {
    model: "v2",
    version: typeof b.version === "number" ? b.version : 0,
    icp: {
      id: b.icp?.id ?? "",
      name: b.icp?.name ?? "an ICP",
      updatedAt: b.icp?.updatedAt ?? "",
    },
    disqualifiers: (b.disqualifiers as unknown[]).filter(isObject).map((d) => ({
      id: String(d.id ?? ""),
      label: String(d.label ?? ""),
      triggered: d.triggered === true,
      citation: readCitation(d.citation),
      reason: typeof d.reason === "string" ? d.reason : "",
      source: readSource(d.source),
      discarded: typeof d.discarded === "string" ? d.discarded : null,
      ...(typeof d.scoredTriggered === "boolean" ? { scoredTriggered: d.scoredTriggered } : {}),
    })),
    fit: (b.fit as unknown[]).filter(isObject).map(readEntry),
    signals: (b.signals as unknown[]).filter(isObject).map(readEntry),
    fitTotal: num(b.fitTotal),
    signalsTotal: num(b.signalsTotal),
    ungatedTotal: num(b.ungatedTotal),
    total: num(b.total),
    tier,
    primaryService: {
      service: (PRIMARY_SERVICES as readonly string[]).includes(String(b.primaryService?.service))
        ? (b.primaryService!.service as PrimaryService)
        : null,
      chiropractic: b.primaryService?.chiropractic === true,
      citation: readCitation(b.primaryService?.citation),
      reason: typeof b.primaryService?.reason === "string" ? b.primaryService.reason : "",
    },
    paymentModel: {
      model: (PAYMENT_MODELS as readonly string[]).includes(String(b.paymentModel?.model))
        ? (b.paymentModel!.model as PaymentModel)
        : "unknown",
      citation: readCitation(b.paymentModel?.citation),
      reason: typeof b.paymentModel?.reason === "string" ? b.paymentModel.reason : "",
    },
    chiroProgram: readChiroProgram(b.chiroProgram),
    // A breakdown written under the retired Tier 2 chiro hold reads as a
    // chiro rejection pending the real-program check, never as a hold.
    verdict: (b.verdict.status as string) === "HELD_CHIRO" || (b.verdict.kind as string) === "held_chiro"
      ? {
          status: "REJECTED",
          kind: "chiro_no_program",
          reason: "Scored under the retired Tier 2 chiro hold — it has not had the real-program check yet.",
          threshold: num(b.verdict.threshold),
          fitFloor: num(b.verdict.fitFloor) || FIT_FLOOR,
        }
      : {
          status: b.verdict.status === "PROMOTED" ? "PROMOTED" : "REJECTED",
          kind: b.verdict.kind ?? "below_threshold",
          reason: typeof b.verdict.reason === "string" ? b.verdict.reason : "",
          threshold: num(b.verdict.threshold),
          fitFloor: num(b.verdict.fitFloor) || FIT_FLOOR,
        },
    summary: typeof b.summary === "string" ? b.summary : "",
    evidence: Array.isArray(b.evidence) ? b.evidence.filter((s): s is string => typeof s === "string") : [],
    notes: Array.isArray(b.notes) ? b.notes.filter((s): s is string => typeof s === "string") : [],
    scoredAt: typeof b.scoredAt === "string" ? b.scoredAt : "",
    ...(typeof b.overriddenAt === "string" ? { overriddenAt: b.overriddenAt } : {}),
    ...(typeof b.overrideNote === "string" ? { overrideNote: b.overrideNote } : {}),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function readSource(v: unknown): CriterionSource {
  return v === "computed" || v === "assist" || v === "override" ? v : "unanswered";
}

function readCitation(v: unknown): Citation | null {
  if (!isObject(v)) return null;
  if (typeof v.quote !== "string" || typeof v.source !== "string") return null;
  return { quote: v.quote, source: v.source };
}

function readEntry(e: Record<string, unknown>): CriterionEntry {
  const keys: readonly string[] = [...FIT_KEYS, ...SIGNAL_KEYS];
  const key = typeof e.key === "string" && keys.includes(e.key) ? (e.key as CriterionKey) : "service";
  return {
    key,
    label: typeof e.label === "string" ? e.label : CRITERION_LABELS[key],
    points: num(e.points),
    max: num(e.max),
    citations: Array.isArray(e.citations)
      ? e.citations.map(readCitation).filter((c: Citation | null): c is Citation => c !== null)
      : [],
    reason: typeof e.reason === "string" ? e.reason : "",
    source: readSource(e.source),
    shortfall: typeof e.shortfall === "string" ? e.shortfall : null,
    ...(Array.isArray(e.parts)
      ? {
          parts: e.parts.filter(isObject).map((p) => ({
            label: String(p.label ?? ""),
            points: num(p.points),
            max: num(p.max),
            reason: typeof p.reason === "string" ? p.reason : "",
            citation: readCitation(p.citation),
          })),
        }
      : {}),
    ...(typeof e.scoredPoints === "number" ? { scoredPoints: e.scoredPoints } : {}),
  };
}

function readChiroProgram(v: unknown): ChiroProgramCheck | null {
  if (!isObject(v) || !Array.isArray(v.signals)) return null;
  const signals = (v.signals as unknown[]).filter(isObject).flatMap((x): ChiroSignal[] => {
    const key = (CHIRO_SIGNAL_KEYS as readonly string[]).includes(String(x.key)) ? (x.key as ChiroSignalKey) : null;
    if (!key) return [];
    const citations = Array.isArray(x.citations)
      ? (x.citations as unknown[]).map(readCitation).filter((c): c is Citation => c !== null)
      : [];
    return [{ key, label: CHIRO_SIGNAL_LABELS[key], found: x.found === true && citations.length > 0, citations, reason: typeof x.reason === "string" ? x.reason : "" }];
  });
  return {
    signals,
    count: signals.filter((x) => x.found).length,
    required: num(v.required) || CHIRO_PROGRAM_MIN_SIGNALS,
  };
}

// Re-judges a stored breakdown with the real-program check worked out afresh
// from the record's stored evidence — no model call, nothing re-scored. For
// candidates scored under the retired hold, and nothing else.
export function rejudgeChiroProgram(
  b: IcpBreakdownV2,
  evidence: ScoringEvidence,
): IcpBreakdownV2 {
  return finish({ ...b, chiroProgram: chiroProgramCheck(evidence, null, evidenceDocs(evidence)) }, b.verdict.threshold);
}

export function triggeredHits(b: IcpBreakdownV2): DisqualifierHit[] {
  return b.disqualifiers.filter((d) => d.triggered);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export { FIT_FLOOR, FIT_MAX, SIGNALS_MAX, V2_MAX_SCORE };
