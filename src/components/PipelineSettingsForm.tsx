"use client";

// Pipeline Settings — the five steps, and the bar.
//
// A plain form posting a server action, like every other settings-shaped form
// in the app. It is a client component for one reason: an actor ID typed into
// a field should be told it is malformed before Save rather than silently
// falling back to the default afterwards, and the threshold should show what
// it means as it is dragged rather than after a round trip.
//
// Nothing here is clever about what a step does. The toggles say whether a
// step runs, the fields say what it runs, and the one number says where the
// promotion bar sits — the reasoning behind all three stays in the code the
// page links to.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { normalizeApifyId } from "@/lib/apifyId";
import {
  DEFAULT_ACTOR_IDS,
  DEFAULT_PIPELINE_SETTINGS,
  DEFAULT_PROMOTION_THRESHOLD,
  MAX_PROMOTION_THRESHOLD,
  MIN_PROMOTION_THRESHOLD,
  PIPELINE_STEP_BLURBS,
  PIPELINE_STEP_KEYS,
  PIPELINE_STEP_LABELS,
  PIPELINE_STEP_RATES,
  PipelineSettings,
  PipelineStepKey,
  costPerCandidate,
  fmtEstimate,
  stepCostPerCandidate,
} from "@/lib/pipelineSettings";
import { ICP_MAX_SCORE, ICP_TIER_BANDS, tierForScore } from "@/lib/icp";

