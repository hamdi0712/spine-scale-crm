"use server";

// The second-look sweep's one call.
//
// Reads every rejected candidate's stored verdict, works out which were near
// misses, asks DeepSeek whether the rest were disqualified on reasoning that
// actually holds, and writes a flag against the ones worth re-reading.
//
// What it writes is four columns, and they are the only four it may touch:
// secondLookFlagged, secondLookReason, secondLookSource and secondLookAt. It
// does not write status, it does not write promotedLeadId, it does not write a
// score, and it never calls promoteDiscoveryCandidate. A flag is a note asking
// somebody to look again — the looking, and the pressing of "Promote anyway",
// stay where they were. Anybody extending this file should keep that: the
// moment a sweep can promote, the rejected list stops being a record of
// decisions and becomes a thing that changes while you read it.
//
// One model call per run, over at most SECOND_LOOK_MAX_REVIEWED candidates.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deepSeekJson } from "@/lib/deepseek";
import { parseBreakdown } from "@/lib/discovery";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import {
  SecondLookCandidate,
  SecondLookFlag,
  SecondLookResult,
  buildSecondLookPrompt,
  computedFlag,
  parseSecondLookVerdicts,
  selectForReview,
} from "@/lib/secondLook";

export async function checkForSecondLooks(): Promise<SecondLookResult> {
  const settings = await loadPipelineSettings();
  const rows = await prisma.discoveryCandidate.findMany({
    where: { status: "REJECTED" },
    orderBy: [{ icpTotal: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      clinicName: true,
      disqualified: true,
      icpTotal: true,
      disqualifiedReason: true,
      icpBreakdown: true,
    },
  });

  if (rows.length === 0) {
    return {
      ok: true,
      summary: { examined: 0, flagged: 0, computed: 0, assisted: 0, notReached: 0 },
    };
  }

  const candidates: SecondLookCandidate[] = rows.map((row) => ({
    id: row.id,
    clinicName: row.clinicName,
    disqualified: row.disqualified,
    icpTotal: row.icpTotal,
    disqualifiedReason: row.disqualifiedReason,
    breakdown: parseBreakdown(row.icpBreakdown),
  }));

  // ─── 1. The half that needs no model ─────────────────────────────────────
  //
  // Every rejected candidate, every time. It costs nothing, so there is no
  // reason to cap it and no reason for a re-run not to redo it — a promotion
  // threshold that moved since the last sweep changes these answers.
  const flags = new Map<string, SecondLookFlag>();
  for (const candidate of candidates) {
    const flag = computedFlag(candidate, settings.promotionThreshold);
    if (flag) flags.set(candidate.id, flag);
  }

  // ─── 2. The half that does ───────────────────────────────────────────────
  const { review, deferred } = selectForReview(
    candidates,
    settings.promotionThreshold,
  );

  if (review.length > 0) {
    const { system, user, maxTokens } = buildSecondLookPrompt(review);
    const reply = await deepSeekJson({ system, user, maxTokens });
    if (!reply.ok) {
      // Nothing is written on a failed call, including the near misses found
      // above. A half-swept list where some rows carry today's flags and the
      // rest carry last week's is worse than one that plainly did not run.
      return { ok: false, error: reply.error };
    }

    const verdicts = parseSecondLookVerdicts(reply.content);
    if (!verdicts) {
      return {
        ok: false,
        error:
          "DeepSeek answered, but not in a shape that reads as verdicts. Nothing has been flagged — try again.",
      };
    }

    for (const verdict of verdicts) {
      // The index is the model's, so it is checked rather than trusted: an
      // out-of-range one would otherwise flag whichever candidate happened to
      // sit at that position, with somebody else's reasoning attached.
      const candidate = review[verdict.index - 1];
      if (!candidate || !verdict.borderline) continue;
      flags.set(candidate.id, {
        flagged: true,
        source: "assist",
        reason: verdict.reason,
      });
    }
  }

  // ─── 3. Writing them ─────────────────────────────────────────────────────
  //
  // Every candidate examined is written, flagged or not: clearing a flag that
  // no longer applies is as much a result as setting one, and a list where an
  // old flag survived a sweep that disagreed with it would be unreadable.
  //
  // The exception is the ones past the cap. This run never asked about them, so
  // it has no opinion to record and leaves whatever a previous run left —
  // including the stamp saying when that was.
  const now = new Date();
  const deferredIds = new Set(deferred.map((c) => c.id));

  await prisma.$transaction(
    candidates
      .filter((c) => !deferredIds.has(c.id))
      .map((candidate) => {
        const flag = flags.get(candidate.id);
        return prisma.discoveryCandidate.update({
          where: { id: candidate.id },
          data: {
            secondLookFlagged: flag?.flagged ?? false,
            secondLookReason: flag?.reason ?? null,
            secondLookSource: flag?.source ?? null,
            secondLookAt: now,
          },
        });
      }),
  );

  revalidatePath("/discovery/rejected");

  const flagged = Array.from(flags.values());
  return {
    ok: true,
    summary: {
      examined: candidates.length - deferred.length,
      flagged: flagged.length,
      computed: flagged.filter((f) => f.source === "computed").length,
      assisted: flagged.filter((f) => f.source === "assist").length,
      notReached: deferred.length,
    },
  };
}
