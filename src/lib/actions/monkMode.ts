"use server";

// Every write Monk Mode makes: the day's progress, the day's note, the habit
// list, and the challenge itself.
//
// One rule runs through all of it and is enforced here rather than in a
// column, because a column cannot know what day it is being written on: the
// past is a record. Progress is logged on the day it happened and a note is
// written on the day it is about. Both refuse a day that has already ended,
// which is the same rule the daily checklist follows for the same reason — a
// history you can go back and tidy up is not a history.
//
// The day being written is bound at render time by the form, so somebody who
// left the page open over midnight is told the day has passed rather than
// silently writing today's progress onto yesterday.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseDayKey } from "@/lib/dailyChecklist";
import {
  MAX_DAILY_TARGET,
  MAX_DURATION_DAYS,
  MIN_DURATION_DAYS,
  dayKey,
  monkAccent,
  monkIconKey,
  toChecklistDay,
} from "@/lib/monkMode";

// Everything under /monk-mode reads the same completions, so a write to any
// one of them invalidates all of them. A single call rather than four: the
// layout segment covers the dashboard and every sub-page beneath it.
function revalidateMonkMode() {
  revalidatePath("/monk-mode", "layout");
}

// Whether a day may still be written to. Today may; anything before it is
// closed. A future day is closed too — logging tomorrow's exercise today is
// not a record of anything.
function dayIsWritable(day: Date, now: Date): boolean {
  return (
    toChecklistDay(day).getTime() === toChecklistDay(now).getTime()
  );
}

// ─── Progress ──────────────────────────────────────────────────────────────

// Advance one habit by one on one day, wrapping back to zero at the target.
//
// One action for both kinds of card. A single-target habit goes 0 → 1 → 0,
// which is a toggle; a five-target one goes 0 → 1 → … → 5 → 0, which is a
// counter that can be walked back round rather than needing a second control
// to undo a mistap. Two behaviours out of one rule, rather than two actions
// that have to agree about what a target means.
export async function bumpMonkHabit(habitId: string, day: string) {
  const now = new Date();
  const date = toChecklistDay(parseDayKey(day, now));
  if (!dayIsWritable(date, now)) return;

  const habit = await prisma.monkModeHabit.findUnique({
    where: { id: habitId },
    select: { dailyTarget: true, active: true },
  });
  // A retired habit is not a thing to log against: it has left the grid, and
  // the only way to reach this would be a stale page open in another tab.
  if (!habit || !habit.active) return;

  const current = await prisma.monkModeCompletion.findUnique({
    where: { habitId_date: { habitId, date } },
    select: { progress: true },
  });
  const target = Math.max(1, habit.dailyTarget);
  const next = ((current?.progress ?? 0) + 1) % (target + 1);

  await prisma.monkModeCompletion.upsert({
    where: { habitId_date: { habitId, date } },
    create: { habitId, date, progress: next },
    update: { progress: next },
  });

  revalidateMonkMode();
}

// Set a habit's progress for a day outright — what the today list's rows and
// the card's individual check dots post. Tapping the third dot of five means
// three, not "increment until you get there".
export async function setMonkHabitProgress(
  habitId: string,
  day: string,
  progress: number,
) {
  const now = new Date();
  const date = toChecklistDay(parseDayKey(day, now));
  if (!dayIsWritable(date, now)) return;

  const habit = await prisma.monkModeHabit.findUnique({
    where: { id: habitId },
    select: { dailyTarget: true, active: true },
  });
  if (!habit || !habit.active) return;

  const next = Math.min(
    Math.max(Math.trunc(Number(progress) || 0), 0),
    Math.max(1, habit.dailyTarget),
  );

  await prisma.monkModeCompletion.upsert({
    where: { habitId_date: { habitId, date } },
    create: { habitId, date, progress: next },
    update: { progress: next },
  });

  revalidateMonkMode();
}

// ─── The note ──────────────────────────────────────────────────────────────

// The day's journal entry. Editable all day and closed once the day has ended
// — the same "past days are historical records" rule as above.
//
// An emptied note deletes its row rather than storing an empty string, so
// "days with something written on them" stays a question the journal can
// answer by listing rows.
export async function saveMonkNote(day: string, formData: FormData) {
  const now = new Date();
  const date = toChecklistDay(parseDayKey(day, now));
  if (!dayIsWritable(date, now)) return;

  const id = dayKey(date);
  const content = String(formData.get("content") ?? "").trim();

  if (content === "") {
    await prisma.monkModeNote.deleteMany({ where: { id } });
  } else {
    await prisma.monkModeNote.upsert({
      where: { id },
      create: { id, content },
      update: { content },
    });
  }

  revalidateMonkMode();
}

// ─── The habit list ────────────────────────────────────────────────────────

