"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function num(formData: FormData, key: string): number {
  const v = str(formData, key);
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// One entry per client per week — saving the same week again overwrites it.
export async function upsertWeeklyReport(clientId: string, formData: FormData) {
  const weekStr = str(formData, "weekStart");
  if (!weekStr) return;
  const weekStart = new Date(weekStr);
  if (Number.isNaN(weekStart.getTime())) return;

  const data = {
    spend: num(formData, "spend"),
    leads: Math.round(num(formData, "leads")),
    booked: Math.round(num(formData, "booked")),
    shows: Math.round(num(formData, "shows")),
    revenue: num(formData, "revenue"),
    notes: str(formData, "notes"),
  };

  await prisma.weeklyReport.upsert({
    where: { clientId_weekStart: { clientId, weekStart } },
    create: { clientId, weekStart, ...data },
    update: data,
  });
  revalidatePath(`/reporting/${clientId}`);
  revalidatePath("/reporting");
  revalidatePath("/");
}

export async function deleteWeeklyReport(id: string) {
  const report = await prisma.weeklyReport.delete({ where: { id } });
  revalidatePath(`/reporting/${report.clientId}`);
  revalidatePath("/reporting");
  revalidatePath("/");
}
