// Discovery — the qualification step that sits in front of the pipeline.
//
// The rule it exists to enforce is one line long: nothing reaches Pipeline
// unscored. Imports land here as DiscoveryCandidate rows, the queue runs each
// one through enrichment and scoring, and a candidate becomes a Lead only by
// scoring 5 or more out of 10 on the framework in src/lib/icp.ts.
//
// This module is the framework's discovery half, and it is pure: the statuses,
// the two categories that can be worked out from the data without asking
// anybody, the shape of the stored reasoning, and the translation of that
// reasoning into a lead's scorecard. Nothing here touches the network or the
// database — src/lib/actions/discovery.ts does the running, and
// src/lib/discoveryAssist.ts owns the prompt.
//
// One thing here breaks a rule the rest of the app keeps, deliberately. A
// lead's total and tier are always derived from its stored answers, never
// persisted, so re-tuning the bands re-tiers every lead. A candidate's total,
// tier and breakdown *are* stored, because they are not an opinion the app
// holds today — they are the transcript of one automated run against the
// evidence it had on the day, including what a model said and why. Re-tuning
// the framework must not silently rewrite the reason a clinic was rejected
// last month. It should be re-run.

import {
  ICP_CATEGORIES,
  ICP_DISQUALIFIERS,
  ICP_GAPS,
  ICP_GAP_KEYS,
  ICP_MAX_SCORE,
  IcpCategoryKey,
  IcpDisqualifierKey,
  IcpGapKey,
  IcpTier,
  suggestedStaffSizeScore,
  tierForScore,
} from "@/lib/icp";

// ─── Status ────────────────────────────────────────────────────────────────

export const DISCOVERY_STATUSES = [
  "PENDING",
  "ENRICHING",
  "SCORED",
  "PROMOTED",
  "REJECTED",
  "FAILED",
] as const;

export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];

