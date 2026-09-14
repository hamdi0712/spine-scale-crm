// Monk Mode — the twenty-one days, the habits in them, and how a day is read.
//
// Pure. No database, no network, no clock beyond the day it is handed, which
// is what lets the dashboard, the calendar and the stats page all read one set
// of rules rather than three that agree until they stop agreeing. The reads
// and writes live in src/lib/monkModeStore.ts and src/lib/actions/monkMode.ts,
// the same split dailyChecklist and dailyChecklistStore already use.
//
// None of this touches the CRM. It is the same person's app and not the same
// subject: nothing here imports a lead, a client or a number off the funnel.
//
// Days are midnight UTC, borrowed wholesale from the daily checklist so that a
// habit ticked on the 14th and a checklist ticked on the 14th are filed under
// the same instant.

import { addDays, dayKey, toChecklistDay } from "@/lib/dailyChecklist";

export { addDays, dayKey, toChecklistDay };

// ─── The challenge ─────────────────────────────────────────────────────────

// Twenty-one days is the default and the name on the banner, but not a
// constant the code leans on: the duration is a column, and everything below
// reads it. Somebody who wants thirty gets thirty.
export const DEFAULT_DURATION_DAYS = 21;

// The bounds a duration is accepted between when it is edited. A week is the
// shortest thing worth calling a challenge; a year is the point at which this
// is no longer a challenge but the rest of your life, and the calendar and the
// donut would both be reading a year of habit-days to draw one number.
export const MIN_DURATION_DAYS = 7;
export const MAX_DURATION_DAYS = 365;

export interface MonkChallenge {
  id: string;
  startDate: Date;
  durationDays: number;
}

// Every day of the challenge, in order, as midnight-UTC days.
export function challengeDays(challenge: MonkChallenge): Date[] {
  const start = toChecklistDay(challenge.startDate);
  return Array.from({ length: challenge.durationDays }, (_, i) =>
    addDays(start, i),
  );
}

// Which day of the challenge a date is — 1 for the start date itself, and null
// for anything outside the run. One-based because it is read by a person: "Day
// 3 of 21" is the banner, and a zeroth day would be a bug somebody has to
// explain.
export function dayNumber(
  challenge: MonkChallenge,
  day: Date,
): number | null {
  const start = toChecklistDay(challenge.startDate);
  const offset = Math.round(
    (toChecklistDay(day).getTime() - start.getTime()) / 86_400_000,
  );
  if (offset < 0 || offset >= challenge.durationDays) return null;
  return offset + 1;
}

// How the banner counts the day, clamped so that it always has something to
// say. Before the start it is day 1 waiting to happen; after the end it is the
// last day, and `finished` is what the copy hangs off rather than a day number
// that has run past its own total.
export interface ChallengeProgress {
  day: number;
  total: number;
  // Days behind the counter, for the bar. Day 3 of 21 is two whole days done.
  elapsed: number;
  started: boolean;
  finished: boolean;
  start: Date;
  end: Date;
}

export function challengeProgress(
  challenge: MonkChallenge,
  today: Date,
): ChallengeProgress {
  const start = toChecklistDay(challenge.startDate);
  const end = addDays(start, challenge.durationDays - 1);
  const raw =
    Math.round((toChecklistDay(today).getTime() - start.getTime()) / 86_400_000) +
    1;
  const day = Math.min(Math.max(raw, 1), challenge.durationDays);
  return {
    day,
    total: challenge.durationDays,
    elapsed: day - 1,
    started: raw >= 1,
    finished: raw > challenge.durationDays,
    start,
    end,
  };
}

// The days of the challenge that have actually been lived, today included.
// Everything that counts a rate — the donut, the streak, the stats — reads
// this rather than the whole run, because a challenge on day 3 is not
// eighteen days of failure.
export function daysSoFar(challenge: MonkChallenge, today: Date): Date[] {
  const t = toChecklistDay(today).getTime();
  return challengeDays(challenge).filter((d) => d.getTime() <= t);
}

// ─── Habits ────────────────────────────────────────────────────────────────

export interface MonkHabit {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  accent: string;
  dailyTarget: number;
  sortOrder: number;
  active: boolean;
}

