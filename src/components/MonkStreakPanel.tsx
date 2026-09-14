// The run: the current streak, the last seven days as dots, and the two
// figures that put the streak in context.
//
// A streak is the number people actually check, so it is the largest thing on
// the panel. "Every habit hit its target" is the whole of the definition and
// it is deliberately strict — a streak that survived a missed habit would be a
// streak of having mostly shown up, which is a different and much easier thing
// to keep. Today is counted once it is complete and never counted against: see
// monkStreaks.
//
// The two stats under the rule are what the panel used to need a second card
// for. A streak alone says nothing about whether a run of zero is a bad week
// or a first morning; "3 of 12 perfect" does.

import { IconFlame } from "@tabler/icons-react";
import { MonkDayCell, MonkStreaks } from "@/lib/monkMode";
import { CheckDot } from "@/components/MonkHabitGrid";

export default function MonkStreakPanel({
  streaks,
  row,
  perfectDays,
  daysLived,
}: {
  streaks: MonkStreaks;
  row: MonkDayCell[];
  perfectDays: number;
  daysLived: number;
}) {
  const live = streaks.current > 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2">
        <IconFlame
          size={17}
          stroke={1.75}
          className={live ? "text-warn" : "text-muted"}
          aria-hidden
        />
        <h2 className="display text-base font-semibold">Streak</h2>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span
          className={`num text-[40px] font-semibold leading-none tracking-tight ${
            live ? "text-ink" : "text-muted"
          }`}
        >
          {streaks.current}
        </span>
        <span className="text-sm text-muted">
          {streaks.current === 1 ? "day" : "days"} in a row
        </span>
      </div>

      {/* The last seven days of the challenge, labelled by day number rather
          than weekday: this row is about the challenge's own clock, and D1–D7
          is how the banner counts.

          Centred in whatever height the row of panels settles on, rather than
          pinned under the streak with the slack falling below it — this panel
          is the shortest of the four and the gap was showing. */}
      <div className="flex flex-1 items-center">
        <div className="flex w-full items-start justify-between gap-1 py-4">
        {row.map((cell) => (
          <div key={cell.key} className="flex flex-col items-center gap-1.5">
            <CheckDot filled={cell.complete} missed={cell.past} size={20} />
            <span
              className={`num text-[10px] ${
                cell.isToday ? "font-semibold text-ink" : "text-muted"
              }`}
            >
              {cell.label}
            </span>
          </div>
        ))}
        </div>
      </div>

      <dl className="space-y-2 border-t border-line/60 pt-3">
        <Stat label="Best streak" value={`${streaks.best} days`} />
        <Stat label="Perfect days" value={`${perfectDays} of ${daysLived}`} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-xs font-medium">{value}</dd>
    </div>
  );
}