export const DISCOVERY_STATUS_LABELS: Record<DiscoveryStatus, string> = {
  PENDING: "Pending",
  ENRICHING: "Enriching",
  SCORED: "Scored",
  PROMOTED: "Promoted",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

// What each status means for the person looking at the list, in one line.
// Carried as the status badge's hover title, the same way the ICP tier carries
// its action.
export const DISCOVERY_STATUS_MEANINGS: Record<DiscoveryStatus, string> = {
  PENDING: "Imported, never processed — the next queue run will pick it up",
  ENRICHING: "A run had this one when it stopped — the next run starts it over",
  SCORED: "Scored, but neither promoted nor rejected — the next run finishes it",
  PROMOTED: "Became a lead in the pipeline — by scoring 5+, or by override",
  REJECTED: "Disqualified, or scored C-tier — kept with its reasoning",
  FAILED: "An actor failed outright, so nothing was scored on partial evidence",
};

export function isDiscoveryStatus(v: unknown): v is DiscoveryStatus {
  return (
    typeof v === "string" &&
    (DISCOVERY_STATUSES as readonly string[]).includes(v)
  );
}

// What "Process queue" picks up: everything that has not reached a settled
// outcome. Pending is the ordinary case and Failed is the retry the brief asks
// for; Enriching and Scored are here because this queue runs in a browser tab
// and a tab can be closed mid-candidate. A record left part-way through must
// not be stranded in a state nothing ever looks at again, so the definition is
// the honest one — anything that is not Promoted or Rejected is unfinished
// work — and a candidate is processed from the top each time rather than
// resumed, since half a run's evidence is exactly what this flow refuses to
// score on.
export const DISCOVERY_QUEUE_STATUSES: DiscoveryStatus[] = [
  "PENDING",
  "FAILED",
  "ENRICHING",
  "SCORED",
];

// ─── The two categories that need no model ─────────────────────────────────
//
// A and C are the ones whose answers are already in the data by the time
// scoring starts: a headcount is a number, and the ads signal says in words
// whether anything is running. Working them out here rather than asking is not
// only cheaper — it is the difference between an answer that is the same every
// time and one that is a model's reading of a number it was handed.

// What the Budget Signal category counts as "healthy reviews" when there are
// no ads to go on. The framework's own wording is "steady recent review
// velocity implying healthy patient volume", which is a judgement; this is the
// one number that turns it into a rule, and it is stated once, here.
//
// Twenty-five is a clinic that has been asking, for a while. Below it the
// count says nothing either way about capacity to spend.
export const HEALTHY_REVIEW_COUNT = 25;

// Whether the Meta ads signal describes ads running *now*. The signal is built
// by src/lib/leadEnrich.ts and is one of two shapes — "3 active ads, running
// 4mo" or "No active ads — 12 in the library, last ended 3mo ago" — so this
// reads the first and is deliberately strict about it: anything it does not
// recognise counts as no ads rather than as ads, because scoring 2 points off
// a sentence nobody parsed would be the expensive mistake.
export function hasActiveAds(signal: string | null | undefined): boolean {
  return /^\s*\d+\+?\s+active ad/i.test(signal ?? "");
}

export interface DeterministicScore {
  points: number;
  reason: string;
}

// A — Staff Size Fit, off the headcount, using the same bands the lead
// scorecard offers (suggestedStaffSizeScore in src/lib/icp.ts) so a candidate
// and a lead can never read the same number two different ways.
//
// No headcount scores 0 with the absence named. It is the conservative read,
// and the alternative — leaving the category out of the total — would give a
// clinic nobody could size a better score than one measured and found too big.
export function staffSizeScore(
  staffCountRaw: number | null | undefined,
): DeterministicScore {
  const points = suggestedStaffSizeScore(staffCountRaw);
  if (points === null || staffCountRaw == null) {
    return {
      points: 0,
      reason:
        "No staff count was gathered, so there is nothing to size this clinic on.",
    };
  }
  const band =
    points === 2
      ? "inside the 3–15 band"
      : points === 1
        ? "on the borderline band (2, or 16–20)"
        : staffCountRaw <= 1
          ? "a single-hand operation"
          : "past 20 — a group too large for the model";
  return {
    points,
    reason: `Reported headcount of ${staffCountRaw}, ${band}.`,
  };
}

// C — Budget Signal. Active ads are evidence of spend; failing that, a healthy
// review count is evidence of the volume that pays for it; failing both, there
// is nothing to score.
export function budgetSignalScore(
  metaAdsSignal: string | null | undefined,
  reviewCount: number | null | undefined,
): DeterministicScore {
  const signal = (metaAdsSignal ?? "").trim();
  if (hasActiveAds(signal)) {
    return { points: 2, reason: `Ads running now — ${signal}.` };
  }
  if (reviewCount != null && reviewCount >= HEALTHY_REVIEW_COUNT) {
    return {
      points: 1,
      reason: `No ads running, but ${reviewCount} Google reviews imply the patient volume to fund them.`,
    };
  }
  const adsPart =
    signal === ""
      ? "No ads signal was gathered"
      : `No ads running (${signal})`;
  const reviewPart =
    reviewCount == null
      ? "and no review count to read capacity off"
      : `and ${reviewCount} reviews is below the ${HEALTHY_REVIEW_COUNT} this reads as healthy volume`;
  return { points: 0, reason: `${adsPart}, ${reviewPart}.` };
}

// ─── The stored breakdown ──────────────────────────────────────────────────

// Where an answer came from. Kept per answer rather than per run because a
// single breakdown carries both kinds: A and C are arithmetic, B and the gaps
// are a model's reading confirmed against a keyword pre-check, and a reader
// deciding how much to trust a line needs to know which they are looking at.
export type DiscoveryScoreSource = "computed" | "assist" | "unanswered";

export const DISCOVERY_SOURCE_LABELS: Record<DiscoveryScoreSource, string> = {
  computed: "Computed",
  assist: "DeepSeek",
  unanswered: "No answer",
};

export interface DiscoveryScoreEntry {
  key: string;
  label: string;
  points: number;
  max: number;
  reason: string;
  source: DiscoveryScoreSource;
}

export interface DiscoveryDisqualifierEntry {
  key: string;
  label: string;
  triggered: boolean;
  reason: string;
}

// The whole transcript of one scoring run, stored as JSON on the candidate.
// Versioned because it is stored: a row written today has to stay readable
// after the shape moves on, and parseBreakdown below is where that promise is
// kept.
export const DISCOVERY_BREAKDOWN_VERSION = 1;

export interface DiscoveryBreakdown {
  version: number;
  disqualifiers: DiscoveryDisqualifierEntry[];
  categories: DiscoveryScoreEntry[];
  gaps: DiscoveryScoreEntry[];
  total: number;
  tier: IcpTier;
  // The model's two or three sentences on overall fit, or "" if none came back.
  summary: string;
  // Which enrichment fields the scoring actually had, named for the reader —
  // "Website notes, Review count". A breakdown that scored on two fields
  // should not read like one that scored on four.
  evidence: string[];
  // Anything the run wants on the record beside the scores: an actor that was
  // skipped, a Maps search that came back ambiguous, a model that declined to
  // answer a category.
  notes: string[];
  scoredAt: string;
}

export function serializeBreakdown(breakdown: DiscoveryBreakdown): string {
  return JSON.stringify(breakdown);
}

// Reads a stored breakdown back. Never throws and never half-reads: anything
// that is not a whole breakdown comes back as null, and the views treat that
// the same way they treat a candidate that has never been scored — because a
// breakdown nobody can display is exactly that.
export function parseBreakdown(raw: string | null | undefined): DiscoveryBreakdown | null {
  if (!raw) return null;
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
  const tier = body.tier;
  if (
    tier !== "A" &&
    tier !== "B" &&
    tier !== "C" &&
    tier !== "DISQUALIFIED"
  ) {
    return null;
  }
  return {
    version: typeof body.version === "number" ? body.version : 0,
    disqualifiers: readDisqualifiers(body.disqualifiers),
    categories: readEntries(body.categories),
    gaps: readEntries(body.gaps),
    total: typeof body.total === "number" ? body.total : 0,
    tier,
    summary: typeof body.summary === "string" ? body.summary : "",
    evidence: readStrings(body.evidence),
    notes: readStrings(body.notes),
    scoredAt: typeof body.scoredAt === "string" ? body.scoredAt : "",
  };
}

function readEntries(raw: unknown): DiscoveryScoreEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): DiscoveryScoreEntry[] => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.key !== "string" || typeof entry.label !== "string") {
      return [];
    }
    const source = entry.source;
    return [
      {
        key: entry.key,
        label: entry.label,
        points: typeof entry.points === "number" ? entry.points : 0,
        max: typeof entry.max === "number" ? entry.max : 0,
        reason: typeof entry.reason === "string" ? entry.reason : "",
        source:
          source === "computed" || source === "assist" || source === "unanswered"
            ? source
            : "unanswered",
      },
    ];
  });
}

