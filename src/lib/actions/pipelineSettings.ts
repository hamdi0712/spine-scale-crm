"use server";

// Saving the pipeline settings — the one write behind the settings form.
//
// Everything crossing this boundary is untrusted, and all of it is read
// through the same functions the server uses to read the stored row
// (src/lib/pipelineSettings.ts): an actor ID is normalised or falls back to
// the built-in default, and the threshold is clamped to the scale the score is
// measured on. There is no path from this form to a chain that cannot run.
//
// It writes settings and nothing else. No candidate, no lead, no score is
// reachable from here — changing the bar does not re-score anything that has
// already been through the queue, which is the point of a stored breakdown.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  PIPELINE_STEP_KEYS,
  PipelineSettings,
  PipelineStepSetting,
  PipelineStepKey,
  readActorId,
  readClinicDiscoveryActorId,
  readDecisionMakerActorId,
  readPromotionThreshold,
  readPromotionThresholdV2,
} from "@/lib/pipelineSettings";
import { readRecrawlConcurrency, readWebsiteCrawlPages } from "@/lib/websiteCrawl";
import {
  loadPipelineSettings,
  savePipelineSettings as write,
} from "@/lib/pipelineSettingsStore";

export async function savePipelineSettings(formData: FormData): Promise<void> {
  // The scoring switch is not on this form. It is thrown from Compare scoring,
  // after a dry run has been read, so saving the chain here keeps whichever
  // model is in force rather than resetting it.
  const current = await loadPipelineSettings();
  const steps = Object.fromEntries(
    PIPELINE_STEP_KEYS.map((key) => [
      key,
      {
        // An unchecked checkbox posts nothing at all, which is what makes the
        // absence of the field the "off" here rather than an omission.
        enabled: formData.get(`${key}Enabled`) === "on",
        actorId: readActorId(formData.get(`${key}ActorId`), key),
      } satisfies PipelineStepSetting,
    ]),
  ) as Record<PipelineStepKey, PipelineStepSetting>;

  const settings: PipelineSettings = {
    steps,
    promotionThreshold: readPromotionThreshold(formData.get("promotionThreshold")),
    clinicDiscovery: {
      enabled: formData.get("clinicDiscoveryEnabled") === "on",
      actorId: readClinicDiscoveryActorId(formData.get("clinicDiscoveryActorId")),
    },
    decisionMaker: {
      enabled: formData.get("decisionMakerEnabled") === "on",
      actorId: readDecisionMakerActorId(formData.get("decisionMakerActorId")),
    },
    scoringModel: current.scoringModel,
    promotionThresholdV2: formData.has("promotionThresholdV2")
      ? readPromotionThresholdV2(formData.get("promotionThresholdV2"))
      : current.promotionThresholdV2,
    websiteCrawlPages: formData.has("websiteCrawlPages")
      ? readWebsiteCrawlPages(formData.get("websiteCrawlPages"))
      : current.websiteCrawlPages,
    recrawlConcurrency: formData.has("recrawlConcurrency")
      ? readRecrawlConcurrency(formData.get("recrawlConcurrency"))
      : current.recrawlConcurrency,
  };

  await write(settings);

  // The queue dialog quotes an estimate built from these, the lead panel plans
  // its run from them, and the discovery list is where both are pressed.
  revalidatePath("/settings/pipeline");
  revalidatePath("/discovery");
  revalidatePath("/discovery/compare");
  revalidatePath("/pipeline");
}

// "Apply new scoring" — and the way back. The only write of scoringModel in
// the app. Applying is refused until a comparison run has finished, which is
// the whole of the gate: the switch exists to be thrown after reading what it
// would change, not before.
export async function setScoringModel(model: "v1" | "v2"): Promise<{ ok: boolean; error?: string }> {
  if (model === "v2") {
    const finished = await prisma.scoringComparisonRun.findFirst({
      where: { completedAt: { not: null } },
      select: { id: true },
    });
    if (!finished) {
      return {
        ok: false,
        error: "Run Compare scoring to the end and review it first — the new model is applied only after a dry run.",
      };
    }
    const icp = await prisma.icpDefinition.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (!icp) {
      return {
        ok: false,
        error: "No ICP Definition is active. Switch one on under Settings → ICP first.",
      };
    }
  }
  const current = await loadPipelineSettings();
  await write({ ...current, scoringModel: model });
  revalidatePath("/settings/pipeline");
  revalidatePath("/discovery");
  revalidatePath("/discovery/compare");
  return { ok: true };
}
