"use server";

// The Call list's three buttons. Each is logged in the activity feed; Not
// interested also marks the lead Lost and puts the clinic on the suppression
// list, the same as a not-interested email reply.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { suppressLead } from "@/lib/suppression";
import { CALL_KINDS, CALL_KIND_LABELS, CallKind } from "@/lib/emailBucketsRead";

export async function logCall(leadId: string, kind: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof leadId !== "string" || !(CALL_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Unknown call result." };
  const k = kind as CallKind;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.activityLog.create({ data: { kind: k, summary: `${CALL_KIND_LABELS[k]} — ${lead.clinicName}`, leadId } });
    if (k === "CALL_NOT_INTERESTED") {
      if (lead.stage !== "LOST") await tx.lead.update({ where: { id: leadId }, data: { stage: "LOST", stageChangedAt: now } });
      if (!lead.suppressedAt) await suppressLead(tx, lead, "not_interested", now);
    }
  });
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/outreach");
  revalidatePath("/activities");
  revalidatePath("/activity");
  revalidatePath("/");
  return { ok: true };
}