function readDisqualifiers(raw: unknown): DiscoveryDisqualifierEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): DiscoveryDisqualifierEntry[] => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.key !== "string" || typeof entry.label !== "string") {
      return [];
    }
    return [
      {
        key: entry.key,
        label: entry.label,
        triggered: entry.triggered === true,
        reason: typeof entry.reason === "string" ? entry.reason : "",
      },
    ];
  });
}

function readStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

// ─── Building one ──────────────────────────────────────────────────────────

// Everything the scoring step has to work with, from both sides: the two
// categories worked out from the data, and whatever the model was willing to
// answer. Declared as its own type so the action that fills it in and the
// function that turns it into a total cannot drift apart.
export interface DiscoveryScoringInput {
  staffSize: DeterministicScore;
  budgetSignal: DeterministicScore;
  packageEconomics: DeterministicScore | null;
  // One per gap key the model answered; a gap it declined to answer is absent
  // and scores nothing.
  gaps: Partial<Record<IcpGapKey, { checked: boolean; reason: string }>>;
  disqualifiers: Partial<
    Record<IcpDisqualifierKey, { triggered: boolean; reason: string }>
  >;
  summary: string;
  evidence: string[];
  notes: string[];
}

const CATEGORY_SOURCES: Record<IcpCategoryKey, DiscoveryScoreSource> = {
  icpStaffSize: "computed",
  icpBudgetSignal: "computed",
  icpPackageEconomics: "assist",
};