// A habit cannot ask for more than this in a day. Not a rule about discipline
// — it is the ceiling that stops a typo in the settings form turning one card
// into a row of four hundred check dots.
export const MAX_DAILY_TARGET = 24;

// ─── The icon set ──────────────────────────────────────────────────────────
//
// Keys, not glyph names. A habit row stores "mosque" and never
// "IconBuildingMosque", so the icon package underneath is an implementation
// detail of one component (src/components/MonkIcon.tsx) rather than something
// baked into a year of rows. The labels are what the settings picker reads.
//
// Tabler, the same set the sidebar draws — this feature introduces no new icon
// family.

export interface MonkIconOption {
  key: string;
  label: string;
}

export const MONK_ICONS: MonkIconOption[] = [
  { key: "ban", label: "No / abstain" },
  { key: "mosque", label: "Mosque" },
  { key: "book", label: "Book" },
  { key: "droplet", label: "Droplet" },
  { key: "meditation", label: "Meditation" },
  { key: "laptop", label: "Laptop" },
  { key: "dumbbell", label: "Dumbbell" },
  { key: "run", label: "Running" },
  { key: "walk", label: "Walking" },
  { key: "swim", label: "Swimming" },
  { key: "bed", label: "Sleep" },
  { key: "water", label: "Water" },
  { key: "salad", label: "Food" },
  { key: "brain", label: "Mind" },
  { key: "pencil", label: "Writing" },
  { key: "notebook", label: "Journal" },
  { key: "phone-off", label: "Phone down" },
  { key: "no-coffee", label: "No caffeine" },
  { key: "sun", label: "Sunrise" },
  { key: "moon", label: "Night" },
  { key: "flame", label: "Streak" },
  { key: "heart", label: "Heart" },
  { key: "mountain", label: "Mountain" },
  { key: "clock", label: "Time" },
  { key: "target", label: "Target" },
];

const ICON_KEYS = new Set(MONK_ICONS.map((i) => i.key));

// The key a habit will actually be drawn with. An unrecognised one — a row
// written before an icon was renamed, or a hand-edited database — falls back
// to the target rather than rendering nothing, because a card with a hole in
// it reads as a broken app and a card with the wrong glyph reads as a habit.
export function monkIconKey(value: string | null | undefined): string {
  return value && ICON_KEYS.has(value) ? value : "target";
}

// ─── The palette ───────────────────────────────────────────────────────────
//
// Semantic tokens, never hexes: every accent below resolves through the app's
// own colour variables, so a Monk Mode card follows light and dark exactly as
// a KPI card does. The reference this feature was drawn from is a fixed dark
// palette — it is the mood and the layout that were taken from it, not the
// colours.
//
// Each accent carries the four forms a card needs: the glyph's own colour, the
// soft disc behind it, the border a completed card wears, and the ring a card
// lights up with when it is pressed.

export interface MonkAccent {
  key: string;
  label: string;
  // The glyph and any figure drawn in the habit's own colour.
  text: string;
  // The disc behind the glyph.
  soft: string;
  // The card's border, at rest.
  border: string;
  // The wash a completed card sits on.
  fill: string;
  // A bare `rgb(var(--…))` reference, for the one place a real colour value is
  // needed rather than a class: the SVG gradients in the charts, which take
  // attributes rather than utilities.
  varRef: string;
}

