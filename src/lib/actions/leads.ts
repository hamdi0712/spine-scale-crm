"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CHECKLIST, LEAD_STAGES, LeadStage } from "@/lib/constants";
import { ONBOARDING_FIRST_STEP } from "@/lib/onboarding";
import {
  ICP_CATEGORIES,
  ICP_DISQUALIFIER_KEYS,
  ICP_GAP_KEYS,
  IcpAnswers,
  triggeredSummary,
} from "@/lib/icp";

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

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

// Reads only the raw scorecard answers — the total and tier are derived on
// read, so nothing here needs to know the bands.
export async function saveIcpScorecard(id: string, formData: FormData) {
  const answers = {
    ...Object.fromEntries(
      ICP_DISQUALIFIER_KEYS.map((k) => [k, bool(formData, k)]),
    ),
    ...Object.fromEntries(ICP_GAP_KEYS.map((k) => [k, bool(formData, k)])),
    ...Object.fromEntries(
      ICP_CATEGORIES.map((c) => {
        const raw = num(formData, c.key);
        const valid =
          raw != null && c.options.some((o) => o.points === raw) ? raw : null;
        return [c.key, valid];
      }),
    ),
  } as IcpAnswers;

  await prisma.lead.update({
    where: { id },
    data: {
      ...answers,
      icpDqTriggered: triggeredSummary(answers),
      icpNotes: str(formData, "icpNotes"),
      icpScoredAt: new Date(),
    },
  });
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${id}`);
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

// Conversion of a Won lead: creates a Client pre-filled from the lead, seeds
// the default delivery checklist, archives the lead, and opens the onboarding
// wizard on step 1. The record is complete enough to stand on its own from
// this moment — the wizard walks through the rest and can be skipped outright.
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
      // The lead's estimated deal value is quoted per month, so it seeds the
      // fee that step 1 asks the user to confirm.
      monthlyFee: lead.estValue,
      leadId: lead.id,
      onboardingStep: ONBOARDING_FIRST_STEP,
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
  redirect(`/clients/${client.id}/onboarding`);
}
