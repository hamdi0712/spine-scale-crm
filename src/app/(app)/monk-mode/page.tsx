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
// The page holds a day rather than assuming today. ?date= opens one — which is
// where the journal's "Log habits" link and the day arrows lead — and the
// habit cards and the note both write to it. Everything else on the page
// (the banner, the donut, the streak) still reads from the real today, because
// those are readings of the whole run and not of the day you happen to have
// open. Backfilling a day therefore moves them all on the next render: they
// are derived from the completion rows every time, never stored.
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
import { IconCalendarMonth, IconCrownFilled, IconNotebook } from "@tabler/icons-react";
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
  monkCelebration,
  monkMonth,
  monkPerfectDays,
  monkStreakRow,
  monkStreaks,
  monkTally,
  readMonkDay,
  toChecklistDay,
} from "@/lib/monkMode";
import { parseDayKey } from "@/lib/dailyChecklist";
import { fmtDate } from "@/lib/format";
import { greetingFor } from "@/lib/greeting";
import Greeting from "@/components/Greeting";
import MonkCelebrate from "@/components/MonkCelebrate";
import MonkCalendarGrid from "@/components/MonkCalendarGrid";
import MonkDayBar from "@/components/MonkDayBar";
import MonkDonut from "@/components/MonkDonut";
import MonkHabitGrid from "@/components/MonkHabitGrid";
import MonkHeader from "@/components/MonkHeader";
import MonkHero from "@/components/MonkHero";
import MonkNote from "@/components/MonkNote";
import MonkStatBadge from "@/components/MonkStatBadge";
import MonkStreakPanel from "@/components/MonkStreakPanel";

export const dynamic = "force-dynamic";