// Combines both halves into a total, a tier and the transcript behind them.
// The bands are the framework's own (tierForScore in src/lib/icp.ts), so
// 8–10 / 5–7 / 0–4 is stated in exactly one place in the app.
//
// A disqualified candidate still carries its full category scores. They cost
// nothing to keep, and "disqualified, and would have scored 8" is the shape of
// the one clinic somebody will want to look at again.
export function buildBreakdown(
  input: DiscoveryScoringInput,
  now: Date,
): DiscoveryBreakdown {
  const scores: Record<IcpCategoryKey, DeterministicScore | null> = {
    icpStaffSize: input.staffSize,
    icpPackageEconomics: input.packageEconomics,
    icpBudgetSignal: input.budgetSignal,
  };

  const categories: DiscoveryScoreEntry[] = ICP_CATEGORIES.map((category) => {
    const score = scores[category.key];
    return {
      key: category.key,
      label: `${category.letter} — ${category.title}`,
      points: score ? clamp(score.points, category.max) : 0,
      max: category.max,
      reason: score
        ? score.reason
        : "The evidence did not support a call either way, so this category scores 0.",
      source: score ? CATEGORY_SOURCES[category.key] : "unanswered",
    };
  });

  const gaps: DiscoveryScoreEntry[] = ICP_GAPS.map((gap) => {
    const answer = input.gaps[gap.key];
    return {
      key: gap.key,
      label: `D — ${gap.label}`,
      points: answer?.checked ? 1 : 0,
      max: 1,
      reason: answer
        ? answer.reason
        : "The evidence said nothing about this gap either way, so it scores 0.",
      source: answer ? "assist" : "unanswered",
    };
  });

  const disqualifiers: DiscoveryDisqualifierEntry[] = ICP_DISQUALIFIERS.map(
    (d) => {
      const answer = input.disqualifiers[d.key];
      return {
        key: d.key,
        label: d.label,
        triggered: answer?.triggered === true,
        reason:
          answer?.reason ??
          "Nothing in the evidence points at this one.",
      };
    },
  );

  const total =
    categories.reduce((sum, c) => sum + c.points, 0) +
    gaps.reduce((sum, g) => sum + g.points, 0);
  const anyTriggered = disqualifiers.some((d) => d.triggered);

  return {
    version: DISCOVERY_BREAKDOWN_VERSION,
    disqualifiers,
    categories,
    gaps,
    total,
    tier: anyTriggered ? "DISQUALIFIED" : tierForScore(total),
    summary: input.summary,
    evidence: input.evidence,
    notes: input.notes,
    scoredAt: now.toISOString(),
  };
}

function clamp(points: number, max: number): number {
  if (!Number.isFinite(points)) return 0;
  return Math.min(Math.max(Math.round(points), 0), max);
}

// The disqualifiers that fired, for the rejection sentence and for the lead's
// own icpDqTriggered field.
export function triggeredDisqualifiers(
  breakdown: DiscoveryBreakdown,
): DiscoveryDisqualifierEntry[] {
  return breakdown.disqualifiers.filter((d) => d.triggered);
}

// Why this candidate was rejected, in one sentence, for whichever of the two
// reasons applies. Stored on the record so the rejected list reads without
// having to open the JSON.
export function rejectionReason(breakdown: DiscoveryBreakdown): string {
  const triggered = triggeredDisqualifiers(breakdown);
  if (triggered.length > 0) {
    return `Disqualified: ${triggered.map((d) => d.label).join("; ")}`;
  }
  return `Scored C-tier: ${breakdown.total}/${ICP_MAX_SCORE}`;
}

// ─── Turning a breakdown into a lead's scorecard ───────────────────────────

// The fields a promoted lead's ICP scorecard starts life with. Pre-filled,
// visible and editable exactly like a card somebody filled in by hand — the
// only difference is who filled it in, which is what the notes below say.
//
// icpScoredAt is set, deliberately. A promoted lead that read as "not scored
// yet" would carry no tier badge into the pipeline, which is the one thing
// Discovery exists to put there.
export interface LeadScorecardPrefill {
  icpDqSurgicalPractice: boolean;
  icpDqSoloNoStaff: boolean;
  icpDqFranchiseLocked: boolean;
  icpDqSystemComplete: boolean;
  icpDqOutOfRegion: boolean;
  icpDqTriggered: string | null;
  icpStaffSize: number | null;
  icpPackageEconomics: number | null;
  icpBudgetSignal: number | null;
  icpGapBooking: boolean;
  icpGapReviews: boolean;
  icpGapRemarketing: boolean;
  icpScoredAt: Date;
  icpNotes: string;
}

