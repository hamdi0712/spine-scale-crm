"use client";

// The four goals — two a day, two a month — as a plain form posting a server
// action, like every other settings-shaped form in the app.
//
// It is a client component for the reason the pipeline settings form is one:
// the save bar should say whether what is on screen has been saved, which
// needs the draft. Nothing else here is clever — four numbers, and the
// promise that changing one changes what today is measured against and never
// what happened.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  DAILY_KPI_BLURBS,
  DAILY_KPI_GOAL_MAX,
  DAILY_KPI_KEYS,
  DAILY_KPI_LABELS,
  DEFAULT_DAILY_KPI_GOALS,
  DailyKpiGoals,
  isMonthly,
} from "@/lib/dailyKpi";

export default function DailyKpiGoalsForm({
  goals,
  save,
}: {
  goals: DailyKpiGoals;
  save: (formData: FormData) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DailyKpiGoals>(goals);

  return (
    <form action={save} className="card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-xl font-semibold">Goals</h2>
          <p className="mt-1 text-sm text-muted">
            What a full day looks like for the work you control, and a full
            month for the answers it earns. A goal of 0 takes a metric out of
            the score and the streak without taking it off the page.
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {DAILY_KPI_KEYS.map((key) => (
          <div key={key}>
            <label className="field-label" htmlFor={`${key}Goal`}>
              {DAILY_KPI_LABELS[key]}
              {/* The timeframe rides on the field, because a bare number in a
                  box is the one place the difference between ten a day and ten
                  a month is invisible. */}
              <span className="ml-1.5 font-normal normal-case text-muted/80">
                {isMonthly(key) ? "per month" : "per day"}
              </span>
            </label>
            <input
              id={`${key}Goal`}
              name={`${key}Goal`}
              type="number"
              min={0}
              max={DAILY_KPI_GOAL_MAX}
              step={1}
              inputMode="numeric"
              value={draft[key]}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  // Emptying the field reads as zero rather than as nothing:
                  // the form always holds four numbers, and 0 is a real goal.
                  [key]: Number.isFinite(e.target.valueAsNumber)
                    ? e.target.valueAsNumber
                    : 0,
                }))
              }
              className="field num"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              {DAILY_KPI_BLURBS[key]}
            </p>
          </div>
        ))}
      </div>

      <SaveBar
        draft={draft}
        stored={goals}
        onReset={() => setDraft({ ...DEFAULT_DAILY_KPI_GOALS })}
      />
    </form>
  );
}

// Save, and the way back. Reset fills the form with the defaults rather than
// saving them — nothing changes until Save, the same promise the pipeline
// settings form makes.
function SaveBar({
  draft,
  stored,
  onReset,
}: {
  draft: DailyKpiGoals;
  stored: DailyKpiGoals;
  onReset: () => void;
}) {
  const { pending } = useFormStatus();
  const changed = JSON.stringify(draft) !== JSON.stringify(stored);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line/60 pt-6">
      <button
        type="submit"
        disabled={pending}
        className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save goals"}
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={pending}
        className="btn disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reset to defaults
      </button>
      <p className="text-xs leading-relaxed text-muted">
        {changed
          ? "Unsaved changes — the page is still measured against the saved goals."
          : "Saved. Every day and month on this page is measured against these."}
      </p>
    </div>
  );
}
