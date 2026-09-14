// The challenge banner: the title, the day counter, the bar, and the day's
// quotation over a photograph.
//
// The one dark surface in Monk Mode, and it is dark in both themes — see
// .monk-hero in globals.css for why a photograph is not a token, and for how
// the gradient underneath it stands in when the image is not there.
//
// The quote is streamed in separately (MonkQuoteLine below is suspended by the
// page), because the first load of a new day pays for a model call and the
// banner should not wait behind a quotation.

import { Suspense } from "react";
import {
  ChallengeProgress,
  MonkChallenge,
  MonkHabit,
  MonkProgressMap,
  monkDateRange,
} from "@/lib/monkMode";
import MonkQuoteLine, { MonkQuoteLineFallback } from "@/components/MonkQuoteLine";

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
  // Days behind the counter over the total. Day 1 is an empty bar rather than
  // a twenty-first of one: nothing has been completed by the morning of the
  // first day, and a bar that starts part-filled is flattering rather than
  // informative.
  const pct = Math.round((shape.elapsed / shape.total) * 100);

  return (
    <section className="monk-hero p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1 basis-64">
          <div className="text-[11px] font-medium tracking-[0.14em] text-white/60">
            MONK MODE
          </div>
          <h2 className="display mt-2 text-[34px] font-semibold leading-tight text-white">
            {shape.total} Day Challenge
          </h2>
          <p className="mt-1 text-sm text-white/70">
            Discipline today. Freedom tomorrow.
          </p>

          <div className="mt-6 flex max-w-md items-center gap-3">
            <div className="monk-hero-track h-2 flex-1 overflow-hidden rounded-full">
              <div
                className="monk-hero-fill h-full rounded-full transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="num shrink-0 text-xs font-medium text-white/80">
              {shape.day} / {shape.total} days
            </span>
          </div>
          <p className="num mt-2 text-xs text-white/55">
            {monkDateRange(shape.start, shape.end)}
            {!shape.started && " · starts soon"}
            {shape.finished && " · finished"}
          </p>
        </div>

        {/* The quotation, right-aligned on a wide banner and under the counter
            on a narrow one. Left-aligned when it wraps, because a right-ragged
            three-line quotation is harder to read than the alignment is worth. */}
        <div className="min-w-0 basis-72 sm:max-w-sm sm:text-right">
          <Suspense fallback={<MonkQuoteLineFallback />}>
            <MonkQuoteLine
              challenge={challenge}
              habits={habits}
              progress={progress}
              now={now}
            />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