// What a form's fields mean, read once so add and edit cannot drift apart on
// what counts as a valid target or a known icon.
function readHabitForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const rawTarget = Math.trunc(Number(formData.get("dailyTarget")) || 1);
  return {
    name,
    description: description === "" ? null : description,
    icon: monkIconKey(String(formData.get("icon") ?? "")),
    accent: monkAccent(String(formData.get("accent") ?? "")).key,
    dailyTarget: Math.min(Math.max(rawTarget, 1), MAX_DAILY_TARGET),
  };
}

export async function addMonkHabit(formData: FormData) {
  const data = readHabitForm(formData);
  // A habit with no name is not a habit. Returning rather than throwing: the
  // field is required in the markup too, and this is the backstop.
  if (data.name === "") return;

  // Appended to the end of the list. The aggregate rather than a count, so a
  // list that has had rows removed does not reuse a sort order and quietly
  // insert the new habit into the middle of it.
  const last = await prisma.monkModeHabit.aggregate({
    _max: { sortOrder: true },
  });

  await prisma.monkModeHabit.create({
    data: { ...data, sortOrder: (last._max.sortOrder ?? -1) + 1 },
  });

  revalidateMonkMode();
}

export async function updateMonkHabit(id: string, formData: FormData) {
  const data = readHabitForm(formData);
  if (data.name === "") return;
  await prisma.monkModeHabit.update({ where: { id }, data });
  revalidateMonkMode();
}

// Retire or restore a habit.
//
// The ordinary way to take something off the list. It leaves the grid and
// stops counting against a day; every completion behind it stays, so last
// week still reads as the week it actually was.
export async function setMonkHabitActive(id: string, active: boolean) {
  await prisma.monkModeHabit.update({ where: { id }, data: { active } });
  revalidateMonkMode();
}

// Delete a habit and every completion behind it.
//
// Offered beside retiring rather than instead of it, and the cascade is the
// honest part: this really does throw the history away, which is right for a
// habit added by mistake and wrong for one that was genuinely run for a week.
// The settings page says so at the button.
export async function deleteMonkHabit(id: string) {
  await prisma.monkModeHabit.delete({ where: { id } });
  revalidateMonkMode();
}

// Move a habit one place up or down the list.
//
// A swap of two sort orders rather than a renumbering of the whole list: only
// the two rows that actually changed places are written, and a list whose
// orders have gaps in them still moves correctly because the neighbour is
// found by position rather than by arithmetic on the order itself.
export async function moveMonkHabit(id: string, direction: "up" | "down") {
  const habits = await prisma.monkModeHabit.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, sortOrder: true },
  });
  const index = habits.findIndex((h) => h.id === id);
  if (index === -1) return;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= habits.length) return;

  // Positions, not stored orders: two rows that share a sort order — seeded
  // rows all at 0, say — would otherwise swap two identical numbers and
  // nothing would move.
  await prisma.$transaction([
    prisma.monkModeHabit.update({
      where: { id: habits[index].id },
      data: { sortOrder: swapWith },
    }),
    prisma.monkModeHabit.update({
      where: { id: habits[swapWith].id },
      data: { sortOrder: index },
    }),
  ]);

  revalidateMonkMode();
}

// ─── The challenge ─────────────────────────────────────────────────────────

// Change when the challenge starts and how long it runs.
//
// The start date moves freely, backwards or forwards. It is the one setting
// where rewriting the past is right: the completions are filed under real
// days, so moving the start only changes which of them the challenge counts —
// somebody who started on the Monday and set this up on the Wednesday should
// be able to say so.
export async function updateMonkChallenge(id: string, formData: FormData) {
  const start = String(formData.get("startDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return;
  const startDate = toChecklistDay(parseDayKey(start, new Date()));

  const raw = Math.trunc(Number(formData.get("durationDays")) || 0);
  const durationDays = Math.min(
    Math.max(raw, MIN_DURATION_DAYS),
    MAX_DURATION_DAYS,
  );

  await prisma.monkModeChallenge.update({
    where: { id },
    data: { startDate, durationDays },
  });

  revalidateMonkMode();
}

// Start a fresh challenge from today, leaving the finished one behind.
//
// A new row rather than an edit of the old one: loadChallenge reads the most
// recent by start date, so this becomes the active challenge the moment it is
// written, and the twenty-one days that came before it stay on the record.
// Habits and completions are untouched — the habits carry over, which is the
// point of running it again.
export async function restartMonkChallenge(formData: FormData) {
  const raw = Math.trunc(Number(formData.get("durationDays")) || 0);
  const durationDays = Math.min(
    Math.max(raw, MIN_DURATION_DAYS),
    MAX_DURATION_DAYS,
  );
  await prisma.monkModeChallenge.create({
    data: { startDate: toChecklistDay(new Date()), durationDays },
  });
  revalidateMonkMode();
}