export const MONK_ACCENTS: MonkAccent[] = [
  {
    key: "accent",
    label: "Blue",
    text: "text-accent",
    soft: "bg-accent/10",
    border: "border-accent/30",
    fill: "bg-accent/5",
    varRef: "rgb(var(--c-accent))",
  },
  {
    key: "teal",
    label: "Teal",
    text: "text-teal",
    soft: "bg-teal/10",
    border: "border-teal/30",
    fill: "bg-teal/5",
    varRef: "rgb(var(--c-teal))",
  },
  {
    key: "indigo",
    label: "Indigo",
    text: "text-indigo",
    soft: "bg-indigo/10",
    border: "border-indigo/30",
    fill: "bg-indigo/5",
    varRef: "rgb(var(--c-indigo))",
  },
  {
    key: "purple",
    label: "Purple",
    text: "text-purple",
    soft: "bg-purple/10",
    border: "border-purple/30",
    fill: "bg-purple/5",
    varRef: "rgb(var(--c-purple))",
  },
  {
    key: "pink",
    label: "Pink",
    text: "text-pink",
    soft: "bg-pink/10",
    border: "border-pink/30",
    fill: "bg-pink/5",
    varRef: "rgb(var(--c-pink))",
  },
  {
    key: "ok",
    label: "Green",
    text: "text-ok",
    soft: "bg-ok/10",
    border: "border-ok/30",
    fill: "bg-ok/5",
    varRef: "rgb(var(--c-ok))",
  },
  {
    key: "warn",
    label: "Amber",
    text: "text-warn",
    soft: "bg-warn/10",
    border: "border-warn/30",
    fill: "bg-warn/5",
    varRef: "rgb(var(--c-warn))",
  },
  {
    key: "bad",
    label: "Red",
    text: "text-bad",
    soft: "bg-bad/10",
    border: "border-bad/30",
    fill: "bg-bad/5",
    varRef: "rgb(var(--c-bad))",
  },
];

const ACCENTS_BY_KEY = new Map(MONK_ACCENTS.map((a) => [a.key, a]));

export function monkAccent(value: string | null | undefined): MonkAccent {
  return (value ? ACCENTS_BY_KEY.get(value) : undefined) ?? MONK_ACCENTS[0];
}

// ─── The seed ──────────────────────────────────────────────────────────────
//
// What the list looks like before anybody has edited it. Written once, the
// first time the feature is opened (seedHabits in monkModeStore), and never
// re-asserted afterwards: a habit deleted from the list stays deleted, which
// it would not if this were re-applied on every read.
//
// These are a starting point and not the content of the feature. Every one of
// them is editable, removable and reorderable from /monk-mode/settings.

export interface MonkHabitSeed {
  name: string;
  description: string;
  icon: string;
  accent: string;
  dailyTarget: number;
}

export const DEFAULT_MONK_HABITS: MonkHabitSeed[] = [
  {
    name: "No Porn",
    description: "Keep your mind clean.",
    icon: "ban",
    accent: "bad",
    dailyTarget: 1,
  },
  {
    name: "Salah 5 Times",
    description: "Closer to Allah.",
    icon: "mosque",
    accent: "teal",
    // The reason MonkModeCompletion stores a number.
    dailyTarget: 5,
  },
  {
    name: "Read Quran",
    description: "Guidance. Peace.",
    icon: "book",
    accent: "purple",
    dailyTarget: 1,
  },
  {
    name: "Skincare",
    description: "Discipline looks good on you.",
    icon: "droplet",
    accent: "accent",
    dailyTarget: 1,
  },
  {
    name: "10 Min Meditation",
    description: "Calmer mind. Better decisions.",
    icon: "meditation",
    accent: "indigo",
    dailyTarget: 1,
  },
  {
    name: "Work On Business",
    description: "Build the future you want.",
    icon: "laptop",
    accent: "warn",
    dailyTarget: 1,
  },
  {
    name: "30 Minute Exercise",
    description: "Stronger body. Sharper mind.",
    icon: "dumbbell",
    accent: "ok",
    dailyTarget: 1,
  },
];

// ─── Reading a day ─────────────────────────────────────────────────────────

// What one habit did on one day.
//
// "pending" is the state the whole four-way split exists for: a habit with
// nothing done on it is only a miss once the day it belonged to is over.
// Today's untouched habits are work still available, and counting them against
// the score at nine in the morning would make every morning start at zero out
// of seven and stay there until lunch.
export type MonkStatus = "complete" | "partial" | "missed" | "pending";

export interface MonkProgressRow {
  habitId: string;
  date: Date;
  progress: number;
}

// Completions indexed by day and then habit — the shape every reading below
// wants, built once by the page and passed down.
export type MonkProgressMap = Map<string, Map<string, number>>;

