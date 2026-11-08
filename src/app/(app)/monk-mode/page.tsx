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

import { Suspense } from "react";
import {
  IconCalendarMonth,
  IconChartDonut,
  IconMountain,
  IconNotebook,
} from "@tabler/icons-react";
import Link from "next/link";
import {
  activeHabits,
  loadChallenge,
  loadHabits,
  loadNote,
  loadProgress,
} from "@/lib/monkModeStore";
import {
  MonkChallenge,
  MonkHabit,
  MonkProgressMap,
  addDays,
  challengeDays,
  challengeProgress,
  dayKey,
  daysSoFar,
  indexProgress,
  monkCelebration,
  monkChallengeCells,
  monkDateRange,
  monkMonth,
  monkPerfectDays,
  monkProgressNote,
  monkStreakRow,
  monkStreaks,
  monkTally,
  readMonkDay,
  toChecklistDay,
} from "@/lib/monkMode";
import { parseDayKey } from "@/lib/dailyChecklist";
import { fmtDate } from "@/lib/format";
import { greetingFor } from "@/lib/greeting";
import { fallbackMonkQuote } from "@/lib/monkModeQuote";
import { loadMonkQuote } from "@/lib/monkModeQuoteStore";
import Greeting from "@/components/Greeting";
import MonkCelebrate from "@/components/MonkCelebrate";
import MonkDayBar from "@/components/MonkDayBar";
import MonkHeader from "@/components/MonkHeader";
import MonkNote from "@/components/MonkNote";
import {
  MonkCardHead,
  MonkChallengeBar,
  MonkGlassRing,
  MonkHabitList,
  MonkLegend,
  MonkMonthGrid,
  MonkNoteBanner,
  MonkStatTile,
  MonkWeekStrip,
} from "@/components/MonkToday";

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

  // Today's progress, for the day on screen: done, part-done, untouched.
  const partOnDay = viewRows.filter((r) => r.status !== "complete" && r.done > 0).length;
  const notYetOnDay = viewRows.length - doneOnDay - partOnDay;
  const perfect = monkPerfectDays(active, progress, lived, now);
  const encouragement = monkProgressNote(tally.pct, tally.decided);
  const cells = monkChallengeCells(challenge, active, progress, now);
  const daysLeft = Math.max(0, shape.total - shape.day);

  return (
    <div>
      {/* Renders nothing. It reads the occasion above and fires once, in the
          browser, the first time it sees a key it has not already fired. */}
      <MonkCelebrate
        occasion={celebration?.key ?? null}
        kind={celebration?.kind ?? "day"}
      />

      <MonkHeader
        title={<Greeting serverGreeting={greetingFor(now.getHours(), now.getDay())} />}
        subtitle={
          <Suspense fallback={<QuoteFallback />}>
            <Quote challenge={challenge} habits={active} progress={progress} now={now} />
          </Suspense>
        }
      />

      <MonkDayBar day={viewing} today={today} />

      <div className="grid items-stretch gap-6 lg:grid-cols-12 wide:gap-4">
        {/* The challenge and the day's habits, one card. */}
        <section className="card p-6 lg:col-span-7 wide:col-span-8 wide:p-5">
          <MonkCardHead
            icon={<IconMountain size={16} stroke={1.75} aria-hidden />}
            title={`${shape.total} Day Challenge`}
            sub={
              <span className="num">
                Day {shape.day} of {shape.total} · {monkDateRange(shape.start, shape.end)}
                {!shape.started && " · not started"}
                {shape.finished && " · finished"}
              </span>
            }
            aside={
              shape.started && !shape.finished ? (
                <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-accent-soft px-2 text-[11px] font-semibold text-accent">
                  {daysLeft} {daysLeft === 1 ? "day" : "days"} to go
                </span>
              ) : null
            }
          />
          <MonkChallengeBar cells={cells} shape={shape} />
          <div className="my-6 h-px bg-line wide:my-5" />
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] wide:text-[15px]">
              {isToday ? <>Today&rsquo;s non-negotiables</> : `Non-negotiables · ${fmtDate(viewing)}`}
            </h2>
            {active.length > 0 && (
              <span className="num text-[13px] text-muted wide:text-xs">
                <b className="font-semibold text-ink">{doneOnDay}</b> of {active.length} done
              </span>
            )}
          </div>
          <MonkHabitList rows={viewRows} day={viewKey} />
        </section>

        {/* Progress, streak and the run's encouragement. */}
        <section className="card flex flex-col p-6 lg:col-span-5 wide:col-span-4 wide:p-5">
          <MonkCardHead
            icon={<IconChartDonut size={16} stroke={1.75} aria-hidden />}
            title={isToday ? <>Today&rsquo;s progress</> : `Progress · ${fmtDate(viewing)}`}
          />
          <div className="mt-6 flex items-center gap-8 wide:mt-5 wide:gap-10">
            <MonkGlassRing done={doneOnDay} partial={partOnDay} total={active.length} />
            <MonkLegend done={doneOnDay} partial={partOnDay} notYet={notYetOnDay} />
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2">
            <MonkStatTile
              label="Streak"
              value={streaks.current}
              unit={streaks.current === 1 ? "day" : "days"}
              foot={<div className="mt-1 text-[11px] text-muted/80">{streaks.current > 0 ? "Keep it going" : "Starts with today"}</div>}
            />
            <MonkStatTile
              label="Best"
              value={streaks.best}
              unit={streaks.best === 1 ? "day" : "days"}
              foot={<div className="mt-1 text-[11px] text-muted/80">Your record</div>}
            />
            <MonkStatTile
              label="Perfect days"
              value={perfect}
              unit={`of ${lived.length}`}
              foot={
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-wash">
                  <i
                    className="block h-full min-w-[4px] rounded-full bg-accent"
                    style={{ width: `${lived.length > 0 ? (perfect / lived.length) * 100 : 0}%` }}
                  />
                </div>
              }
            />
          </div>
          <div className="my-6">
            <MonkWeekStrip cells={streakRow} />
          </div>
          <div className="mt-auto">
            <MonkNoteBanner text={encouragement.text} />
          </div>
        </section>

        {/* The note for the day on screen. */}
        <section className="card flex flex-col p-6 lg:col-span-7 wide:col-span-8 wide:p-5">
          <div className="mb-4">
            <MonkCardHead
              icon={<IconNotebook size={16} stroke={1.75} aria-hidden />}
              title={isToday ? <>Today&rsquo;s note</> : `Note · ${fmtDate(viewing)}`}
              aside={
                <Link href="/monk-mode/journal" className="text-xs font-medium text-accent hover:underline">
                  Open journal
                </Link>
              }
            />
          </div>
          <MonkNote day={viewKey} content={note} rows={7} grow />
        </section>

        {/* The month around the day on screen. */}
        <section className="card p-6 lg:col-span-5 wide:col-span-4 wide:p-5">
          <div className="mb-4">
            <MonkCardHead
              icon={<IconCalendarMonth size={16} stroke={1.75} aria-hidden />}
              title={month.label}
              aside={
                <Link href="/monk-mode/calendar" className="text-xs font-medium text-accent hover:underline">
                  View all
                </Link>
              }
            />
          </div>
          <MonkMonthGrid month={month} />
          <p className="num mt-3 text-xs text-muted">
            {monthComplete} of {monthCells.length} {monthCells.length === 1 ? "day" : "days"} complete this month
          </p>
        </section>
      </div>
    </div>
  );
}

// The day's line, under the greeting. Loaded behind Suspense because it can
// be written fresh for the day; the fallback is the day's stock line.
async function Quote(props: {
  challenge: MonkChallenge;
  habits: MonkHabit[];
  progress: MonkProgressMap;
  now: Date;
}) {
  const quote = await loadMonkQuote(props);
  return (
    <span data-quote-source={quote.source}>
      &ldquo;{quote.text}&rdquo; &mdash; {quote.author}
    </span>
  );
}

function QuoteFallback() {
  const quote = fallbackMonkQuote(dayKey(toChecklistDay(new Date())));
  return (
    <span>
      &ldquo;{quote.text}&rdquo; &mdash; {quote.author}
    </span>
  );
}
