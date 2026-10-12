// Compare scoring — the dry run before the new model is applied.
//
// It rescores what has already been decided — every Promoted and Rejected
// candidate, and every open lead that never came through Discovery — under the
// ICP model, from the enrichment already stored on each record. No actor runs,
// and no status, score or breakdown on any record changes: the results go to
// their own table (ScoringComparison) and are read on the compare page, where
// they are grouped by what would change.
//
// This module is the pure half: who is compared, what each comparison is
// called, and the one sentence that explains a flip. The calls are in
// src/lib/actions/scoringComparison.ts.

import { IcpTier } from "@/lib/icp";
import { IcpBreakdownV2, ScoringEvidence } from "@/lib/icpScoring";
import { V2_MAX_SCORE } from "@/lib/icpWeights";

export const COMPARISON_OUTCOMES = [
  "newly_rejected",
  "newly_promoted",
  "newly_held",
  "newly_failed",
  "unchanged",
] as const;
export type ComparisonOutcome = (typeof COMPARISON_OUTCOMES)[number];

export const COMPARISON_OUTCOME_LABELS: Record<ComparisonOutcome, string> = {
  newly_rejected: "Newly rejected",
  newly_promoted: "Newly promoted",
  newly_held: "Newly held as Tier 2 chiro",
  newly_failed: "Not enough evidence to judge",
  unchanged: "Unchanged",
};

export const COMPARISON_OUTCOME_MEANINGS: Record<ComparisonOutcome, string> = {
  newly_rejected:
    "Promoted (or in the pipeline) today, and the new model would reject it — disqualified, not a confirmed fit, or under the bar.",
  newly_promoted: "Rejected today, and the new model would promote it.",
  newly_held:
    "The new model would hold it for review: a qualifying clinic whose primary service is chiropractic.",
  newly_failed:
    "The stored evidence is not enough for the new model to judge fit at all. It would be Failed and retried, not rejected.",
  unchanged: "Same outcome under both models.",
};

export type SubjectKind = "candidate" | "lead";

export interface ComparisonSubject {
  kind: SubjectKind;
  id: string;
  clinicName: string;
}

// What the record stands at today, as the comparison reports it. A lead that
// is in the pipeline counts as promoted — the question asked of it is whether
// it would have got there under the new model.
export interface OldStanding {
  status: "PROMOTED" | "REJECTED";
  label: string;
  score: number | null;
  max: number | null;
  tier: IcpTier | null;
  reason: string | null;
}

export type NewStanding =
  | { ok: true; breakdown: IcpBreakdownV2 }
  | { ok: false; reason: string };

export function comparisonOutcome(
  old: OldStanding,
  next: NewStanding,
): ComparisonOutcome {
  if (!next.ok) return "newly_failed";
  const status = next.breakdown.verdict.status;
  if (status === "HELD_CHIRO") return "newly_held";
  if (status === "REJECTED" && old.status === "PROMOTED") return "newly_rejected";
  if (status === "PROMOTED" && old.status === "REJECTED") return "newly_promoted";
  return "unchanged";
}

// The reason for a flip, in one sentence that names both sides. Null where
// nothing flipped — the row's own scores say enough.
export function flipReason(
  old: OldStanding,
  next: NewStanding,
  outcome: ComparisonOutcome,
): string | null {
  if (outcome === "unchanged") return null;
  if (!next.ok) return next.reason;
  const now = next.breakdown.verdict.reason;
  if (outcome === "newly_promoted" && old.reason) {
    return `${now} Under the old model: ${old.reason}`;
  }
  return now;
}

export function newStatusLabel(next: NewStanding): string {
  if (!next.ok) return "Failed";
  switch (next.breakdown.verdict.status) {
    case "PROMOTED":
      return "Promoted";
    case "HELD_CHIRO":
      return "Held — Tier 2 chiro";
    default:
      return next.breakdown.verdict.kind === "not_a_fit"
        ? "Rejected — not a confirmed fit"
        : next.breakdown.verdict.kind === "disqualified"
          ? "Rejected — disqualified"
          : "Rejected — below the bar";
  }
}

export const NEW_MAX = V2_MAX_SCORE;

// The evidence a stored record carries, shaped for the scorer. Both kinds of
// record store the same enrichment fields under the same names.
export function storedEvidence(record: {
  clinicName: string;
  websiteUrl: string | null;
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
  staffCountRaw: number | null;
  location: string | null;
  contactName: string | null;
  contactTitle: string | null;
}): ScoringEvidence {
  return {
    clinicName: record.clinicName,
    websiteUrl: record.websiteUrl,
    websiteNotes: record.websiteNotes,
    metaAdsSignal: record.metaAdsSignal,
    reviewCount: record.reviewCount,
    staffCountRaw: record.staffCountRaw,
    location: record.location,
    contactName: record.contactName,
    contactTitle: record.contactTitle,
  };
}
