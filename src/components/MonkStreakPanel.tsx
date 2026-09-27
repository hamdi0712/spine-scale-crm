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

import { IconFlame, IconStarFilled, IconTrophyFilled } from "@tabler/icons-react";
import { MonkDayCell, MonkStreaks, monkStreakTier } from "@/lib/monkMode";
import { MonkForestStrip } from "@/components/MonkArt";
import MonkBadge from "@/components/MonkBadge";
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
  // What the run has earned, as a word. Four tiers rather than a number
  // repeated in a pill: the figure below already says how many days it is, and
  // a badge that says "4" beside a "4" is not telling anybody anything.
  const tier = monkStreakTier(streaks.current);
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
        {/* Pushed to the far corner: this is the card's status, and a status
            belongs at the edge rather than trailing the heading like a
            subtitle. Gold at every tier now, with the mark carrying the
            difference — a star while the run is being built, a trophy once it
            is a result. */}
        <MonkBadge
          label={tier.label}
          tone={tier.tone}
          glow
          icon={
            tier.trophy ? (
              <IconTrophyFilled size={11} aria-hidden />
            ) : (
              <IconStarFilled size={11} aria-hidden />
            )
          }
          className="ml-auto"
        />
      </div>

      {/* items-center, not items-baseline. Sitting on the baseline, "days in a
          row" hung off the foot of a forty-pixel numeral and read as a
          footnote to it; centred, the two are one phrase. */}
      <div className="mt-3.5 flex items-center gap-2">
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

          Pulled up under the counter rather than centred in the card's spare
          height. The dots belong to the number — they are the last seven days
          of the run it is counting — and floating them in the middle of the
          panel made them read as a separate thing. The slack goes below them
          instead, which is where the treeline now stands. */}
      {/* The dots, and under them the slack the treeline stands in. One
          container for both: it takes whatever height the row of panels
          settles on, the dots sit at its top, and the ridgeline is anchored to
          its bottom — which is exactly the rule above the two figures. The
          strip used to be positioned against the card with a hand-computed
          offset, and it was twenty pixels of card padding wrong, sitting over
          "best streak" where the image is dark enough to show it. */}
      {/* On a phone the panel is not stretched to a row of four, so the
          slack the treeline stands in is given a floor of its own — without it
          the 116px strip rises over the dots and the counter above them. */}
      <div className="relative mt-3 flex-1 max-md:min-h-[150px]">
        <div className="flex w-full items-start justify-between gap-1">
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
        <MonkForestStrip />
      </div>

      <dl className="relative space-y-2 border-t border-line/60 pt-3">
        <Stat
          label="Best streak"
          value={`${streaks.best} days`}
          // The trophy marks the record rather than the current run — it is
          // the one figure on the panel that is an achievement rather than a
          // status, and it only appears once there is a record worth the word.
          icon={
            streaks.best >= 3 ? (
              <IconTrophyFilled size={12} className="text-warn" aria-hidden />
            ) : undefined
          }
        />
        <Stat label="Perfect days" value={`${perfectDays} of ${daysLived}`} />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {value}
      </dd>
    </div>
  );
}
