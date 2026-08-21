"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  isDailyChecklistItem,
  parseDayKey,
  toChecklistDay,
} from "@/lib/dailyChecklist";

// Toggle one item on one day.
//
// Both arguments are bound at render time by the form, so the day being ticked
// is the day on screen rather than whatever "today" is by the time the request
// lands — someone who left the page open over midnight ticks the day they were
// looking at, not the one that has just begun.
//
// An upsert rather than an update: a past day is never seeded on read, so the
// row being ticked may not exist yet, and a day whose rows were seeded already
// simply flips.
export async function toggleDailyChecklistItem(dayKey: string, item: string) {
  if (!isDailyChecklistItem(item)) return;
  const date = parseDayKey(dayKey, new Date());
  // parseDayKey falls back to today on junk, and today is a real day to tick,
  // so there is nothing to reject here beyond normalising it.
  const day = toChecklistDay(date);

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
