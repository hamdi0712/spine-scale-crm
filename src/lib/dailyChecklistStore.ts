// Seeding and reading one day of the routine.
//
// Server-only and deliberately not a "use server" module, the same way
// pipelineSettingsStore is: the page calls this on its way through, and the
// toggle action in src/lib/actions/dailyChecklist.ts comes through it too.
//
// Seeding on read is what makes the checklist reset by itself. There is no
// midnight job — the first view of a day writes that day's rows unticked, and
// a day nobody opened simply has none, which reads identically. Yesterday's
// rows are untouched by any of it, so the history is whatever was ticked on
// the day it was ticked.

import { prisma } from "@/lib/prisma";
import {
  DAILY_CHECKLIST_ITEMS,
  DailyChecklistRow,
  toChecklistDay,
} from "@/lib/dailyChecklist";

// Writes any of the day's rows that do not exist yet, then returns all of
// them.
//
// A read, then one insert of whatever was missing. createMany's skipDuplicates
// would say this in a line, but it is not supported on SQLite — so the unique
// index is still what holds the invariant, and the insert failing against it
// is a real outcome rather than an error: it means another view seeded the same
// morning between the read and the write. That case falls back to an upsert per
// missing item, which converges whichever subset of them the other view wrote.
export async function ensureDay(day: Date): Promise<DailyChecklistRow[]> {
  const date = toChecklistDay(day);
  const existing = await prisma.dailyChecklistEntry.findMany({
    where: { date },
    select: { item: true, checked: true },
  });

  const have = new Set(existing.map((r) => r.item));
  const missing = DAILY_CHECKLIST_ITEMS.filter((i) => !have.has(i.key));
  if (missing.length === 0) return existing;

  try {
    await prisma.dailyChecklistEntry.createMany({
      data: missing.map((i) => ({ date, item: i.key })),
    });
  } catch {
    // Raced. Seed what is still genuinely absent, one at a time, and leave
    // anything the other view already wrote exactly as it left it — an upsert
    // that reset `checked` here would untick work somebody just ticked.
    await Promise.all(
      missing.map((i) =>
        prisma.dailyChecklistEntry.upsert({
          where: { date_item: { date, item: i.key } },
          create: { date, item: i.key },
          update: {},
        }),
      ),
    );
  }

  return prisma.dailyChecklistEntry.findMany({
    where: { date },
    select: { item: true, checked: true },
  });
}

// A past day, read without writing to it. Opening the history should not
// backfill rows onto a day that has already been and gone — a day nobody ran
// the routine on has nothing ticked either way, and readDay() fills the blanks
// for display without inventing a record of them.
export async function readDayRows(day: Date): Promise<DailyChecklistRow[]> {
  return prisma.dailyChecklistEntry.findMany({
    where: { date: toChecklistDay(day) },
    select: { item: true, checked: true },
  });
}