export function indexProgress(rows: MonkProgressRow[]): MonkProgressMap {
  const byDay: MonkProgressMap = new Map();
  for (const row of rows) {
    const key = dayKey(toChecklistDay(row.date));
    let day = byDay.get(key);
    if (!day) {
      day = new Map();
      byDay.set(key, day);
    }
    // Max rather than last-write-wins: the unique index makes duplicates
    // impossible in practice, and if one ever existed the higher number is the
    // one somebody earned.
    day.set(row.habitId, Math.max(day.get(row.habitId) ?? 0, row.progress));
  }
  return byDay;
}

export function progressOn(
  progress: MonkProgressMap,
  day: Date,
  habitId: string,
): number {
  return progress.get(dayKey(toChecklistDay(day)))?.get(habitId) ?? 0;
}

// Partial is partial whether or not the day is over: a day that ended at three
// of five prayers is still three of five, and calling it a miss would throw
// away the difference between a day that slipped and a day nobody showed up
// for. Only the empty case turns on the clock.
export function statusFor(
  done: number,
  target: number,
  over: boolean,
): MonkStatus {
  if (done >= target) return "complete";
  if (done > 0) return "partial";
  return over ? "missed" : "pending";
}

// Whether a day has finished, from the point of view of the person reading the
// page. Today has not: it is still being had.
export function dayIsOver(day: Date, today: Date): boolean {
  return toChecklistDay(day).getTime() < toChecklistDay(today).getTime();
}

export interface MonkHabitDay {
  habit: MonkHabit;
  done: number;
  target: number;
  status: MonkStatus;
}

// One day, habit by habit, in the list's own order.
export function readMonkDay(
  habits: MonkHabit[],
  progress: MonkProgressMap,
  day: Date,
  today: Date,
): MonkHabitDay[] {
  const over = dayIsOver(day, today);
  return habits.map((habit) => {
    const done = Math.min(
      progressOn(progress, day, habit.id),
      habit.dailyTarget,
    );
    return {
      habit,
      done,
      target: habit.dailyTarget,
      status: statusFor(done, habit.dailyTarget, over),
    };
  });
}

// How much of a day was done, 0–1. Weighted by target, so a day that got four
// of five prayers in and nothing else is not read as having done a seventh of
// the work — it did four of the eleven things the day asked for. This is what
// the calendar tints a square by and what the week's bars are drawn to.
export function dayCompletion(rows: MonkHabitDay[]): number {
  const target = rows.reduce((s, r) => s + r.target, 0);
  if (target === 0) return 0;
  const done = rows.reduce((s, r) => s + r.done, 0);
  return done / target;
}

// A day is complete when every active habit hit its own target. Not when the
// weighted fraction rounds to one — those are the same number until a habit
// with a target of zero or a rounding error says otherwise, and the streak
// hangs off this.
export function dayIsComplete(rows: MonkHabitDay[]): boolean {
  return rows.length > 0 && rows.every((r) => r.status === "complete");
}

// ─── The tally behind the donut ────────────────────────────────────────────
//
// Every habit-day of the challenge that has happened so far, sorted into the
// three states the legend names. Pending is counted and kept out of the
// percentage: today's untouched habits are neither a success nor a failure
// yet, and folding them into either would make the number swing every morning
// for reasons that have nothing to do with the person's week.

export interface MonkTally {
  completed: number;
  inProgress: number;
  missed: number;
  // Today's, still open. Not in `decided`.
  pending: number;
  // completed + inProgress + missed — the denominator of the percentage.
  decided: number;
  // 0–100, completed as a share of decided. Zero when nothing is decided yet,
  // which is the first morning of a challenge.
  pct: number;
}

export function monkTally(
  challenge: MonkChallenge,
  habits: MonkHabit[],
  progress: MonkProgressMap,
  today: Date,
): MonkTally {
  const tally = { completed: 0, inProgress: 0, missed: 0, pending: 0 };
  for (const day of daysSoFar(challenge, today)) {
    for (const row of readMonkDay(habits, progress, day, today)) {
      if (row.status === "complete") tally.completed += 1;
      else if (row.status === "partial") tally.inProgress += 1;
      else if (row.status === "missed") tally.missed += 1;
      else tally.pending += 1;
    }
  }
  const decided = tally.completed + tally.inProgress + tally.missed;
  return {
    ...tally,
    decided,
    pct: decided === 0 ? 0 : Math.round((tally.completed / decided) * 100),
  };
}

