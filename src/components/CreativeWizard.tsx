"use client";

// The "new creative" wizard — four steps, run from a concept's detail page.
// Same shape as the concept wizard: state lives here, hidden inputs carry it,
// and one server action at the end creates the creative in Draft with its
// compliance checklist seeded.
//
// The concept's positioning rides along at the top of every step: the copy is
// being written to that awareness level, so it should not be off screen while
// writing it.

import { useState } from "react";
import {
  AD_HEADLINE_GUIDANCE,
  AD_HEADLINE_MAX,
  AD_HEADLINE_MIN,
  AWARENESS_LEVEL_GUIDANCE,
  AWARENESS_LEVEL_LABELS,
  AwarenessLevel,
  CONCEPT_HEADLINE_GUIDANCE,
  CREATIVE_TYPES,
  CREATIVE_TYPE_BLURBS,
  CREATIVE_TYPE_LABELS,
  CREATIVE_WIZARD_STEPS,
  CreativeType,
  sophisticationMeta,
} from "@/lib/adhub";
import WizardProgress from "@/components/WizardProgress";

export default function CreativeWizard({
  awarenessLevel,
  sophisticationStage,
  action,
}: {
  awarenessLevel: string;
  sophisticationStage: number;
  action: (formData: FormData) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [creativeType, setCreativeType] = useState<string>("PHOTO");
  const [conceptHeadline, setConceptHeadline] = useState("");
  const [adHeadline, setAdHeadline] = useState("");
  const [adCopy, setAdCopy] = useState("");
  const [cta, setCta] = useState("");

  const meta = CREATIVE_WIZARD_STEPS[step - 1];
  const last = step === CREATIVE_WIZARD_STEPS.length;
  const filled = (v: string) => v.trim() !== "";

  function stepComplete(n: number): boolean {
    switch (n) {
      case 1:
        return filled(creativeType);
      case 2:
        return filled(conceptHeadline) && filled(adHeadline);
      case 3:
        return filled(adCopy);
      case 4:
        return filled(cta);
      default:
        return false;
    }
  }

  const canContinue = stepComplete(step);
  const headlineLength = adHeadline.trim().length;
  const headlineInRange =
    headlineLength >= AD_HEADLINE_MIN && headlineLength <= AD_HEADLINE_MAX;

  const stage = sophisticationMeta(sophisticationStage);

  return (
    <form action={action}>
      <WizardProgress
        steps={CREATIVE_WIZARD_STEPS}
        current={step}
        note="Nothing is saved until the last step."
      />

      <input type="hidden" name="creativeType" value={creativeType} />
      <input type="hidden" name="conceptHeadline" value={conceptHeadline} />
      <input type="hidden" name="adHeadline" value={adHeadline} />
      <input type="hidden" name="adCopy" value={adCopy} />
      <input type="hidden" name="cta" value={cta} />

      <div className="card mt-6">
        <div className="border-b border-line/60 px-6 py-4">
          <h2 className="text-sm font-medium">
            <span className="num">{step}.</span> {meta.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {meta.blurb}
          </p>
        </div>

        <div className="border-b border-line/60 bg-wash/50 px-6 py-3">
          <p className="text-xs font-medium tracking-[0.02em] text-muted">
            Writing to
          </p>
          <p className="mt-1 text-sm">
            {AWARENESS_LEVEL_LABELS[awarenessLevel as AwarenessLevel] ??
              awarenessLevel}{" "}
            · {stage.label}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {AWARENESS_LEVEL_GUIDANCE[awarenessLevel as AwarenessLevel] ??
              stage.guidance}
          </p>
        </div>

        <div className="space-y-7 p-6">
          {step === 1 && (
            <div className="space-y-2" role="radiogroup">
              {CREATIVE_TYPES.map((type) => (
                <label
                  key={type}
                  className={`flex cursor-pointer items-start gap-3 rounded-[10px] border px-3.5 py-3 transition-colors ${
                    creativeType === type
                      ? "border-accent bg-accent/5"
                      : "border-line hover:bg-wash/70"
                  }`}
                >
                  <input
                    type="radio"
                    checked={creativeType === type}
                    onChange={() => setCreativeType(type)}
                    className="sr-only"
                  />
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      creativeType === type
                        ? "border-accent"
                        : "border-line bg-surface"
                    }`}
                  >
                    {creativeType === type && (
                      <span className="h-2 w-2 rounded-full bg-accent" />
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">
                      {CREATIVE_TYPE_LABELS[type as CreativeType]}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {CREATIVE_TYPE_BLURBS[type as CreativeType]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="field-label" htmlFor="cw-hook">
                  Concept headline (hook)
                </label>
                <textarea
                  id="cw-hook"
                  rows={2}
                  value={conceptHeadline}
                  onChange={(e) => setConceptHeadline(e.target.value)}
                  placeholder="The line on the creative itself"
                  className="field"
                />
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {CONCEPT_HEADLINE_GUIDANCE}
                </p>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <label className="field-label mb-0" htmlFor="cw-headline">
                    Ad headline
                  </label>
                  <span
                    className={`num shrink-0 text-xs ${
                      headlineLength === 0
                        ? "text-muted"
                        : headlineInRange
                          ? "text-ok"
                          : "text-warn"
                    }`}
                  >
                    {headlineLength} / {AD_HEADLINE_MIN}–{AD_HEADLINE_MAX}
                  </span>
                </div>
                <input
                  id="cw-headline"
                  value={adHeadline}
                  onChange={(e) => setAdHeadline(e.target.value)}
                  placeholder="The headline under the creative in the ad unit"
                  className="field mt-2"
                />
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {AD_HEADLINE_GUIDANCE}
                </p>
              </div>
            </>
          )}

          {step === 3 && (
            <div>
              <label className="field-label" htmlFor="cw-copy">
                Ad copy body
              </label>
              <textarea
                id="cw-copy"
                rows={12}
                value={adCopy}
                onChange={(e) => setAdCopy(e.target.value)}
                placeholder="The body copy, opening the way the awareness level above says it has to"
                className="field"
              />
            </div>
          )}

          {step === 4 && (
            <div>
              <label className="field-label" htmlFor="cw-cta">
                CTA
              </label>
              <input
                id="cw-cta"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Book your assessment"
                className="field"
              />
              <p className="mt-2 text-xs leading-relaxed text-muted">
                One ask. The creative is saved as a Draft — it cannot be marked
                Ready until the compliance checklist on its record is fully
                checked.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/60 px-6 py-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((n) => n - 1)}
              className="btn"
            >
              ← Back
            </button>
          ) : (
            <span />
          )}
          {last ? (
            <button
              type="submit"
              disabled={!canContinue}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create creative →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((n) => n + 1)}
              disabled={!canContinue}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
