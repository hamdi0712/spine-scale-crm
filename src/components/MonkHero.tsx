// The challenge banner: what this is, how far through it you are, and the
// day's quotation over a photograph.
//
// The one dark surface in Monk Mode, and it is dark in both themes — see
// .monk-hero in globals.css for why a photograph is not a token, and for how
// the gradient underneath it stands in when the image is not there.
//
// The bar across the bottom is a tick per day rather than a filled percentage,
// and each tick is coloured by what actually happened on its day: solid for a
// day where every habit hit its target, half-lit for a day partly done, bare
// for one that was missed, faint for one still to come. A progress bar would
// have said the same thing every morning at the same time whatever the person
// did — this says how the run is going, which is the only reason to look at a
// bar on a discipline tracker. Above about a month the ticks stop being
// legible and it falls back to a plain bar; see DAY_TICK_LIMIT.
//
// The quote is streamed in separately (the page suspends MonkQuoteLine),
// because the first load of a new day pays for a model call and the banner
// should not wait behind a quotation.

import { Suspense } from "react";
import {
  ChallengeProgress,
  MonkChallenge,
  MonkDayCell,
  MonkHabit,
  MonkProgressMap,
  monkChallengeCells,
  monkDateRange,
} from "@/lib/monkMode";
import MonkQuoteLine, { MonkQuoteLineFallback } from "@/components/MonkQuoteLine";

// The longest challenge still drawn as individual days. Twenty-one ticks in a
// banner are a row you can count; three hundred are a texture.
const DAY_TICK_LIMIT = 40;

export default function MonkHero({
  challenge,
  habits,
  progress,
  shape,
  now,
}: {
  challenge: MonkChallenge;
  habits: MonkHabit[];
  progress: MonkProgressMap;
  shape: ChallengeProgress;
  now: Date;
}) {
  const cells = monkChallengeCells(challenge, habits, progress, now);

  return (
    <section className="monk-hero flex flex-wrap items-end gap-x-8 gap-y-5 px-6 py-[18px]">
      <div className="min-w-0 flex-1 basis-80">
        <div className="flex items-baseline gap-3">
          <h2 className="display text-[27px] font-semibold leading-none text-white">
            {shape.total} Day Challenge
          </h2>
          <span className="text-[11px] font-medium tracking-[0.14em] text-white/45">
            MONK MODE
          </span>
        </div>

        {/* The day counter and the range on one line, the counter carrying the
            weight. "Day 3" is the fact; "of 21" and the dates are the context
            it sits in, and they are sized as such. */}
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-[15px] font-semibold text-white">
            Day {shape.day}
            <span className="font-normal text-white/50"> of {shape.total}</span>
          </span>
          <span className="num text-xs text-white/45">
            {monkDateRange(shape.start, shape.end)}
            {!shape.started && " · not started"}
            {shape.finished && " · finished"}
          </span>
        </div>

        <div className="mt-2.5">
          {shape.total <= DAY_TICK_LIMIT ? (
            <DayTicks cells={cells} />
          ) : (
            <PlainBar shape={shape} />
          )}
        </div>
      </div>

      {/* The quotation. Right-aligned on a wide banner and under the counter on
          a narrow one — left-aligned when it wraps, because a right-ragged
          three-line quotation is harder to read than the alignment is worth. */}
      <div className="min-w-0 basis-72 sm:max-w-xs sm:text-right">
        <Suspense fallback={<MonkQuoteLineFallback />}>
          <MonkQuoteLine
            challenge={challenge}
            habits={habits}
            progress={progress}
            now={now}
          />
        </Suspense>
      </div>
    </section>
  );
}

// One tick per day of the challenge.
//
// White at four strengths rather than the app's green and grey: the ground
// behind this is a photograph in both themes, and the tokens that follow the
// theme would be wrong over one of them. Today is the one tick drawn as an
// outline, so it is marked without that mark being mistaken for progress.
function DayTicks({ cells }: { cells: MonkDayCell[] }) {
  return (
    <div className="flex items-end gap-[3px]" aria-hidden>
      {cells.map((cell) => {
        // The alphas are set high because the ground under them is a
        // photograph at dusk: white at a tenth reads as black on this panel,
        // and a tick nobody can see is a day the row is not reporting. The
        // floor is what a day still to come looks like, and it has to be
        // visible as an empty slot — the row's length is the challenge.
        const height = cell.complete ? "h-2.5" : "h-2";
        let tone = "bg-white/25";
        if (cell.isToday) tone = "bg-white/40 ring-[1.5px] ring-white";
        else if (cell.complete) tone = "bg-white/95";
        else if (cell.past && cell.completion > 0) tone = "bg-white/60";
        else if (cell.past) tone = "bg-white/25";
        return (
          <span
            key={cell.key}
            title={`Day ${cell.dayNumber} · ${Math.round(cell.completion * 100)}%`}
            className={`flex-1 rounded-full ${height} ${tone}`}
          />
        );
      })}
    </div>
  );
}

// The fallback for a long challenge: days elapsed over the total, as one bar.
function PlainBar({ shape }: { shape: ChallengeProgress }) {
  const pct = Math.round((shape.elapsed / shape.total) * 100);
  return (
    <div className="monk-hero-track h-2 overflow-hidden rounded-full">
      <div
        className="monk-hero-fill h-full rounded-full transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
