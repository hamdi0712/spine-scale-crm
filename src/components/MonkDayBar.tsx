// Which day you are logging against, and the way to another one.
//
// Monk Mode's habits and note used to be today's and only today's, so the page
// never had to say which day it was writing to — there was only one. Past days
// are editable now (see src/lib/actions/monkMode.ts for why), which makes the
// day a thing the page is holding rather than a thing it can assume, and a
// page holding a day has to say so.
//
// So this is deliberately loudest in the one case that matters. On today it is
// a pair of arrows and nothing else: no banner announcing the day you are
// obviously on. On any other day it becomes an "Editing …" pill, in the same
// warning gold the rest of the app uses for "read this before you act", plus a
// one-tap way back. Somebody who paged back three days and then tapped a habit
// should never be able to say afterwards that they thought it was today.
//
// A ?date= in the URL rather than state, the same way the calendar pages its
// months: the day is linkable, the arrows need no JavaScript behind them, and
// the page stays a server component.
//
// Tomorrow is not offered. The action refuses a day that has not started, and
// an arrow that leads somewhere nothing can be written is not a control.

import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconPencil } from "@tabler/icons-react";
import { addDays, dayKey, toChecklistDay } from "@/lib/monkMode";
import { fmtDate } from "@/lib/format";

export default function MonkDayBar({
  day,
  today,
  basePath = "/monk-mode",
}: {
  // The day being shown and written to, and the real one, both as
  // midnight-UTC days.
  day: Date;
  today: Date;
  // Which page the arrows page within — the dashboard logs habits, the
  // journal writes notes, and both hold a day the same way.
  basePath?: string;
}) {
  const isToday = toChecklistDay(day).getTime() === toChecklistDay(today).getTime();
  const href = (d: Date) => `${basePath}?date=${dayKey(d)}`;

  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {/* The indicator, and the empty space it leaves on today. Rendered as a
          span either way so the arrows stay where they are rather than sliding
          across the row as you page in and out of today. */}
      {isToday ? (
        <span className="text-xs text-muted">
          Logging <span className="font-medium text-ink">today</span>.
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-warn-soft px-2.5 text-xs font-medium text-warn-on-soft">
            <IconPencil size={12} stroke={2} aria-hidden />
            <span className="num">Editing {fmtDate(day)}</span>
          </span>
          <span className="text-xs text-muted">Not today.</span>
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <DayLink day={addDays(day, -1)} basePath={basePath} direction="prev" />
        {/* Hidden when it would do nothing, the way the calendar's own Today
            link is. */}
        {!isToday && (
          <Link
            href={basePath}
            className="rounded-[8px] px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-wash"
          >
            Today
          </Link>
        )}
        <DayLink
          day={addDays(day, 1)}
          basePath={basePath}
          direction="next"
          disabled={isToday}
        />
      </div>
    </div>
  );
}

function DayLink({
  day,
  basePath,
  direction,
  disabled = false,
}: {
  day: Date;
  basePath: string;
  direction: "prev" | "next";
  disabled?: boolean;
}) {
  const Glyph = direction === "prev" ? IconChevronLeft : IconChevronRight;
  const label = direction === "prev" ? "Previous day" : "Next day";

  // Drawn rather than dropped, so the pair keeps its shape at the end of the
  // run — a single arrow floating on the right is not a pager.
  if (disabled) {
    return (
      <span
        aria-hidden
        className="rounded-[8px] p-2 text-muted/40"
        title="Tomorrow has not happened yet"
      >
        <Glyph size={18} stroke={1.75} />
      </span>
    );
  }

  return (
    <Link
      href={`${basePath}?date=${dayKey(day)}`}
      aria-label={label}
      className="rounded-[8px] p-2 text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
      <Glyph size={18} stroke={1.75} aria-hidden />
    </Link>
  );
}
