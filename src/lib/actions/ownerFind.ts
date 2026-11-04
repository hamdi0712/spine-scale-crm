"use server";

// The lead page's owner actions: pick between the names the owner finder
// showed, and run Find owners for this one lead. The work is
// src/lib/ownerFindRun.ts; the job is in src/lib/actions/jobs.ts.

import { revalidatePath } from "next/cache";
import { pickOwner } from "@/lib/ownerFindRun";
import { startOwnerJob } from "@/lib/actions/jobs";
import { LaunchResult } from "@/lib/jobRunner";
import { RecleanResult, recleanEmailLeads } from "@/lib/ownerReclean";

export async function pickLeadOwner(leadId: string, name: string): Promise<{ ok: true; job: LaunchResult } | { ok: false; error: string }> {
  if (typeof leadId !== "string" || typeof name !== "string") return { ok: false, error: "Pick one of the names shown." };
  const r = await pickOwner(leadId, name);
  if (!r.ok) return r;
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${leadId}`);
  // Now that the owner is known, their address — within budget, as a run of
  // one. Refused quietly when there is no key or budget; the panel says why.
  const job = await startOwnerJob({ leadIds: [leadId] });
  return { ok: true, job };
}

export async function findLeadOwner(leadId: string): Promise<LaunchResult> {
  if (typeof leadId !== "string") return { ok: false, error: "No lead." };
  return startOwnerJob({ leadIds: [leadId] });
}

// Settings → Email's "Re-clean owner names & labels": free, no API calls.
export async function recleanOwners(): Promise<{ ok: true; result: RecleanResult } | { ok: false; error: string }> {
  try {
    const result = await recleanEmailLeads();
    revalidatePath("/pipeline");
    revalidatePath("/email");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The re-clean failed." };
  }
}
