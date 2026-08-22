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
import {
  PIPELINE_STEP_KEYS,
  PipelineSettings,
  PipelineStepSetting,
  PipelineStepKey,
  readActorId,
  readClinicDiscoveryActorId,
  readPromotionThreshold,
} from "@/lib/pipelineSettings";
import { savePipelineSettings as write } from "@/lib/pipelineSettingsStore";

export async function savePipelineSettings(formData: FormData): Promise<void> {
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
  };

  await write(settings);

  // The queue dialog quotes an estimate built from these, the lead panel plans
  // its run from them, and the discovery list is where both are pressed.
  revalidatePath("/settings/pipeline");
  revalidatePath("/discovery");
  revalidatePath("/pipeline");
}