// Days on which every active habit hit its target — the streak's own test,
// applied to the whole run rather than to a consecutive tail of it. The figure
// a bare streak of zero needs beside it: a run of zero on day twelve with nine
// perfect days behind it is a different week from a run of zero with none.
export function monkPerfectDays(
  habits: MonkHabit[],
  progress: MonkProgressMap,
  days: Date[],
  today: Date,
): number {
  return days.filter((day) =>
    dayIsComplete(readMonkDay(habits, progress, day, today)),
  ).length;
}

// ─── Streaks ───────────────────────────────────────────────────────────────

export interface MonkStreaks {
  current: number;
  best: number;
}

// Consecutive days on which every active habit hit its full target.
//
// Today is counted when it is complete and skipped when it is not — the same
// reasoning the KPI streak uses: a day still being had is not a day that was
// missed, and a streak that resets itself at midnight and rebuilds by evening
// is a number nobody can trust. Yesterday, on the other hand, is over: an
// incomplete one ends the run.
export function monkStreaks(
  challenge: MonkChallenge,
  habits: MonkHabit[],
  progress: MonkProgressMap,
  today: Date,
): MonkStreaks {
  const days = daysSoFar(challenge, today);
  const complete = days.map((day) =>
    dayIsComplete(readMonkDay(habits, progress, day, today)),
  );

  let best = 0;
  let run = 0;
  for (const ok of complete) {
    run = ok ? run + 1 : 0;
    best = Math.max(best, run);
  }

  // Walk back from the end. The last entry is today; drop it if it is not
  // complete yet, then count backwards through finished days.
  let i = complete.length - 1;
  if (i >= 0 && !complete[i]) i -= 1;
  let current = 0;
  for (; i >= 0 && complete[i]; i -= 1) current += 1;

  return { current, best: Math.max(best, current) };
}

// ─── The dot rows and the bars ─────────────────────────────────────────────

export interface MonkDayCell {
  day: Date;
  key: string;
  // "D1" … "D21" for the streak row, the day of the month for the calendar.
  label: string;
  // null for a day outside the challenge, which is drawn muted and counts for
  // nothing.
  dayNumber: number | null;
  completion: number;
  complete: boolean;
  // Whether the day has been lived yet. A future day is not a missed one.
  past: boolean;
  isToday: boolean;
}

function cellFor(
  challenge: MonkChallenge,
  habits: MonkHabit[],
  progress: MonkProgressMap,
  day: Date,
  today: Date,
  label: string,
): MonkDayCell {
  const n = dayNumber(challenge, day);
  const rows = n === null ? [] : readMonkDay(habits, progress, day, today);
  const t = toChecklistDay(today).getTime();
  return {
    day,
    key: dayKey(day),
    label,
    dayNumber: n,
    completion: dayCompletion(rows),
    complete: dayIsComplete(rows),
    past: toChecklistDay(day).getTime() <= t,
    isToday: toChecklistDay(day).getTime() === t,
  };
}

// Every day of the challenge as a cell, in order — what the banner draws its
// row of day ticks from. The whole challenge rather than a window, because the
// banner's tick row is the challenge: twenty-one marks, one per day, and the
// point of it is that you can see the shape of the whole run at once.
export function monkChallengeCells(
  challenge: MonkChallenge,
  habits: MonkHabit[],
  progress: MonkProgressMap,
  today: Date,
): MonkDayCell[] {
  return challengeDays(challenge).map((day, i) =>
    cellFor(challenge, habits, progress, day, today, `D${i + 1}`),
  );
}

// The last N days of the challenge up to and including today, for the dot row
// under the streak. Held to the challenge's own window: on day 3 it shows the
// first seven days of the challenge rather than four days that happened before
// it started, because "D1…D7" is what the dots are labelled and a dot labelled
// D-2 would be a lie.
export function monkStreakRow(
  challenge: MonkChallenge,
  habits: MonkHabit[],
  progress: MonkProgressMap,
  today: Date,
  count = 7,
): MonkDayCell[] {
  const all = challengeDays(challenge);
  const t = toChecklistDay(today).getTime();
  const todayIndex = all.findIndex((d) => d.getTime() === t);
  // Before the challenge starts, and after it ends, the window anchors to the
  // nearest end of it rather than sliding off.
  const anchor =
    todayIndex === -1 ? (t < all[0].getTime() ? 0 : all.length - 1) : todayIndex;
  const start = Math.max(0, Math.min(anchor - count + 1, all.length - count));
  return all
    .slice(Math.max(start, 0), Math.max(start, 0) + count)
    .map((day) =>
      cellFor(
        challenge,
        habits,
        progress,
        day,
        today,
        `D${dayNumber(challenge, day)}`,
      ),
    );
}

