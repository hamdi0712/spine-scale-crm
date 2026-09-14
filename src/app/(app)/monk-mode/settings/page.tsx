// Monk Mode's own settings: the habit list, and the challenge's dates.
//
// Under /monk-mode rather than in the app's /settings area, and deliberately.
// Everything under /settings changes how the app runs — the keys it calls out
// with, the chain it runs, what the copilot is told about the business — and
// this changes what one person's twenty-one days consist of. It is part of the
// feature, not part of the app's configuration, and it lives with the feature.

import Link from "next/link";
import { IconChevronLeft } from "@tabler/icons-react";
import { loadChallenge, loadHabits } from "@/lib/monkModeStore";
import {
  MAX_DURATION_DAYS,
  MIN_DURATION_DAYS,
  challengeProgress,
  dayKey,
  monkDateRange,
  toChecklistDay,
} from "@/lib/monkMode";
import {
  restartMonkChallenge,
  updateMonkChallenge,
} from "@/lib/actions/monkMode";
import MonkHabitSettings from "@/components/MonkHabitSettings";

export const dynamic = "force-dynamic";

export default async function MonkSettingsPage() {
  const now = new Date();
  const [challenge, habits] = await Promise.all([
    loadChallenge(now),
    loadHabits(),
  ]);
  const shape = challengeProgress(challenge, now);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link
          href="/monk-mode"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
        >
          <IconChevronLeft size={14} stroke={1.75} aria-hidden />
          Back to Monk Mode
        </Link>
        <h1 className="display text-[32px] font-semibold">Monk Mode settings</h1>
        <p className="mt-1.5 text-sm text-muted">
          Your habits, and the dates the challenge runs between
        </p>
      </div>

      <section className="card mb-6 p-6">
        <h2 className="display text-xl font-semibold">The challenge</h2>
        <p className="num mt-0.5 text-xs text-muted">
          {monkDateRange(shape.start, shape.end)} · day {shape.day} of{" "}
          {shape.total}
        </p>

        <form
          action={updateMonkChallenge.bind(null, challenge.id)}
          className="mt-4 grid gap-4 sm:grid-cols-2"
        >
          <div>
            <label className="field-label" htmlFor="startDate">
              Start date
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={dayKey(toChecklistDay(challenge.startDate))}
              className="field num"
            />
            {/* Moving the start is the one place rewriting the past is right:
                the completions are filed under real days, so this only changes
                which of them the challenge counts. */}
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Day 1 is this date. Move it back if you started before you set
              this up — the days you logged are already there.
            </p>
          </div>
          <div>
            <label className="field-label" htmlFor="durationDays">
              Length, in days
            </label>
            <input
              id="durationDays"
              name="durationDays"
              type="number"
              min={MIN_DURATION_DAYS}
              max={MAX_DURATION_DAYS}
              required
              defaultValue={challenge.durationDays}
              className="field num"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              21 by default. Between {MIN_DURATION_DAYS} and{" "}
              {MAX_DURATION_DAYS}.
            </p>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary">
              Save challenge
            </button>
          </div>
        </form>
      </section>

      {/* Starting again is a new challenge rather than an edit of this one, so
          the run that just finished stays on the record. The habits carry
          over, which is the point of running it again. Offered once the
          current one has finished, because starting a second challenge on day
          four of the first is almost certainly a misclick. */}
      {shape.finished && (
        <section className="card mb-6 p-6">
          <h2 className="display text-xl font-semibold">Go again</h2>
          <p className="mt-0.5 text-sm text-muted">
            Starts a fresh challenge today with the same habits. The one you
            just finished stays exactly as it is.
          </p>
          <form action={restartMonkChallenge} className="mt-4 flex items-end gap-3">
            <div>
              <label className="field-label" htmlFor="restartDuration">
                Length, in days
              </label>
              <input
                id="restartDuration"
                name="durationDays"
                type="number"
                min={MIN_DURATION_DAYS}
                max={MAX_DURATION_DAYS}
                defaultValue={challenge.durationDays}
                className="field num w-32"
              />
            </div>
            <button type="submit" className="btn">
              Start a new challenge
            </button>
          </form>
        </section>
      )}

      <MonkHabitSettings habits={habits} />
    </div>
  );
}
