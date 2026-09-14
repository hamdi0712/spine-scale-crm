// The month, each day tinted by how much of it was completed.
//
// One component for both places it is drawn: the compact widget on the
// dashboard and the full page at /monk-mode/calendar, which is the same grid
// with larger squares and a legend. A second implementation would be a second
// set of rules about what a half-finished day looks like.
//
// The tint is the day's weighted completion — four of five prayers is four of
// the eleven things the day asked for, not a seventh of the work — so a
// half-done day is visibly half done rather than being rounded into a miss.
// Days before the challenge started, and days after it ends, are outside it
// and carry no tint at all: they are not failures, they are not days this is
// about.

import Link from "next/link";
import { MonkDayCell, MonkMonth, MONK_WEEKDAY_LABELS } from "@/lib/monkMode";

export default function MonkCalendarGrid({
  month,
  size = "compact",
  // Where a day links to, if anywhere. The dashboard's widget is a readout and
  // passes nothing; the calendar page hands each square a link into the
  // journal for that day.
  hrefFor,
}: {
  month: MonkMonth;
  size?: "compact" | "full";
  hrefFor?: (cell: MonkDayCell) => string | null;
}) {
  const full = size === "full";
  // A fixed circle centred in its column rather than a mark stretched to the
  // column's width: at full size the columns are a hundred pixels wide and a
  // stretched day reads as a pill, which is a different object from the dots
  // and rings the rest of the feature marks a day with.
  // The compact size is deliberately small. Six rows of it are the tallest
  // thing in the dashboard's row of four panels, and every pixel it gives back
  // is a pixel the page keeps above the fold.
  const cellClass = full ? "h-10 w-10 text-sm" : "h-7 w-7 text-[11px]";

  return (
    <div>
      <div className="grid grid-cols-7 gap-1">
        {MONK_WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="pb-1 text-center text-[11px] font-medium text-muted"
          >
            {full ? label : label.slice(0, 1)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {month.cells.map((cell, i) => {
          const href = hrefFor?.(cell) ?? null;
          const inner = (
            <DaySquare
              cell={cell}
              inMonth={month.inMonth[i]}
              className={cellClass}
            />
          );
          return href ? (
            <Link
              key={cell.key}
              href={href}
              className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              {inner}
            </Link>
          ) : (
            <div key={cell.key}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}

function DaySquare({
  cell,
  inMonth,
  className,
}: {
  cell: MonkDayCell;
  inMonth: boolean;
  className: string;
}) {
  const outside = cell.dayNumber === null;
  const pct = Math.round(cell.completion * 100);

  // Four states, in the order they are decided. A day outside the challenge is
  // plain whatever happened on it; a complete day is solid green; a day with
  // something on it is that green at the strength it earned; a lived day with
  // nothing on it is the muted wash, which is the only state that means
  // "missed".
  let tone = "text-muted/60";
  let style: React.CSSProperties | undefined;
  if (outside || !cell.past) {
    tone = "text-muted/50";
  } else if (cell.complete) {
    tone = "bg-ok text-white font-medium";
  } else if (pct > 0) {
    tone = "text-ink";
    // An inline alpha rather than one of a handful of Tailwind steps: the
    // value is a continuous fraction and the grid reads better for showing it
    // as one. Floored at a fifth so a day with one thing done is still visibly
    // tinted rather than indistinguishable from an empty one.
    style = {
      backgroundColor: `rgb(var(--c-ok) / ${Math.max(cell.completion, 0.2).toFixed(2)})`,
    };
  } else {
    tone = "bg-wash text-muted";
  }

  return (
    <div
      title={
        outside
          ? undefined
          : `Day ${cell.dayNumber} · ${cell.past ? `${pct}% complete` : "still to come"}`
      }
      style={style}
      className={`mx-auto flex items-center justify-center rounded-full ${className} ${tone} ${
        inMonth ? "" : "opacity-40"
      } ${
        // Today gets a ring rather than a fill, so it can be marked whatever
        // state it is in without that mark being mistaken for progress.
        cell.isToday ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""
      }`}
    >
      <span className="num">{cell.label}</span>
    </div>
  );
}

// The key to the tints, for the calendar page. Not drawn on the dashboard's
// compact widget, where there is no room for it and the panels either side
// already say what green means.
export function MonkCalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-ok" aria-hidden />
        All habits done
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-ok/40" aria-hidden />
        Partly done
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-wash" aria-hidden />
        Missed
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-3 w-3 rounded-full ring-2 ring-accent"
          aria-hidden
        />
        Today
      </span>
    </div>
  );
}
