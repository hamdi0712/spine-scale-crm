"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  CALL_STATUSES,
  CALL_TYPES,
  CallStatus,
  CallType,
} from "@/lib/calls";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function date(formData: FormData, key: string): Date | null {
  const v = str(formData, key);
  if (v === null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The fields a call carries regardless of which record it hangs off.
function callFields(formData: FormData) {
  const scheduledAt = date(formData, "scheduledAt");
  if (!scheduledAt) return null;
  const type = str(formData, "type");
  const status = str(formData, "status");
  return {
    scheduledAt,
    type: CALL_TYPES.includes(type as CallType) ? (type as CallType) : "OTHER",
    status: CALL_STATUSES.includes(status as CallStatus)
      ? (status as CallStatus)
      : "SCHEDULED",
    notes: str(formData, "notes"),
  };
}

// A call belongs to a lead or a client, never both and never neither. Rather
// than take an owner argument and check it, there is one action per side —
// the invariant then holds by construction.

export async function addLeadCall(leadId: string, formData: FormData) {
  const fields = callFields(formData);
  if (!fields) return;
  await prisma.call.create({ data: { ...fields, leadId } });
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/");
}

export async function addClientCall(clientId: string, formData: FormData) {
  const fields = callFields(formData);
  if (!fields) return;
  await prisma.call.create({ data: { ...fields, clientId } });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");
}

// Whichever side the call hangs off is the page that needs refreshing.
function revalidateCallOwner(call: { leadId: string | null; clientId: string | null }) {
  if (call.leadId) revalidatePath(`/pipeline/${call.leadId}`);
  if (call.clientId) revalidatePath(`/clients/${call.clientId}`);
  revalidatePath("/");
}

export async function setCallStatus(callId: string, status: string) {
  if (!CALL_STATUSES.includes(status as CallStatus)) return;
  const call = await prisma.call.update({
    where: { id: callId },
    data: { status },
  });
  revalidateCallOwner(call);
}

export async function deleteCall(callId: string) {
  const call = await prisma.call.delete({ where: { id: callId } });
  revalidateCallOwner(call);
}
