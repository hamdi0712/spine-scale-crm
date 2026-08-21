"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LEAD_STAGES, LeadStage, seedChecklist } from "@/lib/constants";
import { recordMilestone } from "@/lib/milestones";
import { ONBOARDING_FIRST_STEP } from "@/lib/onboarding";
import {
  ICP_CATEGORIES,
  ICP_DISQUALIFIER_KEYS,
  ICP_GAP_KEYS,
  IcpAnswers,
  triggeredSummary,
} from "@/lib/icp";
import { isUsTimeZone } from "@/lib/timezones";

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

function int(formData: FormData, key: string): number | null {
  const n = num(formData, key);
  return n === null ? null : Math.round(n);
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
    linkedinUrl: str(formData, "linkedinUrl"),
    companyLinkedinUrl: str(formData, "companyLinkedinUrl"),
    // Also the enrichment run's inputs — an empty one here is what makes that
    // run skip an actor rather than run it against nothing.
    websiteUrl: str(formData, "websiteUrl"),
    facebookUrl: str(formData, "facebookUrl"),
    // Not an enrichment input like the four above — it is the audit somebody
    // recorded by hand, and the one thing step 4 of the outreach sequence
    // cannot be written without.
    loomUrl: str(formData, "loomUrl"),
    // What the prospect actually wrote back. The audit offer is generated from
    // it, so an empty one is a real state: that step then acknowledges the
    // reply without attributing anything to them.
    replyText: str(formData, "replyText"),
    location: str(formData, "location"),
    // Blank is a real answer here — a lead whose zone nobody knows — so
    // anything outside the four zones stores as null rather than defaulting.
    timeZone: isUsTimeZone(str(formData, "timeZone"))
      ? str(formData, "timeZone")
      : null,
    staffCountRaw: int(formData, "staffCountRaw"),
    estValue: num(formData, "estValue"),
    nextFollowUp: date(formData, "nextFollowUp"),
  };
}

export async function createLead(formData: FormData) {
  const lead = await prisma.lead.create({ data: leadFields(formData) });
  revalidatePath("/pipeline");
  redirect(`/pipeline/${lead.id}`);
}

// Bulk import lives in src/lib/actions/discovery.ts now. Nothing creates a
// Lead in bulk any more: an import lands in Discovery, and a lead is what a
// candidate becomes once it has scored 5 or more out of 10.

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

// ─── Bulk actions from the pipeline table ──────────────────────────────────
//
// Both take the ids the table had selected. Ids arriving from the browser are
// only ever matched against existing rows — an id for a lead that isn't there
// updates and deletes nothing — and both are no-ops on an empty list rather
// than a statement with no WHERE clause, which is the shape of this mistake
// that costs a pipeline.

// Anything past this is a misclick that got through the confirmation rather
// than a day's work, and a delete is the one action here with nothing behind
// it. Not exported: a "use server" module can export nothing but async
// functions, and nothing outside needs the number.
const MAX_BULK_LEADS = 200;

export async function deleteLeads(ids: string[]) {
  const list = leadIds(ids);
  if (list.length === 0) return;
  await prisma.lead.deleteMany({ where: { id: { in: list } } });
  revalidatePath("/pipeline");
  revalidatePath("/");
}

export async function moveLeadsStage(ids: string[], stage: string) {
  if (!LEAD_STAGES.includes(stage as LeadStage)) return;
  const list = leadIds(ids);
  if (list.length === 0) return;
  await prisma.lead.updateMany({
    where: { id: { in: list } },
    data: { stage },
  });
  revalidatePath("/pipeline");
  revalidatePath("/");
}

function leadIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter(
    (id): id is string => typeof id === "string" && id.trim() !== "",
  );
  return Array.from(new Set(ids)).slice(0, MAX_BULK_LEADS);
}

export async function moveLeadStage(id: string, stage: string) {
  if (!LEAD_STAGES.includes(stage as LeadStage)) return;
  await prisma.lead.update({ where: { id }, data: { stage } });
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${id}`);
  revalidatePath("/");
}

// Marks that a LinkedIn connection request went out, and takes it back.
//
// The app sends nothing — this is a note that a person did something on
// LinkedIn, kept here so the pipeline can show who has already been
// approached. Stamped with the moment it was marked rather than a date the
// user picks, because the useful question is "has this one been done", and a
// date field would invite an accuracy the record doesn't have.
export async function markConnectionRequestSent(id: string) {
  await prisma.lead.update({
    where: { id },
    data: { connectionRequestSentAt: new Date() },
  });
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${id}`);
}

// The way back from a misclick. Clears the mark rather than recording that it
// was cleared: an unsent request is not an event.
export async function clearConnectionRequestSent(id: string) {
  await prisma.lead.update({
    where: { id },
    data: { connectionRequestSentAt: null },
  });
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${id}`);
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
      checklist: { create: seedChecklist() },
    },
  });
  await prisma.lead.update({
    where: { id },
    data: { stage: "WON", archived: true },
  });
  await recordMilestone(
    "LEAD_CONVERTED",
    `${lead.clinicName} converted from lead to client`,
    { clientId: client.id },
  );
  revalidatePath("/pipeline");
  revalidatePath("/clients");
  revalidatePath("/");
  redirect(`/clients/${client.id}/onboarding`);
}
