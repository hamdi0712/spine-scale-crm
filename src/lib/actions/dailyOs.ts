"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseDayKey, toChecklistDay } from "@/lib/dailyChecklist";
import { OS_ITEM_KEYS } from "@/lib/dailyOs";

// Tick or untick one Daily OS task on one day. The day is bound at render
// time, so a page left open over midnight ticks the day it was showing.
export async function toggleDailyOsItem(dayKey: string, item: string) {
  if (!OS_ITEM_KEYS.has(item)) return;
  const day = toChecklistDay(parseDayKey(dayKey, new Date()));
  if (day.getTime() > toChecklistDay(new Date()).getTime()) return;
  const current = await prisma.dailyChecklistEntry.findUnique({
    where: { date_item: { date: day, item } },
    select: { checked: true },
  });
  const checked = !(current?.checked ?? false);
  await prisma.dailyChecklistEntry.upsert({
    where: { date_item: { date: day, item } },
    create: { date: day, item, checked },
    update: { checked },
  });
  revalidatePath("/activities");
}
