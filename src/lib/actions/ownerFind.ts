"use server";

// The lead page's owner actions: pick between the names the owner finder
// showed, and run Find owners for this one lead. The work is
// src/lib/ownerFindRun.ts; the job is in src/lib/actions/jobs.ts.

import { revalidatePath } from "next/cache";
import { syncReadyInboxes } from "@/lib/emailInboxes";
import { pickOwner } from "@/lib/ownerFindRun";
import { retryContactFinder, startOwnerJob } from "@/lib/actions/jobs";
import { LaunchResult } from "@/lib/jobRunner";
import { RecleanResult, recleanEmailLeads } from "@/lib/ownerReclean";
import { applyProposal, keepCurrent } from "@/lib/contactFinderRun";

export async function pickLeadOwner(leadId: string, name: string): Promise<{ ok: true; job: LaunchResult } | { ok: false; error: string }> {
  if (typeof leadId !== "string" || typeof name !== "string") return { ok: false, error: "Pick one of the names shown." };
  const r = await pickOwner(leadId, name);
  if (!r.ok) return r;
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${leadId}`);
  // Now that the owner is known (set by hand, so kept), the contact finder
  // runs for this lead: their own address, the checks, and where it goes.
  const job = await retryContactFinder(leadId);
  return { ok: true, job };
}

export async function findLeadOwner(leadId: string): Promise<LaunchResult> {
  if (typeof leadId !== "string") return { ok: false, error: "No lead." };
  // Always a fresh run on this lead, even if it was looked up before.
  return startOwnerJob({ leadIds: [leadId], force: true });
}

// Settings → Email's "Re-clean owner names & labels": free, no API calls.
export async function recleanOwners(): Promise<{ ok: true; result: RecleanResult } | { ok: false; error: string }> {
  try {
    const result = await recleanEmailLeads();
    // Cleaned contacts can make leads Ready or take them out.
    await syncReadyInboxes();
    revalidatePath("/pipeline");
    revalidatePath("/email");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The re-clean failed." };
  }
}

// "Look up again" found something different: Replace puts it on the lead (as
// the operator's own choice); Keep leaves the lead as it was. Both logged in
// the lead's contact trace.
export async function replaceWithLookup(leadId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof leadId !== "string") return { ok: false, error: "No lead." };
  const r = await applyProposal(leadId);
  revalidatePath("/pipeline");
  revalidatePath("/outreach");
  revalidatePath(`/pipeline/${leadId}`);
  return r;
}

export async function keepAfterLookup(leadId: string): Promise<{ ok: true }> {
  if (typeof leadId === "string") await keepCurrent(leadId);
  revalidatePath(`/pipeline/${leadId}`);
  return { ok: true };
}
