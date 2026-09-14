// Progress: the challenge read habit by habit rather than day by day.
//
// The dashboard's donut says how the whole thing is going; this says which
// habit is carrying it and which one is quietly sinking it, which is the
// question a fortnight in. One row per habit, with its completion rate across
// the days lived so far and the same day-by-day dot row the streak panel uses.

import {
  activeHabits,
  loadChallenge,
  loadHabits,
  loadProgress,
} from "@/lib/monkModeStore";
import {
  MonkHabit,
  MonkProgressMap,
  challengeDays,
  challengeProgress,
  dayIsOver,
  daysSoFar,
  indexProgress,
  monkAccent,
  monkDateRange,
  monkStreaks,
  monkTally,
  progressOn,
  statusFor,
} from "@/lib/monkMode";
import MonkDonut from "@/components/MonkDonut";
import MonkIcon from "@/components/MonkIcon";

export const dynamic = "force-dynamic";

export default async function MonkProgressPage() {
  const now = new Date();
  const [challenge, habits] = await Promise.all([
    loadChallenge(now),
    loadHabits(),
  ]);
  const active = activeHabits(habits);
  const days = challengeDays(challenge);

  const rows = await loadProgress(days[0], days[days.length - 1]);
  const progress = indexProgress(rows);

  const shape = challengeProgress(challenge, now);
  const tally = monkTally(challenge, active, progress, now);
  const streaks = monkStreaks(challenge, active, progress, now);
  const lived = daysSoFar(challenge, now);

  const perHabit = active.map((habit) =>
    readHabitRun(habit, progress, lived, now),
  );

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="display text-[32px] font-semibold">Progress</h1>
        <p className="num mt-1.5 text-sm text-muted">
          {monkDateRange(shape.start, shape.end)} · day {shape.day} of{" "}
          {shape.total}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="card p-5">
          <h2 className="display mb-4 text-xl font-semibold">Overall</h2>
          <MonkDonut tally={tally} />
        </section>
        <section className="card p-5">
          <h2 className="display mb-4 text-xl font-semibold">The run</h2>
          <dl className="space-y-3">
            <Stat label="Current streak" value={`${streaks.current} days`} />
            <Stat label="Best streak" value={`${streaks.best} days`} />
            <Stat label="Days lived" value={`${lived.length} of ${shape.total}`} />
            <Stat
              label="Perfect days"
              value={`${perfectDays(active, progress, lived, now)} of ${lived.length}`}
            />
          </dl>
        </section>
      </div>

      <section className="card mt-5">
        <div className="border-b border-line/60 px-6 py-4">
          <h2 className="display text-xl font-semibold">Habit by habit</h2>
          <p className="mt-0.5 text-xs text-muted">
            How much of each habit&rsquo;s target has been met across the{" "}
            {lived.length} {lived.length === 1 ? "day" : "days"} so far
          </p>
        </div>
        {perHabit.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted">
            No active habits.
          </p>
        ) : (
          <ul>
            {perHabit.map((row) => (
              <HabitRunRow key={row.habit.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-sm font-semibold">{value}</dd>
    </div>
  );
}

interface HabitRun {
  habit: MonkHabit;
  complete: number;
  partial: number;
  missed: number;
  pending: number;
  // Units done over units asked for, across the days lived. A weighted rate
  // rather than a count of clean days: three prayers out of five is most of a
  // day's work, and a rate that only counted fives would report it as nothing.
  pct: number;
}

function readHabitRun(
  habit: MonkHabit,
  progress: MonkProgressMap,
  lived: Date[],
  now: Date,
): HabitRun {
  const run = { complete: 0, partial: 0, missed: 0, pending: 0 };
  let done = 0;
  let asked = 0;
  for (const day of lived) {
    const n = Math.min(progressOn(progress, day, habit.id), habit.dailyTarget);
    const status = statusFor(n, habit.dailyTarget, dayIsOver(day, now));
    if (status === "complete") run.complete += 1;
    else if (status === "partial") run.partial += 1;
    else if (status === "missed") run.missed += 1;
    else run.pending += 1;
    done += n;
    asked += habit.dailyTarget;
  }
  return {
    habit,
    ...run,
    pct: asked === 0 ? 0 : Math.round((done / asked) * 100),
  };
}

function perfectDays(
  habits: MonkHabit[],
  progress: MonkProgressMap,
  lived: Date[],
  now: Date,
): number {
  return lived.filter(
    (day) =>
      habits.length > 0 &&
      habits.every(
        (h) => progressOn(progress, day, h.id) >= h.dailyTarget,
      ),
  ).length;
}

function HabitRunRow({ row }: { row: HabitRun }) {
  const accent = monkAccent(row.habit.accent);
  return (
    <li className="border-b border-line/60 px-6 py-4 last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${accent.soft} ${accent.text}`}
        >
          <MonkIcon name={row.habit.icon} size={18} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {row.habit.name}
        </span>
        <span className="num shrink-0 text-sm font-semibold">{row.pct}%</span>
      </div>
      {/* One bar in the habit's own colour rather than a second donut. The
          counts beneath it are what the donut's three slices would have said,
          in fewer pixels. */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-wash">
        <div
          className="h-full rounded-full"
          style={{
            width: `${row.pct}%`,
            backgroundColor: accent.varRef,
          }}
        />
      </div>
      <div className="num mt-2 flex flex-wrap gap-x-4 text-[11px] text-muted">
        <span>{row.complete} complete</span>
        <span>{row.partial} partial</span>
        <span>{row.missed} missed</span>
      </div>
    </li>
  );
}