export interface MonkWeekBar {
  key: string;
  // "Mon" … "Sun".
  label: string;
  pct: number;
  isToday: boolean;
  // A day that has not happened yet is drawn as an empty slot rather than a
  // zero, because a Sunday at 0% on a Wednesday is not a fact about anybody.
  future: boolean;
  inChallenge: boolean;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The calendar week today falls in, Monday first — the same week the reference
// panel shows, and the same Monday-first convention the calendar grid below
// uses.
export function monkWeekBars(
  challenge: MonkChallenge,
  habits: MonkHabit[],
  progress: MonkProgressMap,
  today: Date,
): MonkWeekBar[] {
  const t = toChecklistDay(today);
  // getUTCDay is 0 for Sunday; this maps it to 6 so Monday is 0.
  const offset = (t.getUTCDay() + 6) % 7;
  const monday = addDays(t, -offset);
  return WEEKDAY_LABELS.map((label, i) => {
    const day = addDays(monday, i);
    const cell = cellFor(challenge, habits, progress, day, today, label);
    return {
      key: cell.key,
      label,
      pct: Math.round(cell.completion * 100),
      isToday: cell.isToday,
      future: !cell.past,
      inChallenge: cell.dayNumber !== null,
    };
  });
}

// ─── The month grid ────────────────────────────────────────────────────────

export interface MonkMonth {
  // Midnight UTC on the first of the month being drawn.
  monthStart: Date;
  label: string;
  // Six rows of seven, Monday first, including the leading and trailing days
  // that belong to the neighbouring months — a ragged grid is harder to read
  // than a full one with its edges dimmed.
  cells: MonkDayCell[];
  // Whether the cell is in the month being drawn. Parallel to `cells` rather
  // than a field on them, because MonkDayCell is shared with the streak row,
  // which has no month.
  inMonth: boolean[];
}

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const MONK_WEEKDAY_LABELS = WEEKDAY_LABELS;

export function monkMonth(
  challenge: MonkChallenge,
  habits: MonkHabit[],
  progress: MonkProgressMap,
  monthStart: Date,
  today: Date,
): MonkMonth {
  const first = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1),
  );
  const lead = (first.getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -lead);
  const cells: MonkDayCell[] = [];
  const inMonth: boolean[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = addDays(gridStart, i);
    cells.push(
      cellFor(
        challenge,
        habits,
        progress,
        day,
        today,
        String(day.getUTCDate()),
      ),
    );
    inMonth.push(day.getUTCMonth() === first.getUTCMonth());
  }
  return {
    monthStart: first,
    label: `${MONTH_LABELS[first.getUTCMonth()]} ${first.getUTCFullYear()}`,
    cells,
    inMonth,
  };
}

// "2026-09" — what the calendar page's ?month= carries. A month rather than a
// day, so paging back and forth does not drag a day of the month around with
// it and land on the 31st of February.
export function monthKey(d: Date): string {
  return dayKey(d).slice(0, 7);
}

export function parseMonthKey(
  value: string | undefined,
  fallback: Date,
): Date {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return new Date(
      Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), 1),
    );
  }
  const d = new Date(`${value}-01T00:00:00.000Z`);
  return Number.isNaN(d.getTime())
    ? new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), 1))
    : d;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

// ─── Dates, as the banner says them ────────────────────────────────────────

// "Sep 15 – Oct 5, 2026". Read in UTC, like every other date in this app, so
// the range under the day counter and the squares on the calendar agree.
export function monkDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const year = end.getUTCFullYear();
  return `${fmt(start)} – ${fmt(end)}, ${year}`;
}
