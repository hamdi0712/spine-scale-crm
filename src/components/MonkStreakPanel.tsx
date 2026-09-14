// The streak: the run of days on which every habit hit its target, the best
// run so far, and the last seven days as a row of dots.
//
// "Every habit" is the whole of the definition and it is deliberately strict —
// a streak that survived a missed habit would be a streak of having mostly
// shown up, which is a different and much easier thing to keep. Today is
// counted once it is complete and never counted against: see monkStreaks.

import { IconFlame } from "@tabler/icons-react";
import { MonkDayCell, MonkStreaks } from "@/lib/monkMode";
import { CheckDot } from "@/components/MonkHabitGrid";

export default function MonkStreakPanel({
  streaks,
  row,
}: {
  streaks: MonkStreaks;
  row: MonkDayCell[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <IconFlame
          size={18}
          stroke={1.75}
          className={streaks.current > 0 ? "text-warn" : "text-muted"}
          aria-hidden
        />
        <h2 className="display text-xl font-semibold">Streak</h2>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        {/* The current run, with a rule at its left edge in the same warn hue
            as the flame — the figure is the loudest thing in the panel and the
            rule is what marks it as the one being reported. */}
        <div
          className={`border-l-2 pl-3 ${
            streaks.current > 0 ? "border-warn" : "border-line"
          }`}
        >
          <div className="num text-[30px] font-semibold leading-none tracking-tight">
            {streaks.current}{" "}
            <span className="text-[15px] font-medium">
              {streaks.current === 1 ? "day" : "days"}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-muted">Current streak</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Best streak</div>
          <div className="num mt-1 text-[15px] font-semibold">
            {streaks.best} {streaks.best === 1 ? "day" : "days"}
          </div>
        </div>
      </div>

      {/* The last seven days of the challenge, labelled by their day number
          rather than by weekday: this row is about the challenge's own clock,
          and D1–D7 is how the banner counts. A day still to come is drawn as an
          open ring, the same mark as a day that was missed — the difference is
          in the label under it and in the fact that one of them is today. */}
      <div className="mt-5 flex items-start justify-between gap-1 border-t border-line/60 pt-4">
        {row.map((cell) => (
          <div key={cell.key} className="flex flex-col items-center gap-1.5">
            <CheckDot filled={cell.complete} missed={cell.past} size={22} />
            <span
              className={`num text-[11px] ${
                cell.isToday ? "font-semibold text-ink" : "text-muted"
              }`}
            >
              {cell.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
