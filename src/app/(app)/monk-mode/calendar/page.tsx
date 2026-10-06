// The challenge, month by month.
//
// The dashboard's compact widget at full size, with the legend it has no room
// for and a link out of every square into that day's journal entry. Same grid
// component, same rules — see MonkCalendarGrid for what the tints mean.
//
// Paging is a ?month= in the URL rather than state, so a month can be linked
// to and the page stays a server component with no JavaScript behind the
// arrows.

import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import {
  activeHabits,
  loadChallenge,
  loadChallengeById,
  loadHabits,
  loadProgress,
} from "@/lib/monkModeStore";
import {
  addDays,
  addMonths,
  challengeAsRun,
  challengeProgress,
  indexProgress,
  monkDateRange,
  monkMonth,
  monkTally,
  monthKey,
  parseMonthKey,
  toChecklistDay,
} from "@/lib/monkMode";
import MonkCalendarGrid, {
  MonkCalendarLegend,
} from "@/components/MonkCalendarGrid";
import MonkHeader from "@/components/MonkHeader";
import MonkPastBanner from "@/components/MonkPastBanner";

export const dynamic = "force-dynamic";

export default async function MonkCalendarPage({
  searchParams,
}: {
  searchParams: { month?: string; challenge?: string };
}) {
  const now = new Date();

  // ?challenge= opens a finished challenge from Progress → Past challenges.
  // Loading the current one first keeps the history repaired either way; an
  // unknown or still-open id just reads as the current challenge.
  const [current, habits] = await Promise.all([
    loadChallenge(now),
    loadHabits(),
  ]);
  const picked = searchParams.challenge
    ? await loadChallengeById(searchParams.challenge)
    : null;
  const pastView = picked?.endDate ? challengeAsRun(picked) : null;
  const challenge = pastView ?? current;
  const active = activeHabits(habits);
  const query = pastView ? `&challenge=${pastView.id}` : "";

  // A past challenge opens on the month it started in, not on this one.
  const monthStart = parseMonthKey(
    searchParams.month,
    pastView ? toChecklistDay(pastView.startDate) : now,
  );

  // Six weeks either side of the first of the month covers the whole grid,
  // including the neighbouring months' days that fill its corners.
  const rows = await loadProgress(
    addDays(monthStart, -7),
    addDays(monthStart, 45),
  );
  const progress = indexProgress(rows);
  const month = monkMonth(challenge, active, progress, monthStart, now);
  const shape = challengeProgress(challenge, now);
  const tally = monkTally(challenge, active, progress, now);

  return (
    <div className="max-w-5xl">
      <MonkHeader
        title={<h1 className="display text-[32px] font-semibold">Calendar</h1>}
        subtitle={
          <span className="num">
            {pastView ? (
              <>
                Past challenge · {monkDateRange(shape.start, shape.end)} ·{" "}
                {shape.total} days
              </>
            ) : (
              <>
                {monkDateRange(shape.start, shape.end)} · day {shape.day} of{" "}
                {shape.total}
              </>
            )}{" "}
            · {tally.pct}% of habit-days completed
          </span>
        }
      />

      {pastView && <MonkPastBanner href="/monk-mode/calendar" />}

      <section className="card p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="display text-xl font-semibold">{month.label}</h2>
          <div className="flex items-center gap-1">
            <MonthLink
              month={addMonths(monthStart, -1)}
              direction="prev"
              query={query}
            />
            {/* A way back to the month you are actually in, because paging six
                months out and then paging back is not a journey anybody should
                have to make. Hidden when it would do nothing. */}
            {!pastView && monthKey(monthStart) !== monthKey(toChecklistDay(now)) && (
              <Link
                href="/monk-mode/calendar"
                className="rounded-[8px] px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-wash"
              >
                Today
              </Link>
            )}
            <MonthLink
              month={addMonths(monthStart, 1)}
              direction="next"
              query={query}
            />
          </div>
        </div>

        <MonkCalendarGrid
          month={month}
          size="full"
          // Only days inside the challenge that have actually happened lead
          // anywhere: a square for next Tuesday has no entry to read, and one
          // for a day before the challenge started is not part of it.
          hrefFor={(cell) =>
            cell.dayNumber !== null && cell.past
              ? `/monk-mode/journal?date=${cell.key}${query}`
              : null
          }
        />

        <div className="mt-6 border-t border-line/60 pt-4">
          <MonkCalendarLegend />
        </div>
      </section>
    </div>
  );
}

function MonthLink({
  month,
  direction,
  query,
}: {
  month: Date;
  direction: "prev" | "next";
  query: string;
}) {
  const Glyph = direction === "prev" ? IconChevronLeft : IconChevronRight;
  return (
    <Link
      href={`/monk-mode/calendar?month=${monthKey(month)}${query}`}
      aria-label={direction === "prev" ? "Previous month" : "Next month"}
      className="rounded-[8px] p-2 text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
      <Glyph size={18} stroke={1.75} aria-hidden />
    </Link>
  );
}
