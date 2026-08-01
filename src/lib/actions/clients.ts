"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  CHECKLIST_STATUSES,
  ChecklistStatus,
  CLIENT_STATUSES,
  ClientStatus,
  HIPAA_CHECKLIST_ITEM,
  PHI_APPROACHES,
  PhiApproach,
  seedChecklist,
} from "@/lib/constants";
import { HEALTH_OVERRIDE_AT_RISK } from "@/lib/health";
import { recordMilestone, syncClientHealth } from "@/lib/milestones";
import { CONTRACT_STATUSES, ContractStatus } from "@/lib/onboarding";
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

function date(formData: FormData, key: string): Date | null {
  const v = str(formData, key);
  if (v === null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Path B needs the HIPAA add-on and a signed BAA before anything runs, so the
// checklist item comes with it. Matched on the title rather than tracked by id:
// the item is only ever added, never removed on a switch back to Path A —
// deleting it would silently throw away whatever notes or status it carried,
// and it is one row the user can remove themselves. That also makes flipping
// back and forth idempotent: the second switch to Path B finds it and stops.
async function syncPhiChecklist(
  clientId: string,
  phiApproach: PhiApproach | undefined,
) {
  if (phiApproach !== "PATH_B") return;
  const existing = await prisma.checklistItem.findFirst({
    where: { clientId, title: HIPAA_CHECKLIST_ITEM },
    select: { id: true },
  });
  if (existing) return;
  const max = await prisma.checklistItem.aggregate({
    where: { clientId },
    _max: { sortOrder: true },
  });
  await prisma.checklistItem.create({
    data: {
      clientId,
      title: HIPAA_CHECKLIST_ITEM,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
      // Gates going live, the same as the policy and consent items.
      blocking: true,
    },
  });
}

function clientFields(formData: FormData) {
  const status = str(formData, "status");
  const contractStatus = str(formData, "contractStatus");
  const timeZone = str(formData, "timeZone");
  const phiApproach = str(formData, "phiApproach");
  // The only accepted override is the at-risk flag; anything else clears it
  // and hands the status back to the computation.
  const healthOverride =
    str(formData, "healthOverride") === HEALTH_OVERRIDE_AT_RISK
      ? HEALTH_OVERRIDE_AT_RISK
      : null;
  return {
    healthOverride,
    clinicName: str(formData, "clinicName") ?? "Untitled clinic",
    contactName: str(formData, "contactName"),
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    packageName: str(formData, "packageName"),
    monthlyFee: num(formData, "monthlyFee"),
    contractStart: date(formData, "contractStart"),
    status: CLIENT_STATUSES.includes(status as ClientStatus)
      ? (status as ClientStatus)
      : undefined,
    ghlRef: str(formData, "ghlRef"),
    metaRef: str(formData, "metaRef"),
    notes: str(formData, "notes"),
    // Absent from the "new client" form, so both stay undefined there and
    // fall back to the schema defaults.
    timeZone: isUsTimeZone(timeZone) ? (timeZone as string) : undefined,
    contractStatus: CONTRACT_STATUSES.includes(contractStatus as ContractStatus)
      ? (contractStatus as ContractStatus)
      : undefined,
    contractRef: str(formData, "contractRef"),
    phiApproach: PHI_APPROACHES.includes(phiApproach as PhiApproach)
      ? (phiApproach as PhiApproach)
      : undefined,
  };
}

export async function createClient(formData: FormData) {
  const fields = clientFields(formData);
  const client = await prisma.client.create({
    data: {
      ...fields,
      // A client added straight in as Active starts its reporting clock now.
      activeSince: fields.status === "ACTIVE" ? new Date() : null,
      checklist: { create: seedChecklist() },
    },
  });
  await syncPhiChecklist(client.id, fields.phiApproach);
  revalidatePath("/clients");
  revalidatePath("/");
  redirect(`/clients/${client.id}`);
}

export async function updateClient(id: string, formData: FormData) {
  const before = await prisma.client.findUnique({
    where: { id },
    select: {
      clinicName: true,
      status: true,
      activeSince: true,
      contractStatus: true,
    },
  });
  if (!before) return;
  const fields = clientFields(formData);

  // Going Active for the first time starts the clock health measures from.
  // Coming back to Active after a pause keeps the original date — the
  // engagement is the same one.
  const becomingActive =
    fields.status === "ACTIVE" && before.activeSince === null;

  await prisma.client.update({
    where: { id },
    data: {
      ...fields,
      ...(becomingActive ? { activeSince: new Date() } : {}),
    },
  });

  await syncPhiChecklist(id, fields.phiApproach);

  if (fields.contractStatus === "SIGNED" && before.contractStatus !== "SIGNED") {
    await recordMilestone(
      "CONTRACT_SIGNED",
      `Contract signed — ${fields.clinicName}`,
      { clientId: id },
    );
  }

  // Status, override and activeSince all feed the computation.
  await syncClientHealth(id);

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  revalidatePath("/");
}

// Cascade delete: the schema already declares onDelete: Cascade on every
// child, but the checklist, reports and invoices are removed explicitly in one
// transaction so a client can never leave orphaned rows behind.
export async function deleteClient(id: string) {
  await prisma.$transaction([
    prisma.checklistItem.deleteMany({ where: { clientId: id } }),
    prisma.weeklyReport.deleteMany({ where: { clientId: id } }),
    prisma.invoice.deleteMany({ where: { clientId: id } }),
    prisma.activityLog.deleteMany({ where: { clientId: id } }),
    prisma.client.delete({ where: { id } }),
  ]);
  revalidatePath("/clients");
  revalidatePath("/reporting");
  revalidatePath("/pipeline");
  revalidatePath("/");
  redirect("/clients");
}

// --- Checklist ---

export async function addChecklistItem(clientId: string, formData: FormData) {
  const title = str(formData, "title");
  if (!title) return;
  const max = await prisma.checklistItem.aggregate({
    where: { clientId },
    _max: { sortOrder: true },
  });
  await prisma.checklistItem.create({
    data: { clientId, title, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function renameChecklistItem(id: string, formData: FormData) {
  const title = str(formData, "title");
  if (!title) return;
  const item = await prisma.checklistItem.update({
    where: { id },
    data: { title },
  });
  revalidatePath(`/clients/${item.clientId}`);
}

export async function setChecklistItemStatus(id: string, status: string) {
  if (!CHECKLIST_STATUSES.includes(status as ChecklistStatus)) return;
  const item = await prisma.checklistItem.update({
    where: { id },
    data: {
      status,
      completedAt: status === "DONE" ? new Date() : null,
    },
  });
  revalidatePath(`/clients/${item.clientId}`);
  revalidatePath("/clients");
  // Completing an item can take it off Today's focus.
  revalidatePath("/");
}

// Whether an item gates going live. Drives nothing but the ordering of the
// dashboard's Today's focus list, so it is a plain toggle with no side effects.
export async function toggleChecklistItemBlocking(id: string) {
  const current = await prisma.checklistItem.findUnique({
    where: { id },
    select: { blocking: true },
  });
  if (!current) return;
  const item = await prisma.checklistItem.update({
    where: { id },
    data: { blocking: !current.blocking },
  });
  revalidatePath(`/clients/${item.clientId}`);
  revalidatePath("/");
}

export async function setChecklistItemNotes(id: string, formData: FormData) {
  const notes = str(formData, "notes");
  const item = await prisma.checklistItem.update({
    where: { id },
    data: { notes },
  });
  revalidatePath(`/clients/${item.clientId}`);
}

export async function deleteChecklistItem(id: string) {
  const item = await prisma.checklistItem.delete({ where: { id } });
  revalidatePath(`/clients/${item.clientId}`);
  revalidatePath("/clients");
}
