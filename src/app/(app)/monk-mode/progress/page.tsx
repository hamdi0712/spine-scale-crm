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
  loadPastChallenges,
  loadProgress,
} from "@/lib/monkModeStore";
import Link from "next/link";
import {
  MonkChallenge,
  MonkHabit,
  MonkProgressMap,
  challengeAsRun,
  challengeDays,
  challengeProgress,
  dayIsOver,
  daysSoFar,
  indexProgress,
  monkAccent,
  monkDateRange,
  monkPerfectDays,
  monkStreaks,
  monkTally,
  monkWeekBars,
  progressOn,
  statusFor,
} from "@/lib/monkMode";
import MonkDonut from "@/components/MonkDonut";
import MonkHeader from "@/components/MonkHeader";
import MonkIcon from "@/components/MonkIcon";
import MonkWeekBars from "@/components/MonkWeekBars";

export const dynamic = "force-dynamic";

export default async function MonkProgressPage() {
  const now = new Date();
  // The current challenge first: loading it repairs the history the past
  // list then reads.
  const [challenge, habits] = await Promise.all([
    loadChallenge(now),
    loadHabits(),
  ]);
  const past = await loadPastChallenges();
  const active = activeHabits(habits);
  const days = challengeDays(challenge);

  const rows = await loadProgress(days[0], days[days.length - 1]);
  const progress = indexProgress(rows);

  const shape = challengeProgress(challenge, now);
  const tally = monkTally(challenge, active, progress, now);
  const streaks = monkStreaks(challenge, active, progress, now);
  const lived = daysSoFar(challenge, now);
  // The week's bars were a panel on the dashboard until they were the third
  // reading of the same seven days on one screen. Here they are the point:
  // this page is where the challenge is read at more than a glance.
  const week = monkWeekBars(challenge, active, progress, now);

  const perHabit = active.map((habit) =>
    readHabitRun(habit, progress, lived, now),
  );

  const pastRuns = await readPastRuns(past, active, now);

  return (
    <div className="max-w-5xl">
      <MonkHeader
        title={<h1 className="display text-[32px] font-semibold">Progress</h1>}
        subtitle={
          <span className="num">
            {monkDateRange(shape.start, shape.end)} · day {shape.day} of{" "}
            {shape.total}
          </span>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2 max-sm:grid-cols-1">
        <section className="card flex flex-col p-5">
          <h2 className="display mb-4 shrink-0 text-xl font-semibold">Overall</h2>
          <MonkDonut tally={tally} />
        </section>
        <section className="card flex flex-col p-5">
          <h2 className="display mb-4 text-xl font-semibold">The run</h2>
          <dl className="space-y-3">
            <Stat label="Current streak" value={`${streaks.current} days`} />
            <Stat label="Best streak" value={`${streaks.best} days`} />
            <Stat label="Days lived" value={`${lived.length} of ${shape.total}`} />
            <Stat
              label="Perfect days"
              value={`${monkPerfectDays(active, progress, lived, now)} of ${lived.length}`}
            />
          </dl>
          <div className="mt-auto border-t border-line/60 pt-4">
            <h3 className="mb-4 text-sm font-semibold">This week</h3>
            <MonkWeekBars bars={week} />
          </div>
        </section>
      </div>

      <section className="card mt-5">
        <div className="border-b border-line/60 px-6 py-4">
          <h2 className="display text-xl font-semibold">Habit by habit</h2>
          <p className="helper-text mt-0.5 text-xs text-muted">
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

      <PastChallenges runs={pastRuns} />
    </div>
  );
}

interface PastRun {
  challenge: MonkChallenge;
  start: Date;
  end: Date;
  days: number;
  pct: number;
  best: number;
  perfect: number;
}

// Every finished challenge, read with the same rules as the current one. One
// query for all of them: the completions are filed by day, so the whole span
// from the oldest start to the newest end is one range.
async function readPastRuns(
  past: MonkChallenge[],
  active: MonkHabit[],
  now: Date,
): Promise<PastRun[]> {
  if (past.length === 0) return [];
  const runs = past.map(challengeAsRun);
  const spans = runs.map((c) => challengeDays(c));
  const from = new Date(Math.min(...spans.map((d) => d[0].getTime())));
  const to = new Date(Math.max(...spans.map((d) => d[d.length - 1].getTime())));
  const progress = indexProgress(await loadProgress(from, to));

  return runs.map((run, i) => {
    const days = spans[i];
    return {
      challenge: run,
      start: days[0],
      end: days[days.length - 1],
      days: days.length,
      pct: monkTally(run, active, progress, now).pct,
      best: monkStreaks(run, active, progress, now).best,
      perfect: monkPerfectDays(active, progress, days, now),
    };
  });
}

function PastChallenges({ runs }: { runs: PastRun[] }) {
  return (
    <section className="card mt-5">
      <div className="border-b border-line/60 px-6 py-4 max-sm:px-4">
        <h2 className="display text-xl font-semibold">Past challenges</h2>
        <p className="helper-text mt-0.5 text-xs text-muted">
          Every challenge you have finished, read the same way as this one
        </p>
      </div>
      {runs.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted">
          No finished challenges yet.
        </p>
      ) : (
        <ul>
          {runs.map((run) => (
            <li
              key={run.challenge.id}
              className="border-b border-line/60 px-6 py-4 last:border-b-0 max-sm:px-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="num text-sm font-medium">
                  {monkDateRange(run.start, run.end)}
                </span>
                <span className="num text-xs text-muted">
                  {run.days} {run.days === 1 ? "day" : "days"}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-wash">
                <div
                  className="h-full rounded-full bg-ok"
                  style={{ width: `${run.pct}%` }}
                />
              </div>
              <dl className="num mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted">
                <div>
                  <dt>Completed</dt>
                  <dd className="text-sm font-semibold text-ink">{run.pct}%</dd>
                </div>
                <div>
                  <dt>Best streak</dt>
                  <dd className="text-sm font-semibold text-ink">
                    {run.best} {run.best === 1 ? "day" : "days"}
                  </dd>
                </div>
                <div>
                  <dt>Perfect days</dt>
                  <dd className="text-sm font-semibold text-ink">
                    {run.perfect} of {run.days}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
                <Link
                  href={`/monk-mode/calendar?challenge=${run.challenge.id}`}
                  className="text-accent hover:underline"
                >
                  View calendar
                </Link>
                <Link
                  href={`/monk-mode/journal?challenge=${run.challenge.id}`}
                  className="text-accent hover:underline"
                >
                  View journal
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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

function HabitRunRow({ row }: { row: HabitRun }) {
  const accent = monkAccent(row.habit.accent);
  return (
    <li className="border-b border-line/60 px-6 py-3.5 last:border-b-0">
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
      {/* The bar is green, not the habit's own colour. The accent says which
          habit this is — it is on the glyph, where identity belongs — and
          green says how much of it got done. Drawn in the accent, a habit
          whose colour happens to be red reported an excellent fortnight in
          alarm red, which is the two colour systems fighting that the habit
          cards were rebuilt to stop. */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-wash">
        <div
          className="h-full rounded-full bg-ok"
          style={{ width: `${row.pct}%` }}
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
