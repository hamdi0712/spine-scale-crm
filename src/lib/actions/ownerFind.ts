"use server";

// The lead page's owner actions: Replace or Keep what "Re-run contact
// finder" found (src/lib/contactFinderRun.ts), and Settings → Email's
// re-clean of owner names. Picking an owner by hand is the lead's Contact
// field (updateLead marks it contactNameByHand; the finder never overwrites it).

import { revalidatePath } from "next/cache";
import { syncReadyInboxes } from "@/lib/emailInboxes";
import { RecleanResult, recleanEmailLeads } from "@/lib/ownerReclean";
import { applyProposal, keepCurrent } from "@/lib/contactFinderRun";

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
