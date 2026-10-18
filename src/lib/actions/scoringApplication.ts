"use server";

// The Settings → Pipeline buttons for applying new scoring to existing
// records and reverting it. The work is in src/lib/scoringApplication.ts.

import { revalidatePath } from "next/cache";
import {
  ApplicationPlan,
  ApplyResult,
  RevertResult,
  applyScoring,
  planApplication,
  revertScoring,
  unflagLead,
} from "@/lib/scoringApplication";

function refresh() {
  for (const path of ["/", "/pipeline", "/outreach", "/discovery", "/discovery/compare", "/settings/pipeline"]) {
    revalidatePath(path);
  }
}

export async function previewScoringApplication(): Promise<
  { ok: true; plan: ApplicationPlan } | { ok: false; error: string }
> {
  return planApplication();
}

export async function applyScoringToExisting(): Promise<ApplyResult> {
  const result = await applyScoring();
  refresh();
  return result;
}

export async function revertScoringApplication(id: string): Promise<RevertResult> {
  const result = await revertScoring(id);
  refresh();
  return result;
}

export async function unflagScoringRejectedLead(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await unflagLead(id);
  refresh();
  revalidatePath(`/pipeline/${id}`);
  return result;
}
