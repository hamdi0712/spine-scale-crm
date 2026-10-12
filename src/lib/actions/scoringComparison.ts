"use server";

// Compare scoring's three calls: start a run, score one record, finish.
//
// The run is driven from the browser one record per call, exactly the way
// Process queue is (src/components/DiscoveryQueue.tsx): each call is one
// DeepSeek request, the page shows every result as it lands, and closing the
// tab stops the run after the record in flight.
//
// What none of these do is touch a record. There is no status, score or
// breakdown write in this file — only rows in ScoringComparisonRun and
// ScoringComparison, which nothing but the compare page reads. That is the
// dry run's whole promise: it says what would change, and changes nothing.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadActiveIcp, loadIcpDefinition } from "@/lib/icpDefinitionStore";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { scoreWithIcp } from "@/lib/icpScoringRun";
import { estimateScoringCostUsd } from "@/lib/icpScoringAssist";
import { serializeBreakdownV2 } from "@/lib/icpScoring";
import {
  ComparisonOutcome,
  ComparisonSubject,
  NewStanding,
  comparisonOutcome,
  flipReason,
  newStatusLabel,
} from "@/lib/scoringComparison";
import {
  loadComparisonSubject,
  loadComparisonSubjects,
} from "@/lib/scoringComparisonStore";

export type StartComparisonResult =
  | { ok: true; runId: string; subjects: ComparisonSubject[] }
  | { ok: false; error: string };

export async function startScoringComparison(): Promise<StartComparisonResult> {
  const icp = await loadActiveIcp();
  if (!icp) {
    return { ok: false, error: "No ICP Definition is active. Switch one on under Settings → ICP first." };
  }
  const settings = await loadPipelineSettings();
  const subjects = await loadComparisonSubjects();
  if (subjects.length === 0) {
    return { ok: false, error: "There is nothing to compare yet — no promoted or rejected candidates and no leads." };
  }
  const estimatedUsd = subjects.reduce(
    (sum, s) => sum + estimateScoringCostUsd(s.evidence, icp),
    0,
  );
  const run = await prisma.scoringComparisonRun.create({
    data: {
      icpDefinitionId: icp.id,
      icpName: icp.name,
      threshold: settings.promotionThresholdV2,
      subjects: subjects.length,
      estimatedUsd,
    },
    select: { id: true },
  });
  return {
    ok: true,
    runId: run.id,
    subjects: subjects.map(({ kind, id, clinicName }) => ({ kind, id, clinicName })),
  };
}

export interface ComparisonRowView {
  clinicName: string;
  outcome: ComparisonOutcome | "error";
  oldLabel: string;
  newLabel: string;
  newScore: number | null;
  reason: string | null;
}

export async function compareOneSubject(
  runId: string,
  kind: string,
  id: string,
): Promise<ComparisonRowView> {
  const run = await prisma.scoringComparisonRun.findUnique({ where: { id: runId } });
  const subject =
    kind === "candidate" || kind === "lead" ? await loadComparisonSubject(kind, id) : null;
  if (!run || run.completedAt || !subject) {
    return {
      clinicName: subject?.clinicName ?? "That record",
      outcome: "error",
      oldLabel: "",
      newLabel: "",
      newScore: null,
      reason: !run
        ? "This comparison run no longer exists."
        : run.completedAt
          ? "This run has already finished."
          : "This record is no longer one the comparison covers — deleted or moved since the run started.",
    };
  }

  // Scored against the ICP the run started with, so a definition edited
  // halfway through does not split one report across two standards.
  const icp = (run.icpDefinitionId && (await loadIcpDefinition(run.icpDefinitionId))) || (await loadActiveIcp());
  if (!icp) {
    return {
      clinicName: subject.clinicName,
      outcome: "error",
      oldLabel: subject.old.label,
      newLabel: "",
      newScore: null,
      reason: "The ICP Definition this run scores against no longer exists.",
    };
  }

  const result = await scoreWithIcp({
    evidence: subject.evidence,
    icp,
    threshold: run.threshold,
  });

  // A model error is not a verdict on the clinic. It is recorded as an error,
  // and a run with errors in it does not count as finished.
  if (!result.ok && result.failure === "model") {
    await prisma.scoringComparison.create({
      data: {
        runId,
        subjectKind: subject.kind,
        subjectId: subject.id,
        clinicName: subject.clinicName,
        oldStatus: subject.old.label,
        oldScore: subject.old.score,
        oldMax: subject.old.max,
        oldTier: subject.old.tier,
        newStatus: "ERROR",
        outcome: "error",
        error: result.reason,
      },
    });
    return {
      clinicName: subject.clinicName,
      outcome: "error",
      oldLabel: subject.old.label,
      newLabel: "Not scored",
      newScore: null,
      reason: result.reason,
    };
  }

  const next: NewStanding = result.ok
    ? { ok: true, breakdown: result.breakdown }
    : { ok: false, reason: result.reason };
  const outcome = comparisonOutcome(subject.old, next);
  const reason = flipReason(subject.old, next, outcome);
  const newLabel = newStatusLabel(next);

  await prisma.scoringComparison.create({
    data: {
      runId,
      subjectKind: subject.kind,
      subjectId: subject.id,
      clinicName: subject.clinicName,
      oldStatus: subject.old.label,
      oldScore: subject.old.score,
      oldMax: subject.old.max,
      oldTier: subject.old.tier,
      newStatus: newLabel,
      newScore: next.ok ? next.breakdown.total : null,
      newTier: next.ok ? next.breakdown.tier : null,
      outcome,
      flipReason: reason ?? (next.ok ? next.breakdown.verdict.reason : null),
      breakdown: next.ok ? serializeBreakdownV2(next.breakdown) : null,
    },
  });

  return {
    clinicName: subject.clinicName,
    outcome,
    oldLabel: subject.old.label,
    newLabel,
    newScore: next.ok ? next.breakdown.total : null,
    reason,
  };
}

// Marks the run finished — but only if every record in it was actually
// scored. A run with model errors in it is a partial report, and Apply new
// scoring is gated on a whole one.
export async function finishScoringComparison(
  runId: string,
): Promise<{ complete: boolean; scored: number; errors: number; subjects: number }> {
  const run = await prisma.scoringComparisonRun.findUnique({
    where: { id: runId },
    include: { rows: { select: { outcome: true, subjectId: true } } },
  });
  if (!run) return { complete: false, scored: 0, errors: 0, subjects: 0 };
  const errors = run.rows.filter((r) => r.outcome === "error").length;
  const scored = new Set(run.rows.filter((r) => r.outcome !== "error").map((r) => r.subjectId)).size;
  const complete = errors === 0 && scored >= run.subjects;
  if (complete && !run.completedAt) {
    await prisma.scoringComparisonRun.update({
      where: { id: runId },
      data: { completedAt: new Date() },
    });
  }
  revalidatePath("/discovery/compare");
  return { complete, scored, errors, subjects: run.subjects };
}

