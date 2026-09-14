// Monk Mode's reads: the challenge, the habits, a window of completions, and
// the day's note.
//
// Server-only and deliberately not a "use server" module, the same way
// dailyChecklistStore and dailyKpiStore are: the pages read through it on
// their way past, and nothing in the browser may call it.
//
// Two things here write on read, and both are first-use seeding rather than
// bookkeeping: the challenge row, and the default habit list. Everything else
// is a query. A day nobody opened writes nothing at all — unlike the daily
// checklist, which seeds a row per item per day, there is no row to seed here:
// absence already means zero progress, and inventing rows would only make the
// history bigger without making it say more.

import { prisma } from "@/lib/prisma";
import {
  DEFAULT_DURATION_DAYS,
  DEFAULT_MONK_HABITS,
  MonkChallenge,
  MonkHabit,
  MonkProgressRow,
  dayKey,
  toChecklistDay,
} from "@/lib/monkMode";

// The active challenge — the most recent one by start date — creating one
// starting today if there is none.
//
// "Most recent" rather than a flag, for the reason the model's comment gives:
// a second challenge is a new row, and the one that has just been started is
// the one being run. Nothing has to be un-flagged for that to be true.
export async function loadChallenge(now: Date): Promise<MonkChallenge> {
  const existing = await prisma.monkModeChallenge.findFirst({
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
  if (existing) {
    return {
      id: existing.id,
      startDate: existing.startDate,
      durationDays: existing.durationDays,
    };
  }

  const startDate = toChecklistDay(now);
  try {
    const created = await prisma.monkModeChallenge.create({
      data: { startDate, durationDays: DEFAULT_DURATION_DAYS },
    });
    return {
      id: created.id,
      startDate: created.startDate,
      durationDays: created.durationDays,
    };
  } catch {
    // Two tabs opened the page on the same first morning. Whichever row landed
    // is the challenge; read it back rather than reporting an error over a
    // race whose outcome is fine either way.
    const raced = await prisma.monkModeChallenge.findFirst({
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
    return {
      id: raced?.id ?? "",
      startDate: raced?.startDate ?? startDate,
      durationDays: raced?.durationDays ?? DEFAULT_DURATION_DAYS,
    };
  }
}

// Every habit, active first and in the order they were arranged, seeding the
// defaults the first time anybody looks.
//
// The seed fires only on a genuinely empty table — not on an empty *active*
// list. Somebody who retires all seven habits has made a decision, and
// re-seeding the defaults underneath them would be the app arguing with it.
export async function loadHabits(): Promise<MonkHabit[]> {
  const rows = await prisma.monkModeHabit.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (rows.length > 0) return rows.map(toHabit);

  try {
    await prisma.monkModeHabit.createMany({
      data: DEFAULT_MONK_HABITS.map((h, i) => ({ ...h, sortOrder: i })),
    });
  } catch {
    // Raced, or the insert failed for a reason the caller cannot act on. The
    // read below is the answer either way: an empty list renders an empty
    // state, not an error page.
  }

  const seeded = await prisma.monkModeHabit.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return seeded.map(toHabit);
}

function toHabit(row: {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  accent: string;
  dailyTarget: number;
  sortOrder: number;
  active: boolean;
}): MonkHabit {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    accent: row.accent,
    dailyTarget: row.dailyTarget,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

export function activeHabits(habits: MonkHabit[]): MonkHabit[] {
  return habits.filter((h) => h.active);
}

// Every completion between two days, inclusive. One query per page rather than
// one per day: twenty-one days of seven habits is a small table, and the
// indexing into days happens in memory (indexProgress) where the rules that
// read it live.
export async function loadProgress(
  from: Date,
  to: Date,
): Promise<MonkProgressRow[]> {
  const rows = await prisma.monkModeCompletion.findMany({
    where: {
      date: { gte: toChecklistDay(from), lte: toChecklistDay(to) },
    },
    select: { habitId: true, date: true, progress: true },
  });
  return rows;
}

// The note for one day, or null. Never written on read: an empty note and an
// unopened day are the same thing, and a row full of empty string is not worth
// the write.
export async function loadNote(day: Date): Promise<string | null> {
  const row = await prisma.monkModeNote.findUnique({
    where: { id: dayKey(toChecklistDay(day)) },
    select: { content: true },
  });
  return row?.content ?? null;
}

export interface MonkNoteRow {
  day: string;
  content: string;
  updatedAt: Date;
}

// The journal, newest first — every day that actually has something written on
// it. The ids are ISO day keys, so ordering by id is ordering by date without
// parsing one.
export async function loadNotes(limit = 60): Promise<MonkNoteRow[]> {
  const rows = await prisma.monkModeNote.findMany({
    orderBy: { id: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    day: r.id,
    content: r.content,
    updatedAt: r.updatedAt,
  }));
}
