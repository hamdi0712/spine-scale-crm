"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CHECKLIST, LEAD_STAGES, LeadStage } from "@/lib/constants";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function num(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function date(formData: FormData, key: string): Date | null {
  const v = str(formData, key);
  if (v === null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function leadFields(formData: FormData) {
  return {
    clinicName: str(formData, "clinicName") ?? "Untitled clinic",
    contactName: str(formData, "contactName"),
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    leadSource: str(formData, "leadSource"),
    estValue: num(formData, "estValue"),
    nextFollowUp: date(formData, "nextFollowUp"),
  };
}

export async function createLead(formData: FormData) {
  const lead = await prisma.lead.create({ data: leadFields(formData) });
  revalidatePath("/pipeline");
  redirect(`/pipeline/${lead.id}`);
}

export async function updateLead(id: string, formData: FormData) {
  const stage = str(formData, "stage");
  await prisma.lead.update({
    where: { id },
    data: {
      ...leadFields(formData),
      ...(stage && LEAD_STAGES.includes(stage as LeadStage) ? { stage } : {}),
    },
  });
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${id}`);
}

export async function moveLeadStage(id: string, stage: string) {
  if (!LEAD_STAGES.includes(stage as LeadStage)) return;
  await prisma.lead.update({ where: { id }, data: { stage } });
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${id}`);
  revalidatePath("/");
}

export async function addLeadNote(id: string, formData: FormData) {
  const body = str(formData, "body");
  if (!body) return;
  await prisma.leadNote.create({ data: { leadId: id, body } });
  revalidatePath(`/pipeline/${id}`);
}

export async function deleteLead(id: string) {
  await prisma.lead.delete({ where: { id } });
  revalidatePath("/pipeline");
  redirect("/pipeline");
}

// One-click conversion of a Won lead: creates a Client pre-filled from the
// lead, seeds the default delivery checklist, and archives the lead.
export async function convertLeadToClient(id: string) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!lead) return;
  if (lead.client) redirect(`/clients/${lead.client.id}`);

  const client = await prisma.client.create({
    data: {
      clinicName: lead.clinicName,
      contactName: lead.contactName,
      phone: lead.phone,
      email: lead.email,
      leadId: lead.id,
      checklist: {
        create: DEFAULT_CHECKLIST.map((title, i) => ({
          title,
          sortOrder: i,
        })),
      },
    },
  });
  await prisma.lead.update({
    where: { id },
    data: { stage: "WON", archived: true },
  });
  revalidatePath("/pipeline");
  revalidatePath("/clients");
  revalidatePath("/");
  redirect(`/clients/${client.id}`);
}
