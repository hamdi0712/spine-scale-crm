"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { fmtMoney } from "@/lib/format";
import { recordMilestone } from "@/lib/milestones";
import {
  CONTRACT_STATUSES,
  ContractStatus,
  INVOICE_STATUSES,
  InvoiceStatus,
  ONBOARDING_FIRST_STEP,
  ONBOARDING_NOT_RUNNING,
  clampStep,
} from "@/lib/onboarding";
import { DEFAULT_TIME_ZONE, isUsTimeZone } from "@/lib/timezones";

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

function revalidateClient(id: string) {
  revalidatePath(`/clients/${id}/onboarding`);
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  revalidatePath("/");
}

// Every step's footer submits the step's own form, so Back saves the work in
// hand rather than discarding it. The button that was clicked carries the
// direction.
function stepAfter(formData: FormData, current: number): number {
  return clampStep(formData.get("direction") === "back" ? current - 1 : current + 1);
}

// ─── Running the wizard ────────────────────────────────────────────────────

export async function startOnboarding(clientId: string) {
  await prisma.client.update({
    where: { id: clientId },
    data: { onboardingStep: ONBOARDING_FIRST_STEP },
  });
  revalidateClient(clientId);
  redirect(`/clients/${clientId}/onboarding`);
}

// Steps that own no form of their own (the invoice log saves each entry as it
// is added) navigate through here.
export async function navigateOnboarding(
  clientId: string,
  current: number,
  formData: FormData,
) {
  await prisma.client.update({
    where: { id: clientId },
    data: { onboardingStep: stepAfter(formData, current) },
  });
  revalidateClient(clientId);
}

// Leaves the record exactly as it stands and drops onto the normal client
// page. Available from every step — the full sequence is not always wanted.
export async function skipOnboarding(clientId: string) {
  await prisma.client.update({
    where: { id: clientId },
    data: { onboardingStep: ONBOARDING_NOT_RUNNING },
  });
  revalidateClient(clientId);
  redirect(`/clients/${clientId}`);
}

// Reaching the end of the wizard, as opposed to skipping out of it. Only this
// one counts as onboarding being completed.
export async function finishOnboarding(clientId: string) {
  const client = await prisma.client.update({
    where: { id: clientId },
    data: { onboardingStep: ONBOARDING_NOT_RUNNING },
  });
  await recordMilestone(
    "ONBOARDING_COMPLETED",
    `Onboarding completed for ${client.clinicName}`,
    { clientId },
  );
  revalidateClient(clientId);
  redirect(`/clients/${clientId}`);
}

// ─── Step 1 — confirm details ──────────────────────────────────────────────

export async function saveOnboardingDetails(
  clientId: string,
  formData: FormData,
) {
  const timeZone = str(formData, "timeZone");
  await prisma.client.update({
    where: { id: clientId },
    data: {
      clinicName: str(formData, "clinicName") ?? "Untitled clinic",
      contactName: str(formData, "contactName"),
      phone: str(formData, "phone"),
      email: str(formData, "email"),
      packageName: str(formData, "packageName"),
      monthlyFee: num(formData, "monthlyFee"),
      timeZone: isUsTimeZone(timeZone) ? (timeZone as string) : DEFAULT_TIME_ZONE,
      onboardingStep: stepAfter(formData, 1),
    },
  });
  revalidateClient(clientId);
}

// ─── Step 2 — contract ─────────────────────────────────────────────────────

export async function saveOnboardingContract(
  clientId: string,
  formData: FormData,
) {
  const status = str(formData, "contractStatus");
  const before = await prisma.client.findUnique({
    where: { id: clientId },
    select: { contractStatus: true },
  });
  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      contractStatus: CONTRACT_STATUSES.includes(status as ContractStatus)
        ? (status as ContractStatus)
        : undefined,
      contractRef: str(formData, "contractRef"),
      onboardingStep: stepAfter(formData, 2),
    },
  });
  if (client.contractStatus === "SIGNED" && before?.contractStatus !== "SIGNED") {
    await recordMilestone(
      "CONTRACT_SIGNED",
      `Contract signed — ${client.clinicName}`,
      { clientId },
    );
  }
  revalidateClient(clientId);
}

// ─── Step 3 — invoices ─────────────────────────────────────────────────────

// Logging an invoice that is already marked paid is the same milestone as
// marking one paid later, so both routes go through here.
async function recordInvoicePaid(clientId: string, amount: number) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { clinicName: true },
  });
  await recordMilestone(
    "INVOICE_PAID",
    `Invoice paid — ${fmtMoney(amount)} from ${client?.clinicName ?? "client"}`,
    { clientId },
  );
}

export async function addInvoice(clientId: string, formData: FormData) {
  const amount = num(formData, "amount");
  if (amount == null) return;
  const status = str(formData, "status");
  const invoice = await prisma.invoice.create({
    data: {
      clientId,
      issuedOn: date(formData, "issuedOn") ?? new Date(),
      // Optional — left blank the invoice simply raises no calendar event.
      dueDate: date(formData, "dueDate"),
      amount,
      status: INVOICE_STATUSES.includes(status as InvoiceStatus)
        ? (status as InvoiceStatus)
        : "UNPAID",
      memo: str(formData, "memo"),
    },
  });
  if (invoice.status === "PAID") await recordInvoicePaid(clientId, invoice.amount);
  revalidateClient(clientId);
}

export async function setInvoiceStatus(invoiceId: string, status: string) {
  if (!INVOICE_STATUSES.includes(status as InvoiceStatus)) return;
  const before = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  });
  const invoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status },
  });
  if (invoice.status === "PAID" && before?.status !== "PAID") {
    await recordInvoicePaid(invoice.clientId, invoice.amount);
  }
  revalidateClient(invoice.clientId);
}

export async function deleteInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.delete({ where: { id: invoiceId } });
  revalidateClient(invoice.clientId);
}

// ─── Step 4 — kickoff call ─────────────────────────────────────────────────

// The picker posts an ISO instant alongside the raw datetime-local value: the
// browser is the only side that knows which zone the typed wall-clock time
// belongs to, so the server never parses the raw value itself.
export async function saveOnboardingKickoff(
  clientId: string,
  formData: FormData,
) {
  await prisma.client.update({
    where: { id: clientId },
    data: {
      kickoffAt: date(formData, "kickoffAt"),
      onboardingStep: stepAfter(formData, 4),
    },
  });
  revalidateClient(clientId);
}
