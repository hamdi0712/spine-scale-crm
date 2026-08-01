"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  CHECKLIST_STATUSES,
  ChecklistStatus,
  CLIENT_STATUSES,
  ClientStatus,
  DEFAULT_CHECKLIST,
} from "@/lib/constants";
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

function clientFields(formData: FormData) {
  const status = str(formData, "status");
  const contractStatus = str(formData, "contractStatus");
  const timeZone = str(formData, "timeZone");
  return {
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
  };
}

export async function createClient(formData: FormData) {
  const client = await prisma.client.create({
    data: {
      ...clientFields(formData),
      checklist: {
        create: DEFAULT_CHECKLIST.map((title, i) => ({ title, sortOrder: i })),
      },
    },
  });
  revalidatePath("/clients");
  revalidatePath("/");
  redirect(`/clients/${client.id}`);
}

export async function updateClient(id: string, formData: FormData) {
  await prisma.client.update({ where: { id }, data: clientFields(formData) });
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
