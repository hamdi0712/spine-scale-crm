// Scoring one record under the new model — the part the queue, Compare scoring
// and the lead card's assist share.
//
// Server-only and deliberately not a "use server" module, on the same terms as
// src/lib/enrichRun.ts: three actions call it, and none of them should be an
// endpoint the browser can reach with a record of its own invention. It reads
// no database and writes none — it takes the evidence a caller already holds
// and hands back a breakdown, or the sentence explaining why there is none.
//
// The order is the brief's: the evidence check first (Failed, not Rejected,
// when there is not enough to judge fit at all), then the model, then the
// scorer, then the one check that can only be made after the model has read a
// thin crawl.

import { deepSeekJson } from "@/lib/deepseek";
import { precheckGaps } from "@/lib/discoveryAssist";
import { assistEvidenceLabels } from "@/lib/icpAssist";
import { IcpDefinitionData } from "@/lib/icpDefinition";
import {
  IcpBreakdownV2,
  ScoringEvidence,
  buildBreakdownV2,
  evidenceGate,
  thinEvidenceFailure,
} from "@/lib/icpScoring";
import {
  SCORING_MAX_TOKENS,
  buildScoringPrompt,
  parseScoringReply,
} from "@/lib/icpScoringAssist";

export type ScoreRunResult =
  | { ok: true; breakdown: IcpBreakdownV2; askedModel: boolean }
  // "evidence" is the Failed state the brief keeps: not enough to judge fit.
  // "model" is the call itself failing — also Failed, and also retried.
  | { ok: false; failure: "evidence" | "model"; reason: string };

export async function scoreWithIcp({
  evidence,
  icp,
  threshold,
  notes = [],
  now = new Date(),
}: {
  evidence: ScoringEvidence;
  icp: IcpDefinitionData;
  threshold: number;
  notes?: string[];
  now?: Date;
}): Promise<ScoreRunResult> {
  const gate = evidenceGate(evidence, icp);
  if (gate.kind === "failed") {
    return { ok: false, failure: "evidence", reason: gate.reason };
  }

  const evidenceLabels = scoringEvidenceLabels(evidence);

  // No website copy, and the Maps listing confirms there is no site. Decided
  // from the data; there is nothing on a website for the model to read.
  if (gate.kind === "no_website") {
    return {
      ok: true,
      askedModel: false,
      breakdown: buildBreakdownV2({
        icp,
        evidence,
        reply: null,
        precheck: null,
        threshold,
        evidenceLabels,
        notes,
        now,
      }),
    };
  }

  const precheck = precheckGaps(evidence.websiteNotes);
  const { system, user } = buildScoringPrompt(evidence, icp, precheck);
  // A dropped connection or a timeout is tried twice more before the record
  // is marked failed.
  const reply = await deepSeekJson({ system, user, maxTokens: SCORING_MAX_TOKENS, networkRetries: 2 });
  if (!reply.ok) return { ok: false, failure: "model", reason: reply.error };

  const parsed = parseScoringReply(reply.content);
  if (!parsed) {
    return {
      ok: false,
      failure: "model",
      reason:
        "DeepSeek answered, but not in a shape that reads as findings. Nothing was scored — run it again.",
    };
  }

  const breakdown = buildBreakdownV2({
    icp,
    evidence,
    reply: parsed,
    precheck,
    threshold,
    evidenceLabels,
    notes,
    now,
  });
  const thin = thinEvidenceFailure(evidence, breakdown);
  if (thin) return { ok: false, failure: "evidence", reason: thin };
  return { ok: true, breakdown, askedModel: true };
}

// What the run had, named for the reader. The enrichment labels the old model
// used, plus the record fields the new one can cite.
export function scoringEvidenceLabels(evidence: ScoringEvidence): string[] {
  const labels = assistEvidenceLabels(evidence);
  if (evidence.staffCountRaw !== null) labels.push("LinkedIn staff count");
  if ((evidence.location ?? "").trim() !== "") labels.push("Location on record");
  if ((evidence.contactTitle ?? "").trim() !== "") labels.push("Contact title");
  return labels;
}
