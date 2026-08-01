"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/lib/format";
import { recordMilestone, syncClientHealth } from "@/lib/milestones";

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

  // Only a week that did not exist before is a new report. Correcting last
  // week's numbers is an edit, and edits are not milestones.
  const existing = await prisma.weeklyReport.findUnique({
    where: { clientId_weekStart: { clientId, weekStart } },
    select: { id: true },
  });

  await prisma.weeklyReport.upsert({
    where: { clientId_weekStart: { clientId, weekStart } },
    create: { clientId, weekStart, ...data },
    update: data,
  });

  if (!existing) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { clinicName: true },
    });
    await recordMilestone(
      "REPORT_GENERATED",
      `Weekly report generated for ${client?.clinicName ?? "client"} — week of ${fmtDate(weekStart)}`,
      { clientId },
    );
  }

  // New numbers can move the health status either way.
  await syncClientHealth(clientId);

  revalidatePath(`/reporting/${clientId}`);
  revalidatePath("/reporting");
  revalidatePath("/clients");
  revalidatePath("/");
}

export async function deleteWeeklyReport(id: string) {
  const report = await prisma.weeklyReport.delete({ where: { id } });
  await syncClientHealth(report.clientId);
  revalidatePath(`/reporting/${report.clientId}`);
  revalidatePath("/reporting");
  revalidatePath("/clients");
  revalidatePath("/");
}
