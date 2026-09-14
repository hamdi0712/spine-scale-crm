// This week: one bar per day, drawn to how much of that day was completed.
//
// CSS rather than a charting library. Seven bars with a percentage each is a
// shape, not a chart — there is no axis, no tooltip and no scale to get right
// — and a div with a height is the whole of it. Recharts is kept for the
// donut, where the geometry actually earns it.
//
// A day that has not happened yet is drawn as an empty track with no figure
// over it: a Sunday at 0% read on a Wednesday is not a fact about anybody.
// Days outside the challenge are drawn the same way, for the same reason.

import { MonkWeekBar } from "@/lib/monkMode";

export default function MonkWeekBars({ bars }: { bars: MonkWeekBar[] }) {
  return (
    <div className="flex items-end justify-between gap-2">
      {bars.map((bar) => {
        const blank = bar.future || !bar.inChallenge;
        return (
          <div key={bar.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <span
              className={`num text-[11px] ${
                bar.isToday ? "font-semibold text-ink" : "text-muted"
              }`}
            >
              {blank ? "–" : `${bar.pct}%`}
            </span>
            {/* A fixed-height track with the fill grown from the bottom, so
                seven bars share one baseline and the row reads as a week
                rather than as seven independent boxes. */}
            <div className="flex h-[72px] w-full items-end overflow-hidden rounded-[8px] bg-wash">
              {!blank && (
                <div
                  className={`w-full rounded-[8px] transition-[height] ${
                    bar.pct >= 100 ? "bg-ok" : "bg-ok/55"
                  }`}
                  // A completed day fills the track; a day with nothing on it
                  // keeps a sliver so the bar is visibly a bar at zero rather
                  // than an empty slot indistinguishable from a future day.
                  style={{ height: `${Math.max(bar.pct, 3)}%` }}
                />
              )}
            </div>
            <span
              className={`text-[11px] ${
                bar.isToday ? "font-semibold text-ink" : "text-muted"
              }`}
            >
              {bar.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