export default function PipelineSettingsForm({
  settings,
  save,
}: {
  settings: PipelineSettings;
  save: (formData: FormData) => Promise<void>;
}) {
  // The form is the state, so the estimate and the warnings can be worked out
  // from what is on screen rather than from what was last saved. Seeded from
  // the stored row, which is what the fields are filled with.
  const [draft, setDraft] = useState<PipelineSettings>(settings);

  function setStep(key: PipelineStepKey, patch: Partial<{ enabled: boolean; actorId: string }>) {
    setDraft((prev) => ({
      ...prev,
      steps: { ...prev.steps, [key]: { ...prev.steps[key], ...patch } },
    }));
  }

  const enabledCount = PIPELINE_STEP_KEYS.filter(
    (k) => draft.steps[k].enabled,
  ).length;

  return (
    <form action={save} className="space-y-8">
      {/* ─── The five steps ──────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="display text-xl font-semibold">Enrichment chain</h2>
            <p className="mt-1 text-sm text-muted">
              The steps every candidate goes through, in the order they run
            </p>
          </div>
          <p className="num text-xs text-muted">
            {enabledCount} of {PIPELINE_STEP_KEYS.length} on ·{" "}
            {fmtEstimate(costPerCandidate(draft))} per candidate
          </p>
        </div>

        <ul className="card divide-y divide-line/60">
          {PIPELINE_STEP_KEYS.map((key) => (
            <StepRow
              key={key}
              stepKey={key}
              step={draft.steps[key]}
              onChange={(patch) => setStep(key, patch)}
            />
          ))}
        </ul>

        {enabledCount === 0 && (
          <div className="mt-3 rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
            <p className="text-sm font-medium text-ink">
              Every step is off
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              The queue will still run, and every candidate it picks up will
              fail with nothing gathered to score on. That is the honest
              outcome rather than a blocked button — but it is almost certainly
              not what you meant.
            </p>
          </div>
        )}
      </section>

      {/* ─── The bar ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="display mb-1 text-xl font-semibold">Promotion threshold</h2>
        <p className="mb-4 text-sm text-muted">
          The score a candidate has to reach to become a lead
        </p>
        <div className="card p-6">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="field-label" htmlFor="promotionThreshold">
                Minimum score, out of {ICP_MAX_SCORE}
              </label>
              <input
                id="promotionThreshold"
                name="promotionThreshold"
                type="number"
                inputMode="numeric"
                min={MIN_PROMOTION_THRESHOLD}
                max={MAX_PROMOTION_THRESHOLD}
                step={1}
                value={draft.promotionThreshold}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    // Kept as typed while typing — a field that snapped to a
                    // valid number on every keystroke cannot be cleared and
                    // retyped. The server clamps what actually arrives.
                    promotionThreshold: e.target.value === ""
                      ? ("" as unknown as number)
                      : Number(e.target.value),
                  }))
                }
                className="field num w-[120px]"
              />
            </div>
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
              {thresholdMeaning(draft.promotionThreshold)}
            </p>
          </div>
          <p className="mt-4 border-t border-line/60 pt-4 text-xs leading-relaxed text-muted">
            This is the promotion bar, not the tier bands. A candidate is still
            scored and tiered by the framework —{" "}
            <span className="num">{ICP_TIER_BANDS}</span> — and a hard
            disqualifier still stops one whatever this is set to. Changing it
            affects candidates processed from now on; nothing already scored is
            re-judged.
          </p>
        </div>
      </section>

      <SaveBar draft={draft} stored={settings} onReset={() => setDraft(DEFAULT_PIPELINE_SETTINGS)} />
    </form>
  );
}

// One step: what it is, whether it runs, and which actor it runs.
function StepRow({
  stepKey,
  step,
  onChange,
}: {
  stepKey: PipelineStepKey;
  step: { enabled: boolean; actorId: string };
  onChange: (patch: Partial<{ enabled: boolean; actorId: string }>) => void;
}) {
  const rate = PIPELINE_STEP_RATES[stepKey];
  const typed = step.actorId.trim();
  // Empty is not an error — it is the field saying "use the default", which is
  // exactly what the server will do with it. A malformed ID is an error worth
  // showing, because the fallback is silent and would look like the actor ran.
  const malformed = typed !== "" && normalizeApifyId(typed) === null;
  const isDefault = normalizeApifyId(typed) === DEFAULT_ACTOR_IDS[stepKey];

  return (
    <li className={`p-6 ${step.enabled ? "" : "bg-wash/40"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{PIPELINE_STEP_LABELS[stepKey]}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {PIPELINE_STEP_BLURBS[stepKey]}
          </p>
        </div>
        <Toggle
          name={`${stepKey}Enabled`}
          checked={step.enabled}
          onChange={(enabled) => onChange({ enabled })}
          label={`${PIPELINE_STEP_LABELS[stepKey]} — ${step.enabled ? "on" : "off"}`}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label className="field-label" htmlFor={`${stepKey}ActorId`}>
            Apify actor
          </label>
          <input
            id={`${stepKey}ActorId`}
            name={`${stepKey}ActorId`}
            value={step.actorId}
            onChange={(e) => onChange({ actorId: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            placeholder={DEFAULT_ACTOR_IDS[stepKey]}
            aria-invalid={malformed || undefined}
            className={`field font-mono text-xs ${
              malformed ? "border-bad focus:border-bad focus:ring-bad/15" : ""
            }`}
          />
        </div>
        <p className="num shrink-0 pb-2.5 text-xs text-muted">
          ~{fmtEstimate(stepCostPerCandidate(stepKey)).replace("~", "")} ·{" "}
          {rate.unitsPerCandidate} {rate.unit}
          {rate.unitsPerCandidate === 1 ? "" : "s"}
        </p>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        {malformed
          ? "That is not an actor ID. Use the 17-character ID or the username~name form shown in the Apify console — saving as it stands will keep the default instead."
          : typed === ""
            ? `Blank runs the default, ${DEFAULT_ACTOR_IDS[stepKey]}.`
            : isDefault
              ? "The actor this app ships with."
              : "Swapped from the default. A replacement has to return the same fields for its result to be read — see the note at the top of the page."}
      </p>
    </li>
  );
}

// The switch. Built rather than borrowed: the app has checkboxes and segmented
// controls but no toggle, and a row of five checkboxes reads as a filter
// rather than as five things being on. Same 42px-tall rhythm, same accent, and
// it is a real checkbox underneath so it posts and keys like one.
function Toggle({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2.5">
      <span className="text-xs font-medium text-muted">
        {checked ? "On" : "Off"}
      </span>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={`block h-[24px] w-[42px] rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30 ${
            checked ? "border-accent bg-accent" : "border-line bg-line/70"
          }`}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute top-[3px] h-[18px] w-[18px] rounded-full bg-surface shadow-sm transition-all ${
            checked ? "left-[21px]" : "left-[3px]"
          }`}
        />
      </span>
    </label>
  );
}

// What the number on screen actually means, in the app's own terms.
function thresholdMeaning(threshold: number): string {
  if (!Number.isFinite(threshold)) {
    return `Blank saves as ${DEFAULT_PROMOTION_THRESHOLD}, the default.`;
  }
  if (threshold <= MIN_PROMOTION_THRESHOLD) {
    return "Everything that clears the hard disqualifiers is promoted, whatever it scored. Discovery stops being a filter and becomes a queue.";
  }
  if (threshold >= MAX_PROMOTION_THRESHOLD) {
    return `Only a perfect ${MAX_PROMOTION_THRESHOLD}/${MAX_PROMOTION_THRESHOLD} is promoted. Expect almost everything to be rejected.`;
  }
  const tier = tierForScore(threshold);
  return `A candidate scoring ${threshold} or more becomes a lead; anything under it is rejected with its reasoning kept. ${threshold} is the bottom of ${tier}-tier.`;
}

// Save, and the way back. Reset fills the form with the defaults rather than
// saving them — nothing changes until Save, which is the same promise every
// other form in the app makes.
function SaveBar({
  draft,
  stored,
  onReset,
}: {
  draft: PipelineSettings;
  stored: PipelineSettings;
  onReset: () => void;
}) {
  const { pending } = useFormStatus();
  const changed = JSON.stringify(draft) !== JSON.stringify(stored);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line/60 pt-6">
      <button
        type="submit"
        disabled={pending}
        className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save settings"}
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
          ? "Unsaved changes — the chain runs as it did until you save."
          : "Saved. Every run from now on reads these."}
      </p>
    </div>
  );
}
