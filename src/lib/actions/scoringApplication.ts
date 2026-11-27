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
import { syncLeadInbox, syncReadyInboxes } from "@/lib/emailInboxes";
import { autoCheckEmails } from "@/lib/actions/jobs";

// New tiers and flags move inboxes (Ready or not), and promoted candidates
// arrive with addresses nobody has checked.
async function afterScoringChange(): Promise<void> {
  await syncReadyInboxes();
  void autoCheckEmails();
}

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
  await afterScoringChange();
  refresh();
  return result;
}

export async function revertScoringApplication(id: string): Promise<RevertResult> {
  const result = await revertScoring(id);
  await afterScoringChange();
  refresh();
  return result;
}

export async function unflagScoringRejectedLead(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await unflagLead(id);
  if (result.ok) await syncLeadInbox(id);
  refresh();
  revalidatePath(`/pipeline/${id}`);
  return result;
}
