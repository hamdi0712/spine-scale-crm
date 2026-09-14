// Monk Mode — the dashboard.
//
// Everything about the day in one view: the banner and its quotation, the
// non-negotiables as cards, and the panels that read the challenge around them
// — overall progress, the streak, the month, today as a list, the note, and
// the week.
//
// One pass over the database and one set of rules. The page loads the
// challenge, the habits and every completion inside the challenge's window,
// then hands that one reading to each panel (src/lib/monkMode.ts). No panel
// queries for itself, which is what stops the donut and the calendar quietly
// disagreeing about what a half-finished day was.
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
  indexProgress,
  monkMonth,
  monkStreakRow,
  monkStreaks,
  monkTally,
  monkWeekBars,
  readMonkDay,
  toChecklistDay,
} from "@/lib/monkMode";
import { IconCalendarEvent, IconSettings } from "@tabler/icons-react";
import { greetingFor } from "@/lib/greeting";
import Greeting from "@/components/Greeting";
import MonkCalendarGrid from "@/components/MonkCalendarGrid";
import MonkDonut from "@/components/MonkDonut";
import MonkHabitGrid, { MonkLegend } from "@/components/MonkHabitGrid";
import MonkHero from "@/components/MonkHero";
import MonkNote from "@/components/MonkNote";
import MonkQuickActions from "@/components/MonkQuickActions";
import MonkStreakPanel from "@/components/MonkStreakPanel";
import MonkTodayList from "@/components/MonkTodayList";
import MonkWeekBars from "@/components/MonkWeekBars";

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

  // One window wide enough for every panel on the page: the challenge itself,
  // plus the calendar month around today and the current week, either of which
  // can reach outside the challenge at its ends.
  const days = challengeDays(challenge);
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const from = new Date(
    Math.min(days[0].getTime(), addDays(monthStart, -7).getTime()),
  );
  const to = new Date(
    Math.max(
      days[days.length - 1].getTime(),
      addDays(monthStart, 45).getTime(),
    ),
  );

  const [rows, note] = await Promise.all([
    loadProgress(from, to),
    loadNote(today),
  ]);
  const progress = indexProgress(rows);

  const todayKey = dayKey(today);
  const todayRows = readMonkDay(active, progress, today, now);
  const tally = monkTally(challenge, active, progress, now);
  const streaks = monkStreaks(challenge, active, progress, now);
  const streakRow = monkStreakRow(challenge, active, progress, now);
  const week = monkWeekBars(challenge, active, progress, now);
  const month = monkMonth(challenge, active, progress, monthStart, now);

  const doneToday = todayRows.filter((r) => r.status === "complete").length;
  // The month's own tally, for the line under the calendar widget. Counted off
  // the same cells the grid is drawn from, so the figure and the squares can
  // never disagree.
  const monthCells = month.cells.filter(
    (cell, i) => month.inMonth[i] && cell.dayNumber !== null && cell.past,
  );
  const monthLived = monthCells.length;
  const monthComplete = monthCells.filter((cell) => cell.complete).length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          {/* The same greeting the main dashboard uses, rolled on the server on
              every request and checked against the browser's own clock after
              hydration. One greeting pattern in the app, not two. */}
          <Greeting serverGreeting={greetingFor(now.getHours(), now.getDay())} />
          <p className="mt-1.5 text-sm text-muted">
            {shape.total} days. {active.length}{" "}
            {active.length === 1 ? "non-negotiable" : "non-negotiables"}. A
            stronger you.
          </p>
        </div>
        {/* The reference puts a location and a weather reading here. This app
            has neither and should not pretend to, so the chip says the one
            thing it actually knows: which day of the challenge this is. */}
        <div className="flex items-center gap-3">
          <span className="btn pointer-events-none gap-2.5">
            <IconCalendarEvent size={16} stroke={1.75} className="text-muted" aria-hidden />
            <span className="num">
              Day {shape.day} of {shape.total}
            </span>
          </span>
          <Link href="/monk-mode/settings" className="btn">
            <IconSettings size={16} stroke={1.75} aria-hidden />
            Habits
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <MonkHero
          challenge={challenge}
          habits={active}
          progress={progress}
          shape={shape}
          now={now}
        />
      </div>

      {/* The non-negotiables run the full width of the page rather than sitting
          in the column beside the rail. Seven cards need seven columns to be
          seven cards — squeezed into two thirds of the page they become seven
          slivers with the names broken across three lines each, which is a
          worse reading of the same day. */}
      <section className="card mt-5 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="display text-xl font-semibold">
              Your {active.length}{" "}
              {active.length === 1 ? "Non-Negotiable" : "Non-Negotiables"}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Complete each habit daily. All {active.length} = a successful day.
            </p>
          </div>
          <MonkLegend />
        </div>
        <div className="mt-5">
          <MonkHabitGrid rows={todayRows} day={todayKey} />
        </div>
      </section>

      {/* The main column and the rail. The rail is the three short readings —
          progress, streak, quick actions — and the column is everything else
          that is about today itself. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 xl:grid-cols-3">
            <section className="card flex flex-col p-5 xl:col-span-1">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="display text-base font-semibold">
                  {month.label}
                </h2>
                <Link
                  href="/monk-mode/calendar"
                  className="text-xs font-medium text-accent hover:underline"
                >
                  View all
                </Link>
              </div>
              <MonkCalendarGrid month={month} />
              {/* A line of summary under the grid. The squares say which days
                  went well; this says how many, which is the question anybody
                  looking at a month of them is actually asking. */}
              <p className="num mt-auto pt-4 text-xs text-muted">
                {monthComplete} of {monthLived}{" "}
                {monthLived === 1 ? "day" : "days"} complete this month
              </p>
            </section>

            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                {/* Both halves refuse to wrap: at a third of the column the
                    heading was breaking across two lines to make room for a
                    count that fits perfectly well beside it. */}
                <h2 className="display shrink-0 whitespace-nowrap text-base font-semibold">
                  Today&rsquo;s Habits
                </h2>
                <span className="num shrink-0 whitespace-nowrap text-xs text-muted">
                  {doneToday} / {active.length}
                </span>
              </div>
              <MonkTodayList rows={todayRows} day={todayKey} />
            </section>

            <section className="card flex flex-col p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="display text-base font-semibold">Daily Notes</h2>
                <Link
                  href="/monk-mode/journal"
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Journal
                </Link>
              </div>
              <MonkNote day={todayKey} content={note} />
              <div className="mt-6 border-t border-line/60 pt-4">
                <h3 className="mb-4 text-sm font-semibold">This Week</h3>
                <MonkWeekBars bars={week} />
              </div>
            </section>
          </div>
        </div>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="display mb-4 text-xl font-semibold">
              Overall Progress
            </h2>
            <MonkDonut tally={tally} />
            <p className="mt-4 border-t border-line/60 pt-3 text-[11px] leading-relaxed text-muted">
              Every habit, every day of the challenge so far. Today&rsquo;s
              untouched habits are not counted either way until the day is over.
            </p>
          </section>

          <section className="card p-5">
            <MonkStreakPanel streaks={streaks} row={streakRow} />
          </section>

          <section className="card p-5">
            <h2 className="display mb-3 text-xl font-semibold">Quick Actions</h2>
            <MonkQuickActions />
          </section>
        </div>
      </div>
    </div>
  );
}
