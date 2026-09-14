// Monk Mode — the day, on one screen.
//
// Three bands and nothing below the fold: the banner, the habits, and a row of
// four panels that read the challenge around them. That shape is the whole
// design. A discipline tracker is opened for ten seconds in the morning and
// ten at night, and anything that makes those ten seconds into a scroll is
// working against the only thing the page is for.
//
// Getting there was mostly removal. What went, and why:
//
//   · A "Today's Habits" list that repeated the habit cards above it, row for
//     row and action for action. Two readings of one day, one of them
//     redundant, half a screen tall.
//   · A "Quick Actions" card holding three links. Three links belong in the
//     header, where navigation is looked for; they are the segmented control
//     in MonkHeader now, and the card's height went back to the page.
//   · A "This Week" bar chart. Seven bars of daily completion, sitting between
//     a row of seven day dots in the streak panel and a month of tinted
//     squares in the calendar — the same fact told three times. It is on the
//     Progress page now, where a third reading of the week is the point.
//   · The habit descriptions, off the cards (see MonkHabitGrid).
//   · A footnote under the donut explaining what "in progress" means, which is
//     what the legend under the donut is for.
//
// One pass over the database and one set of rules. The page loads the
// challenge, the habits and every completion inside the window, then hands
// that one reading to each panel (src/lib/monkMode.ts). No panel queries for
// itself, which is what stops the donut and the calendar quietly disagreeing
// about what a half-finished day was.
//
// Nothing here touches the CRM: no lead, no client, no number off the funnel.
// It shares the app shell, the sidebar and the design tokens, and nothing else.

import Link from "next/link";
import {
  activeHabits,
  loadChallenge,
  loadHabits,
  loadNote,
  loadProgress,
} from "@/lib/monkModeStore";
import {
  addDays,
  challengeDays,
  challengeProgress,
  dayKey,
  daysSoFar,
  indexProgress,
  monkMonth,
  monkPerfectDays,
  monkStreakRow,
  monkStreaks,
  monkTally,
  readMonkDay,
  toChecklistDay,
} from "@/lib/monkMode";
import { greetingFor } from "@/lib/greeting";
import Greeting from "@/components/Greeting";
import MonkCalendarGrid from "@/components/MonkCalendarGrid";
import MonkDonut from "@/components/MonkDonut";
import MonkHabitGrid from "@/components/MonkHabitGrid";
import MonkHeader from "@/components/MonkHeader";
import MonkHero from "@/components/MonkHero";
import MonkNote from "@/components/MonkNote";
import MonkStreakPanel from "@/components/MonkStreakPanel";

export const dynamic = "force-dynamic";

export default async function MonkModePage() {
  const now = new Date();
  const today = toChecklistDay(now);

  const [challenge, habits] = await Promise.all([
    loadChallenge(now),
    loadHabits(),
  ]);
  const active = activeHabits(habits);
  const shape = challengeProgress(challenge, now);

  // One window wide enough for every panel: the challenge itself, plus the
  // calendar month around today, which can reach outside it at either end.
  const days = challengeDays(challenge);
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const from = new Date(
    Math.min(days[0].getTime(), addDays(monthStart, -7).getTime()),
  );
  const to = new Date(
    Math.max(days[days.length - 1].getTime(), addDays(monthStart, 45).getTime()),
  );

  const [rows, note] = await Promise.all([
    loadProgress(from, to),
    loadNote(today),
  ]);
  const progress = indexProgress(rows);

  const todayKey = dayKey(today);
  const todayRows = readMonkDay(active, progress, today, now);
  const lived = daysSoFar(challenge, now);
  const tally = monkTally(challenge, active, progress, now);
  const streaks = monkStreaks(challenge, active, progress, now);
  const streakRow = monkStreakRow(challenge, active, progress, now);
  const month = monkMonth(challenge, active, progress, monthStart, now);

  const doneToday = todayRows.filter((r) => r.status === "complete").length;
  const allDone = active.length > 0 && doneToday === active.length;

  // The month's own tally, for the line under the calendar. Counted off the
  // same cells the grid is drawn from, so the figure and the squares can never
  // disagree.
  const monthCells = month.cells.filter(
    (cell, i) => month.inMonth[i] && cell.dayNumber !== null && cell.past,
  );

  return (
    <div>
      <MonkHeader
        title={
          // The same greeting the main dashboard uses, rolled on the server on
          // every request and re-checked against the browser's own clock after
          // hydration. One greeting pattern in the app, not two.
          <Greeting serverGreeting={greetingFor(now.getHours(), now.getDay())} />
        }
        subtitle={
          active.length === 0
            ? "No habits set yet."
            : allDone
              ? `All ${active.length} done today. That is the whole job.`
              : `${active.length - doneToday} of ${active.length} still to do today.`
        }
      />

      <MonkHero
        challenge={challenge}
        habits={active}
        progress={progress}
        shape={shape}
        now={now}
      />

      <section className="card mt-4 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-base font-semibold">
            Your {active.length}{" "}
            {active.length === 1 ? "Non-Negotiable" : "Non-Negotiables"}
          </h2>
          {/* The day's score, in the one place it belongs: beside the things
              being scored. It was a line of prose under the heading saying
              "all 7 = a successful day", which is a rule anybody reading a
              list of seven non-negotiables has already worked out. */}
          {active.length > 0 && (
            <span
              className={`num text-xs font-medium ${allDone ? "text-ok" : "text-muted"}`}
            >
              {doneToday} / {active.length} today
            </span>
          )}
        </div>
        <MonkHabitGrid rows={todayRows} day={todayKey} />
      </section>

      {/* Four panels of one height, and the height is theirs rather than the
          tallest one's: each is a short reading, and the row is what makes
          them comparable. This replaced a main column and a rail, which could
          not be the same height as each other and so never were. */}
      <div className="mt-4 grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section className="card flex flex-col p-5">
          <h2 className="display mb-4 shrink-0 text-base font-semibold">
            Overall Progress
          </h2>
          <MonkDonut tally={tally} />
        </section>

        <section className="card flex flex-col p-5">
          <MonkStreakPanel
            streaks={streaks}
            row={streakRow}
            perfectDays={monkPerfectDays(active, progress, lived, now)}
            daysLived={lived.length}
          />
        </section>

        <section className="card flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="display text-base font-semibold">{month.label}</h2>
            <Link
              href="/monk-mode/calendar"
              className="text-xs font-medium text-accent hover:underline"
            >
              View all
            </Link>
          </div>
          <MonkCalendarGrid month={month} />
          <p className="num mt-auto border-t border-line/60 pt-3 text-xs text-muted">
            {monthCells.filter((c) => c.complete).length} of {monthCells.length}{" "}
            {monthCells.length === 1 ? "day" : "days"} complete
          </p>
        </section>

        <section className="card flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="display text-base font-semibold">Today&rsquo;s Note</h2>
            <Link
              href="/monk-mode/journal"
              className="text-xs font-medium text-accent hover:underline"
            >
              Journal
            </Link>
          </div>
          <MonkNote day={todayKey} content={note} rows={6} grow />
        </section>
      </div>
    </div>
  );
}
