// The day's tally, beside the checklist.
//
// Eight counts, all read off the records rather than typed. Drawn as a plain
// grid of tiles rather than as KpiCards: those four are the dashboard's
// headline row and carry a tinted disc and a delta each, which at eight
// would be a wall of decoration around some very small numbers. This is the
// same card shell with the app's numeric type scale in it.
//
// A zero is drawn muted rather than hidden. "Nothing yet today" is the most
// useful thing this panel says at nine in the morning, and a blank tile would
// say it less clearly than a nought.

import { DailyNumber } from "@/lib/dailyNumbers";

export default function DailyNumbers({
  numbers,
  dayLabel,
  isToday,
}: {
  numbers: DailyNumber[];
  dayLabel: string;
  isToday: boolean;
}) {
  return (
    <div className="card">
      <div className="border-b border-line/60 px-6 py-4">
        <h3 className="text-sm font-medium">
          {isToday ? "Today’s numbers" : `Numbers for ${dayLabel}`}
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Counted off the records{isToday ? " for today" : ""} — nothing here is
          entered by hand.
        </p>
      </div>
      {/* Separators are the grid's own gap showing the line colour through,
          rather than a border on each tile: the number of columns changes with
          the breakpoint, and per-tile borders would need a different set of
          nth-child exceptions for every one of them. */}
      <div className="grid grid-cols-2 gap-px bg-line/60 sm:grid-cols-4">
        {numbers.map((n) => (
          <div key={n.label} className="bg-surface px-5 py-4">
            <div className="text-xs font-medium tracking-[0.02em] text-muted">
              {n.label}
            </div>
            <div
              className={`num mt-1.5 text-2xl font-semibold leading-none tracking-[-0.02em] ${
                n.value === 0 ? "text-muted" : "text-ink"
              }`}
            >
              {n.value}
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-muted">
              {n.source}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
