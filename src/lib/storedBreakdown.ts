// A candidate's stored verdict, whichever model wrote it.
//
// Two frameworks have written to DiscoveryCandidate.icpBreakdown: the old
// 10-point A–D scorecard (src/lib/discovery.ts) and the ICP Definition model
// out of 100 (src/lib/icpScoring.ts). Both are kept as written — a breakdown is
// the transcript of a run, and the new model must not rewrite what the old one
// said. Everything that reads one goes through here, so a view can never hold
// a new-model breakdown up to the old model's shape or quote a total out of the
// wrong maximum.

import { DiscoveryBreakdown, parseBreakdown } from "@/lib/discovery";
import { ICP_MAX_SCORE } from "@/lib/icp";
import { IcpBreakdownV2, isV2BreakdownJson, parseBreakdownV2 } from "@/lib/icpScoring";
import { V2_MAX_SCORE } from "@/lib/icpWeights";

export const SCORING_MODELS = ["v1", "v2"] as const;
export type ScoringModel = (typeof SCORING_MODELS)[number];

export function readScoringModel(raw: unknown): ScoringModel {
  return raw === "v2" ? "v2" : "v1";
}

export const SCORING_MODEL_LABELS: Record<ScoringModel, string> = {
  v1: "Old model — A–D scorecard, out of 10",
  v2: "ICP model — fit and signals, out of 100",
};

// The label every old breakdown carries wherever it is shown.
export const OLD_MODEL_LABEL = "Scored under the old model";

export type StoredBreakdown =
  | { model: "v1"; breakdown: DiscoveryBreakdown }
  | { model: "v2"; breakdown: IcpBreakdownV2 };

export function parseStoredBreakdown(raw: string | null | undefined): StoredBreakdown | null {
  if (isV2BreakdownJson(raw)) {
    const breakdown = parseBreakdownV2(raw);
    return breakdown ? { model: "v2", breakdown } : null;
  }
  const breakdown = parseBreakdown(raw);
  return breakdown ? { model: "v1", breakdown } : null;
}

// What a stored total is out of. A candidate scored before the column existed
// was backfilled "v1", so null only ever means "not scored" and reads as the
// old scale, which is the only one such a row could be on.
export function maxScoreFor(model: string | null | undefined): number {
  return model === "v2" ? V2_MAX_SCORE : ICP_MAX_SCORE;
}
