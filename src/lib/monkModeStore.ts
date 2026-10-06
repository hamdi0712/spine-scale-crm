// Monk Mode's reads: the challenge, the habits, a window of completions, and
// the day's note.
//
// Server-only and deliberately not a "use server" module, the same way
// dailyChecklistStore and dailyKpiStore are: the pages read through it on
// their way past, and nothing in the browser may call it.
//
// Three things here write on read: the challenge row and the default habit
// list, both first-use seeding, and the one-off repair of challenge history
// written before every challenge kept its own row (reconcileChallengeHistory). Everything else
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
  addDays,
  dayKey,
  toChecklistDay,
} from "@/lib/monkMode";

// The active challenge — the most recent open one by start date — creating
// one starting today if there is none.
//
// "Open" is a null end date: starting a new challenge stamps one on the old
// row (see restartMonkChallenge) rather than overwriting it, so every
// challenge ever run keeps its own row.
export async function loadChallenge(now: Date): Promise<MonkChallenge> {
  await reconcileChallengeHistory();

  const existing = await prisma.monkModeChallenge.findFirst({
    where: { endDate: null },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
  if (existing) return toChallenge(existing);

  const startDate = toChecklistDay(now);
  try {
    const created = await prisma.monkModeChallenge.create({
      data: { startDate, durationDays: DEFAULT_DURATION_DAYS },
    });
    return toChallenge(created);
  } catch {
    // Two tabs opened the page on the same first morning. Whichever row landed
    // is the challenge; read it back rather than reporting an error over a
    // race whose outcome is fine either way.
    const raced = await prisma.monkModeChallenge.findFirst({
      where: { endDate: null },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
    return raced
      ? toChallenge(raced)
      : { id: "", startDate, durationDays: DEFAULT_DURATION_DAYS };
  }
}

// One challenge by id, open or finished — what ?challenge= on the calendar and
// the journal reads. Null for an id that does not exist.
export async function loadChallengeById(
  id: string,
): Promise<MonkChallenge | null> {
  const row = await prisma.monkModeChallenge.findUnique({ where: { id } });
  return row ? toChallenge(row) : null;
}

// Every finished challenge, newest first.
export async function loadPastChallenges(): Promise<MonkChallenge[]> {
  const rows = await prisma.monkModeChallenge.findMany({
    where: { endDate: { not: null } },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toChallenge);
}

function toChallenge(row: {
  id: string;
  startDate: Date;
  durationDays: number;
  endDate: Date | null;
}): MonkChallenge {
  return {
    id: row.id,
    startDate: row.startDate,
    durationDays: row.durationDays,
    endDate: row.endDate,
  };
}

// Bring the challenge rows in line with the one-row-per-challenge rule. Writes
// only when something is out of line, so on an ordinary page load it is two
// small reads.
//
// Two repairs, both for data written before challenges kept a history:
//
// 1. Superseded rows still open. "Go again" used to add a row without closing
//    the old one; the old one ended the day before the next began, or at its
//    own planned end if that came first.
//
// 2. A challenge whose row was overwritten. Moving the start date forward was
//    the old way to begin again, and it left the earlier run's completions and
//    notes in the database with no row covering them. Their dates are the
//    challenge: it ran from the first day anything was logged to the last —
//    or to its planned 21st day, if that came earlier than the next start, so
//    missed days at the end still count as missed.
async function reconcileChallengeHistory(): Promise<void> {
  const rows = await prisma.monkModeChallenge.findMany({
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  });
  if (rows.length === 0) return;

  const open = rows.filter((r) => r.endDate === null);
  for (const row of open.slice(0, -1)) {
    const next = rows.find(
      (r) => r !== row && r.startDate.getTime() > row.startDate.getTime(),
    );
    const planned = addDays(toChecklistDay(row.startDate), row.durationDays - 1);
    const endDate = next
      ? new Date(
          Math.max(
            toChecklistDay(row.startDate).getTime(),
            Math.min(
              planned.getTime(),
              addDays(toChecklistDay(next.startDate), -1).getTime(),
            ),
          ),
        )
      : planned;
    await prisma.monkModeChallenge.update({
      where: { id: row.id },
      data: { endDate },
    });
  }

  const earliest = toChecklistDay(rows[0].startDate);
  const [first, last, firstNote, lastNote] = await Promise.all([
    prisma.monkModeCompletion.findFirst({
      where: { date: { lt: earliest }, progress: { gt: 0 } },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.monkModeCompletion.findFirst({
      where: { date: { lt: earliest }, progress: { gt: 0 } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.monkModeNote.findFirst({
      where: { id: { lt: dayKey(earliest) } },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
    prisma.monkModeNote.findFirst({
      where: { id: { lt: dayKey(earliest) } },
      orderBy: { id: "desc" },
      select: { id: true },
    }),
  ]);
  const dates = [
    first?.date,
    last?.date,
    firstNote ? noteDay(firstNote.id) : undefined,
    lastNote ? noteDay(lastNote.id) : undefined,
  ].filter((d): d is Date => d !== undefined).map(toChecklistDay);
  if (dates.length === 0) return;

  const start = new Date(Math.min(...dates.map((d) => d.getTime())));
  const lastActive = Math.max(...dates.map((d) => d.getTime()));
  const planned = addDays(start, DEFAULT_DURATION_DAYS - 1).getTime();
  const dayBefore = addDays(earliest, -1).getTime();
  const endDate = new Date(Math.max(lastActive, Math.min(planned, dayBefore)));
  const span =
    Math.round((endDate.getTime() - start.getTime()) / 86_400_000) + 1;

  await prisma.monkModeChallenge.create({
    data: { startDate: start, durationDays: span, endDate },
  });
}

function noteDay(id: string): Date | undefined {
  const d = new Date(`${id}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
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
//
// With a range, only the notes between those two days, inclusive — a past
// challenge's journal.
export async function loadNotes(
  limit = 60,
  range?: { from: Date; to: Date },
): Promise<MonkNoteRow[]> {
  const rows = await prisma.monkModeNote.findMany({
    where: range
      ? {
          id: {
            gte: dayKey(toChecklistDay(range.from)),
            lte: dayKey(toChecklistDay(range.to)),
          },
        }
      : undefined,
    orderBy: { id: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    day: r.id,
    content: r.content,
    updatedAt: r.updatedAt,
  }));
}