export function leadScorecardPrefill(
  breakdown: DiscoveryBreakdown,
  scoredAt: Date,
): LeadScorecardPrefill {
  const category = (key: IcpCategoryKey): number | null => {
    const entry = breakdown.categories.find((c) => c.key === key);
    // A category nobody could answer stays null on the lead rather than
    // arriving as a scored zero. On the candidate it counted as 0 toward a
    // total that had to be a number; on the card it is a question still open,
    // and a radio group with nothing selected says that better than a 0 does.
    return entry && entry.source !== "unanswered" ? entry.points : null;
  };
  const gap = (key: IcpGapKey): boolean =>
    breakdown.gaps.find((g) => g.key === key)?.points === 1;
  const dq = (key: IcpDisqualifierKey): boolean =>
    breakdown.disqualifiers.find((d) => d.key === key)?.triggered === true;

  const triggered = triggeredDisqualifiers(breakdown);

  return {
    icpDqSurgicalPractice: dq("icpDqSurgicalPractice"),
    icpDqSoloNoStaff: dq("icpDqSoloNoStaff"),
    icpDqFranchiseLocked: dq("icpDqFranchiseLocked"),
    icpDqSystemComplete: dq("icpDqSystemComplete"),
    icpDqOutOfRegion: dq("icpDqOutOfRegion"),
    icpDqTriggered:
      triggered.length === 0 ? null : triggered.map((d) => d.label).join(", "),
    icpStaffSize: category("icpStaffSize"),
    icpPackageEconomics: category("icpPackageEconomics"),
    icpBudgetSignal: category("icpBudgetSignal"),
    icpGapBooking: gap("icpGapBooking"),
    icpGapReviews: gap("icpGapReviews"),
    icpGapRemarketing: gap("icpGapRemarketing"),
    icpScoredAt: scoredAt,
    icpNotes: scorecardNotes(breakdown),
  };
}

// The reasoning, written into the lead's own scorecard notes. It is the whole
// transcript rather than a summary of it, because the card is where somebody
// will disagree with one of these numbers, and disagreeing with a score whose
// reason lives on another record is not a thing anybody does.
function scorecardNotes(breakdown: DiscoveryBreakdown): string {
  const lines: string[] = [
    `Scored automatically in Discovery — ${breakdown.total}/${ICP_MAX_SCORE}, ${breakdown.tier === "DISQUALIFIED" ? "disqualified" : `${breakdown.tier}-tier`}. Every answer below is editable; correct anything the run got wrong and save.`,
  ];

  const triggered = triggeredDisqualifiers(breakdown);
  if (triggered.length > 0) {
    lines.push("");
    lines.push("Layer 1 — disqualifiers flagged:");
    for (const d of triggered) {
      lines.push(`• ${d.label} — ${d.reason}`);
    }
  }

  lines.push("");
  for (const entry of [...breakdown.categories, ...breakdown.gaps]) {
    lines.push(
      `• ${entry.label}: ${entry.points}/${entry.max} (${DISCOVERY_SOURCE_LABELS[entry.source]}) — ${entry.reason}`,
    );
  }

  if (breakdown.summary !== "") {
    lines.push("");
    lines.push(`Overall fit: ${breakdown.summary}`);
  }
  if (breakdown.evidence.length > 0) {
    lines.push("");
    lines.push(`Read from ${breakdown.evidence.join(", ")}.`);
  }
  for (const note of breakdown.notes) {
    lines.push(`Note: ${note}`);
  }
  return lines.join("\n");
}

// ─── What one candidate's turn in the queue reports back ───────────────────

// The queue runs in the browser, one candidate per server call, so this is the
// shape that crosses back. Declared here rather than beside the action because
// a "use server" module can export nothing but async functions, and the queue
// component needs the type.

export type DiscoveryStepStatus = "ok" | "skipped" | "warned" | "failed";

export interface DiscoveryStep {
  label: string;
  status: DiscoveryStepStatus;
  detail: string;
}

export interface DiscoveryProcessResult {
  id: string;
  clinicName: string;
  status: DiscoveryStatus;
  // The one line the queue shows against this candidate — "Promoted, A-tier
  // 9/10", "Rejected: scored C-tier 3/10", "Failed: …".
  headline: string;
  total: number | null;
  tier: IcpTier | null;
  promotedLeadId: string | null;
  // What each part of the chain did, for the row that expands under it.
  steps: DiscoveryStep[];
}

// The gap keys, in the order the framework lists them, for anything that needs
// to walk them without importing the whole gap definition.
export const DISCOVERY_GAP_KEYS: readonly IcpGapKey[] = ICP_GAP_KEYS;
