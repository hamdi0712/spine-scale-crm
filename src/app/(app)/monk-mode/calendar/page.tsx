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
  loadHabits,
  loadProgress,
} from "@/lib/monkModeStore";
import {
  addDays,
  addMonths,
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

export const dynamic = "force-dynamic";

export default async function MonkCalendarPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const now = new Date();
  const monthStart = parseMonthKey(searchParams.month, now);

  const [challenge, habits] = await Promise.all([
    loadChallenge(now),
    loadHabits(),
  ]);
  const active = activeHabits(habits);

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
            {monkDateRange(shape.start, shape.end)} · day {shape.day} of{" "}
            {shape.total} · {tally.pct}% of habit-days completed
          </span>
        }
      />

      <section className="card p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="display text-xl font-semibold">{month.label}</h2>
          <div className="flex items-center gap-1">
            <MonthLink month={addMonths(monthStart, -1)} direction="prev" />
            {/* A way back to the month you are actually in, because paging six
                months out and then paging back is not a journey anybody should
                have to make. Hidden when it would do nothing. */}
            {monthKey(monthStart) !== monthKey(toChecklistDay(now)) && (
              <Link
                href="/monk-mode/calendar"
                className="rounded-[8px] px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-wash"
              >
                Today
              </Link>
            )}
            <MonthLink month={addMonths(monthStart, 1)} direction="next" />
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
              ? `/monk-mode/journal?date=${cell.key}`
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
}: {
  month: Date;
  direction: "prev" | "next";
}) {
  const Glyph = direction === "prev" ? IconChevronLeft : IconChevronRight;
  return (
    <Link
      href={`/monk-mode/calendar?month=${monthKey(month)}`}
      aria-label={direction === "prev" ? "Previous month" : "Next month"}
      className="rounded-[8px] p-2 text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
      <Glyph size={18} stroke={1.75} aria-hidden />
    </Link>
  );
}