export default async function MonkModePage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const now = new Date();
  const today = toChecklistDay(now);

  // The day being logged. Today unless ?date= says otherwise, and never a day
  // that has not started — the action refuses those, and a page that offered
  // controls it knows will be ignored would be lying about what it does.
  const asked = toChecklistDay(parseDayKey(searchParams.date, now));
  const viewing = asked.getTime() > today.getTime() ? today : asked;
  const isToday = viewing.getTime() === today.getTime();

  const [challenge, habits] = await Promise.all([
    loadChallenge(now),
    loadHabits(),
  ]);
  const active = activeHabits(habits);
  const shape = challengeProgress(challenge, now);

  // One window wide enough for every panel: the challenge itself, plus the
  // calendar month around today, which can reach outside it at either end.
  // The calendar follows the day being viewed, so paging back into March
  // shows March rather than leaving the month grid on a day nobody is looking
  // at; the window has to cover today as well, because the streak and the
  // donut are still read up to the real today whatever is open.
  const days = challengeDays(challenge);
  const monthStart = new Date(
    Date.UTC(viewing.getUTCFullYear(), viewing.getUTCMonth(), 1),
  );
  const from = new Date(
    Math.min(
      days[0].getTime(),
      addDays(monthStart, -7).getTime(),
      viewing.getTime(),
    ),
  );
  const to = new Date(
    Math.max(
      days[days.length - 1].getTime(),
      addDays(monthStart, 45).getTime(),
      today.getTime(),
    ),
  );

  const [rows, note] = await Promise.all([
    loadProgress(from, to),
    loadNote(viewing),
  ]);
  const progress = indexProgress(rows);

  const viewKey = dayKey(viewing);
  const viewRows = readMonkDay(active, progress, viewing, now);
  // Today's own reading, kept separate from the day on screen: the confetti
  // and the header count are about today even while March is open.
  const todayRows = isToday
    ? viewRows
    : readMonkDay(active, progress, today, now);
  const lived = daysSoFar(challenge, now);
  const tally = monkTally(challenge, active, progress, now);
  const streaks = monkStreaks(challenge, active, progress, now);
  const streakRow = monkStreakRow(challenge, active, progress, now);
  const month = monkMonth(challenge, active, progress, monthStart, now);

  const doneToday = todayRows.filter((r) => r.status === "complete").length;
  const allDone = active.length > 0 && doneToday === active.length;

  // The same two figures for the day actually on screen, which is what the
  // habit panel scores.
  const doneOnDay = viewRows.filter((r) => r.status === "complete").length;
  const allDoneOnDay = active.length > 0 && doneOnDay === active.length;

  // The month's own tally, for the line under the calendar. Counted off the
  // same cells the grid is drawn from, so the figure and the squares can never
  // disagree.
  const monthCells = month.cells.filter(
    (cell, i) => month.inMonth[i] && cell.dayNumber !== null && cell.past,
  );
  const monthComplete = monthCells.filter((c) => c.complete).length;

  // What, if anything, is worth a burst of confetti right now. The server
  // decides *what happened* and names the occasion; the browser decides
  // whether it has already celebrated that one. See MonkCelebrate for why the
  // trigger cannot simply be the condition.
  const celebration = monkCelebration({
    today,
    dayComplete: allDone,
    streak: streaks.current,
    isLastDay: shape.day === shape.total && shape.started,
  });

  return (
    <div>
      {/* Renders nothing. It reads the occasion above and fires once, in the
          browser, the first time it sees a key it has not already fired. */}
      <MonkCelebrate
        occasion={celebration?.key ?? null}
        kind={celebration?.kind ?? "day"}
      />

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

      {/* Which day the habits and the note below write to. On today it is a
          pair of arrows; on any other day it says so in gold. */}
      <MonkDayBar day={viewing} today={today} />

      <MonkHero
        challenge={challenge}
        habits={active}
        progress={progress}
        shape={shape}
        now={now}
      />

      <section className="card mt-3.5 px-4 py-3">
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
              className={`num text-xs font-medium ${allDoneOnDay ? "text-ok" : "text-muted"}`}
            >
              {doneOnDay} / {active.length} {isToday ? "today" : fmtDate(viewing)}
            </span>
          )}
        </div>
        <MonkHabitGrid rows={viewRows} day={viewKey} />
      </section>

      {/* Four panels of one height, and the height is theirs rather than the
          tallest one's: each is a short reading, and the row is what makes
          them comparable. This replaced a main column and a rail, which could
          not be the same height as each other and so never were. */}
      <div className="mt-3.5 grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section className="card flex flex-col p-5">
          {/* Every panel in the row is headed by its own mark now. Filled
              rather than outlined: at sixteen pixels beside a heading a
              stroked glyph reads as grey noise, and a solid one reads as an
              icon. */}
          <h2 className="display mb-4 flex shrink-0 items-center gap-2 text-base font-semibold">
            <IconCrownFilled size={16} className="text-warn" aria-hidden />
            Overall Progress
          </h2>
          <MonkDonut tally={tally} />
        </section>

        {/* `relative` is load-bearing: the treeline inside is absolutely
            positioned and .card is overflow-hidden but position: static, so
            without this the strip escapes the card and lays itself across the
            full width of the page — which is exactly what it did. */}
        <section className="card relative flex flex-col p-5">
          <MonkStreakPanel
            streaks={streaks}
            row={streakRow}
            perfectDays={monkPerfectDays(active, progress, lived, now)}
            daysLived={lived.length}
          />
        </section>

        <section className="card flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="display flex items-center gap-2 text-base font-semibold">
              <IconCalendarMonth
                size={16}
                stroke={2}
                className="text-accent"
                aria-hidden
              />
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
          {/* The same strip Overall Progress closes with, so the two panels
              end on one object rather than on a caption and a badge. The
              trophy is unconditional here: the strip is the month's result and
              a result needs a mark, where a bare count beside an empty slot
              read as something failing to appear. */}
          <div className="mt-auto pt-3">
            <MonkStatBadge icon="trophy" tone="gold">
              <span className="num font-medium text-ink">
                {monthComplete} of {monthCells.length}
              </span>{" "}
              {monthCells.length === 1 ? "day" : "days"} complete this month
            </MonkStatBadge>
          </div>
        </section>

        <section className="card flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="display flex items-center gap-2 text-base font-semibold">
              <IconNotebook
                size={16}
                stroke={2}
                className="text-ai"
                aria-hidden
              />
              {isToday ? <>Today&rsquo;s Note</> : `Note · ${fmtDate(viewing)}`}
            </h2>
            <Link
              href="/monk-mode/journal"
              className="text-xs font-medium text-accent hover:underline"
            >
              Journal
            </Link>
          </div>
          <MonkNote day={viewKey} content={note} rows={6} grow />
        </section>
      </div>
    </div>
  );
}
