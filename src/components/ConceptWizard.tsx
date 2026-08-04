"use client";

// The "new concept" wizard — five steps of structured manual entry, in the
// order the framework builds a concept: persona → desire → benefit →
// positioning → name.
//
// Nothing is written until the last step. Every step either points at an
// existing record or carries the fields for a new one, and the single server
// action at the end creates whichever of them are new — so abandoning the
// wizard half way leaves no orphaned personas or desires behind.
//
// The visible controls are unnamed and bound to state; one hidden input per
// field carries the state into the post. That way a step that is off screen
// still submits what was typed into it.

import { useMemo, useState } from "react";
import {
  AWARENESS_GUIDANCE_INTRO,
  AWARENESS_LEVELS,
  AWARENESS_LEVEL_GUIDANCE,
  AWARENESS_LEVEL_LABELS,
  AwarenessLevel,
  CONCEPT_WIZARD_STEPS,
  PERSONA_FIELDS,
  SOPHISTICATION_GUIDANCE_INTRO,
  SOPHISTICATION_STAGE_META,
} from "@/lib/adhub";
import WizardProgress from "@/components/WizardProgress";

export interface WizardPersona {
  id: string;
  name: string;
  demographics: string | null;
}

export interface WizardDesire {
  id: string;
  statement: string;
}

export interface WizardBenefit {
  id: string;
  desireId: string;
  productName: string;
  feature: string;
  benefit: string;
}

const NEW = ""; // the "write a new one" choice, in the same slot as an id

interface State {
  personaId: string;
  personaName: string;
  personaFields: Record<string, string>;
  desireId: string;
  desireStatement: string;
  desireNotes: string;
  benefitId: string;
  benefitProductName: string;
  benefitFeature: string;
  benefitBenefit: string;
  awarenessLevel: string;
  sophisticationStage: string;
  name: string;
  batchNumber: string;
  notes: string;
}

const EMPTY: State = {
  personaId: NEW,
  personaName: "",
  personaFields: {},
  desireId: NEW,
  desireStatement: "",
  desireNotes: "",
  benefitId: NEW,
  benefitProductName: "",
  benefitFeature: "",
  benefitBenefit: "",
  awarenessLevel: "",
  sophisticationStage: "",
  name: "",
  batchNumber: "1",
  notes: "",
};

export default function ConceptWizard({
  personas,
  desires,
  benefits,
  action,
}: {
  personas: WizardPersona[];
  desires: WizardDesire[];
  benefits: WizardBenefit[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [s, setS] = useState<State>(EMPTY);

  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  const meta = CONCEPT_WIZARD_STEPS[step - 1];

  const persona = personas.find((p) => p.id === s.personaId) ?? null;
  const desire = desires.find((d) => d.id === s.desireId) ?? null;

  // Benefits are offered against the chosen desire only — a benefit answers a
  // desire, so the ones belonging to another want are not candidates here. A
  // brand-new desire has none yet, which is why step 3 falls back to writing
  // one.
  const desireBenefits = useMemo(
    () => (desire ? benefits.filter((b) => b.desireId === desire.id) : []),
    [benefits, desire],
  );
  const benefit = desireBenefits.find((b) => b.id === s.benefitId) ?? null;

  const filled = (v: string) => v.trim() !== "";

  function stepComplete(n: number): boolean {
    switch (n) {
      case 1:
        return s.personaId !== NEW || filled(s.personaName);
      case 2:
        return s.desireId !== NEW || filled(s.desireStatement);
      case 3:
        return (
          (s.benefitId !== NEW && benefit != null) ||
          (s.benefitId === NEW &&
            filled(s.benefitProductName) &&
            filled(s.benefitFeature) &&
            filled(s.benefitBenefit))
        );
      case 4:
        return filled(s.awarenessLevel) && filled(s.sophisticationStage);
      case 5:
        return filled(s.name);
      default:
        return false;
    }
  }

  const canContinue = stepComplete(step);
  const last = step === CONCEPT_WIZARD_STEPS.length;

  // Choosing a different desire invalidates a benefit picked under the old
  // one, so the choice resets rather than silently pointing at the wrong want.
  function chooseDesire(id: string) {
    set({ desireId: id, benefitId: NEW });
  }

  return (
    <form action={action}>
      <WizardProgress
        steps={CONCEPT_WIZARD_STEPS}
        current={step}
        note="Nothing is saved until the last step."
      />

      {/* Every field, on every step, posted from state. */}
      <input type="hidden" name="personaId" value={s.personaId} />
      <input type="hidden" name="personaName" value={s.personaName} />
      {PERSONA_FIELDS.map((f) => (
        <input
          key={f.key}
          type="hidden"
          name={`persona_${f.key}`}
          value={s.personaFields[f.key] ?? ""}
        />
      ))}
      <input type="hidden" name="desireId" value={s.desireId} />
      <input type="hidden" name="desireStatement" value={s.desireStatement} />
      <input type="hidden" name="desireNotes" value={s.desireNotes} />
      <input type="hidden" name="benefitId" value={s.benefitId} />
      <input
        type="hidden"
        name="benefitProductName"
        value={s.benefitProductName}
      />
      <input type="hidden" name="benefitFeature" value={s.benefitFeature} />
      <input type="hidden" name="benefitBenefit" value={s.benefitBenefit} />
      <input type="hidden" name="awarenessLevel" value={s.awarenessLevel} />
      <input
        type="hidden"
        name="sophisticationStage"
        value={s.sophisticationStage}
      />
      <input type="hidden" name="name" value={s.name} />
      <input type="hidden" name="batchNumber" value={s.batchNumber} />
      <input type="hidden" name="notes" value={s.notes} />

      <div className="card mt-6">
        <div className="border-b border-line/60 px-6 py-4">
          <h2 className="text-sm font-medium">
            <span className="num">{step}.</span> {meta.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {meta.blurb}
          </p>
        </div>

        <div className="space-y-7 p-6">
          {/* ─── Step 1 — persona ─────────────────────────────────────── */}
          {step === 1 && (
            <>
              <div className="space-y-2" role="radiogroup">
                {personas.map((p) => (
                  <OptionCard
                    key={p.id}
                    selected={s.personaId === p.id}
                    onSelect={() => set({ personaId: p.id })}
                    title={p.name}
                    blurb={p.demographics ?? undefined}
                  />
                ))}
                <OptionCard
                  selected={s.personaId === NEW}
                  onSelect={() => set({ personaId: NEW })}
                  title="Write a new persona"
                  blurb={
                    personas.length === 0
                      ? "No personas yet — the first concept writes the first one."
                      : "Only when none of the above is who this concept is for."
                  }
                />
              </div>

              {s.personaId === NEW && (
                <div className="space-y-5 rounded-[10px] border border-line p-5">
                  <div>
                    <label className="field-label" htmlFor="wiz-personaName">
                      Persona name
                    </label>
                    <input
                      id="wiz-personaName"
                      value={s.personaName}
                      onChange={(e) => set({ personaName: e.target.value })}
                      placeholder="Desk-bound Dave, 45, still lifting"
                      className="field"
                    />
                  </div>
                  {PERSONA_FIELDS.map((f) => (
                    <div key={f.key}>
                      <label className="field-label" htmlFor={`wiz-${f.key}`}>
                        {f.label}
                      </label>
                      <textarea
                        id={`wiz-${f.key}`}
                        rows={2}
                        value={s.personaFields[f.key] ?? ""}
                        onChange={(e) =>
                          set({
                            personaFields: {
                              ...s.personaFields,
                              [f.key]: e.target.value,
                            },
                          })
                        }
                        placeholder={f.placeholder}
                        className="field"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ─── Step 2 — desire ──────────────────────────────────────── */}
          {step === 2 && (
            <>
              <p className="-mt-1 text-xs leading-relaxed text-muted">
                Desires are shared across concepts and personas — the same want
                turns up in several of them. Reuse one wherever you can; a
                near-duplicate hides that they are the same want.
              </p>
              <div className="space-y-2" role="radiogroup">
                {desires.map((d) => (
                  <OptionCard
                    key={d.id}
                    selected={s.desireId === d.id}
                    onSelect={() => chooseDesire(d.id)}
                    title={d.statement}
                  />
                ))}
                <OptionCard
                  selected={s.desireId === NEW}
                  onSelect={() => chooseDesire(NEW)}
                  title="Write a new desire"
                  blurb={
                    desires.length === 0
                      ? "No desires yet — write the first one as a want statement."
                      : "Only when this is genuinely a different want."
                  }
                />
              </div>

              {s.desireId === NEW && (
                <div className="space-y-5 rounded-[10px] border border-line p-5">
                  <div>
                    <label className="field-label" htmlFor="wiz-desire">
                      Want statement
                    </label>
                    <textarea
                      id="wiz-desire"
                      rows={2}
                      value={s.desireStatement}
                      onChange={(e) => set({ desireStatement: e.target.value })}
                      placeholder="I want to get through a full workday without my back seizing up"
                      className="field"
                    />
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      Write it as they would say it, first person, starting
                      &ldquo;I want to…&rdquo;.
                    </p>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="wiz-desireNotes">
                      Notes
                    </label>
                    <textarea
                      id="wiz-desireNotes"
                      rows={2}
                      value={s.desireNotes}
                      onChange={(e) => set({ desireNotes: e.target.value })}
                      placeholder="Where this came from — a review, a call, a comment thread"
                      className="field"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ─── Step 3 — benefit ─────────────────────────────────────── */}
          {step === 3 && (
            <>
              <div className="rounded-[10px] border border-line bg-wash/50 px-4 py-3">
                <p className="text-xs font-medium tracking-[0.02em] text-muted">
                  Answering the desire
                </p>
                <p className="mt-1 text-sm">
                  {desire ? desire.statement : s.desireStatement}
                </p>
              </div>

              {desireBenefits.length > 0 && (
                <div className="space-y-2" role="radiogroup">
                  {desireBenefits.map((b) => (
                    <OptionCard
                      key={b.id}
                      selected={s.benefitId === b.id}
                      onSelect={() => set({ benefitId: b.id })}
                      title={`${b.productName} — ${b.feature}`}
                      blurb={`So you can ${b.benefit}`}
                    />
                  ))}
                  <OptionCard
                    selected={s.benefitId === NEW}
                    onSelect={() => set({ benefitId: NEW })}
                    title="Write a new benefit"
                    blurb="Only when none of the above is what this concept sells."
                  />
                </div>
              )}

              {s.benefitId === NEW && (
                <div className="space-y-5 rounded-[10px] border border-line p-5">
                  {desireBenefits.length === 0 && (
                    <p className="-mb-1 text-xs leading-relaxed text-muted">
                      Nothing has been written against this desire yet — this is
                      the first benefit answering it.
                    </p>
                  )}
                  <div>
                    <label className="field-label" htmlFor="wiz-product">
                      Product / feature name
                    </label>
                    <input
                      id="wiz-product"
                      value={s.benefitProductName}
                      onChange={(e) =>
                        set({ benefitProductName: e.target.value })
                      }
                      placeholder="12-Week Non-Surgical Spine Program"
                      className="field"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="wiz-feature">
                      The feature
                    </label>
                    <textarea
                      id="wiz-feature"
                      rows={2}
                      value={s.benefitFeature}
                      onChange={(e) => set({ benefitFeature: e.target.value })}
                      placeholder="What it actually is — the mechanism, plainly stated"
                      className="field"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="wiz-benefit">
                      The benefit — so you can…
                    </label>
                    <textarea
                      id="wiz-benefit"
                      rows={2}
                      value={s.benefitBenefit}
                      onChange={(e) => set({ benefitBenefit: e.target.value })}
                      placeholder="…get back to a full day on site without planning it around the pain"
                      className="field"
                    />
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      Finish the sentence &ldquo;so you can…&rdquo;. If it
                      describes the product rather than their day, it is still a
                      feature.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ─── Step 4 — positioning ─────────────────────────────────── */}
          {step === 4 && (
            <>
              <div>
                <span className="field-label mb-0 block">Awareness level</span>
                <p className="mb-2 mt-1 text-xs leading-relaxed text-muted">
                  {AWARENESS_GUIDANCE_INTRO}
                </p>
                <div className="space-y-2" role="radiogroup">
                  {AWARENESS_LEVELS.map((level) => (
                    <OptionCard
                      key={level}
                      selected={s.awarenessLevel === level}
                      onSelect={() => set({ awarenessLevel: level })}
                      title={AWARENESS_LEVEL_LABELS[level as AwarenessLevel]}
                      blurb={AWARENESS_LEVEL_GUIDANCE[level as AwarenessLevel]}
                    />
                  ))}
                </div>
              </div>

              <div>
                <span className="field-label mb-0 block">
                  Market sophistication stage
                </span>
                <p className="mb-2 mt-1 text-xs leading-relaxed text-muted">
                  {SOPHISTICATION_GUIDANCE_INTRO}
                </p>
                <div className="space-y-2" role="radiogroup">
                  {SOPHISTICATION_STAGE_META.map((stage) => (
                    <OptionCard
                      key={stage.stage}
                      selected={s.sophisticationStage === String(stage.stage)}
                      onSelect={() =>
                        set({ sophisticationStage: String(stage.stage) })
                      }
                      title={stage.label}
                      blurb={stage.guidance}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ─── Step 5 — name it ─────────────────────────────────────── */}
          {step === 5 && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="field-label" htmlFor="wiz-name">
                    Concept name
                  </label>
                  <input
                    id="wiz-name"
                    value={s.name}
                    onChange={(e) => set({ name: e.target.value })}
                    placeholder="The one that stops the workaround"
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="wiz-batch">
                    Batch number
                  </label>
                  <input
                    id="wiz-batch"
                    type="number"
                    min="1"
                    step="1"
                    value={s.batchNumber}
                    onChange={(e) => set({ batchNumber: e.target.value })}
                    className="field num"
                  />
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="wiz-notes">
                  Notes
                </label>
                <textarea
                  id="wiz-notes"
                  rows={3}
                  value={s.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  placeholder="Why this concept, what it is testing, what would prove it wrong"
                  className="field"
                />
              </div>

              <Summary
                persona={persona ? persona.name : s.personaName}
                desire={desire ? desire.statement : s.desireStatement}
                benefit={
                  benefit
                    ? `${benefit.productName} — ${benefit.feature}`
                    : `${s.benefitProductName} — ${s.benefitFeature}`
                }
                awareness={
                  AWARENESS_LEVEL_LABELS[s.awarenessLevel as AwarenessLevel] ??
                  "—"
                }
                stage={
                  SOPHISTICATION_STAGE_META.find(
                    (x) => String(x.stage) === s.sophisticationStage,
                  )?.label ?? "—"
                }
              />
            </>
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
          {/* Two separate slots rather than one ternary, so React never reuses
              the same DOM node for both. Advancing to the last step inside the
              click handler would otherwise flip that node to type="submit"
              before the browser runs the click's default action — and the
              Continue press onto the final step would create the concept
              without "Create concept" ever being pressed. */}
          {!last && (
            <button
              type="button"
              onClick={() => setStep((n) => n + 1)}
              disabled={!canContinue}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {last && (
            <button
              type="submit"
              disabled={!canContinue}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create concept →
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

// The selectable card used by every "pick one" step — the same option row the
// ICP scorecard uses, with its guidance sitting under the label.
function OptionCard({
  selected,
  onSelect,
  title,
  blurb,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  blurb?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-[10px] border px-3.5 py-3 transition-colors ${
        selected ? "border-accent bg-accent/5" : "border-line hover:bg-wash/70"
      }`}
    >
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? "border-accent" : "border-line bg-surface"
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {blurb && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
            {blurb}
          </span>
        )}
      </span>
    </label>
  );
}

function Summary({
  persona,
  desire,
  benefit,
  awareness,
  stage,
}: {
  persona: string;
  desire: string;
  benefit: string;
  awareness: string;
  stage: string;
}) {
  const rows = [
    { label: "Persona", value: persona },
    { label: "Desire", value: desire },
    { label: "Benefit", value: benefit },
    { label: "Awareness", value: awareness },
    { label: "Sophistication", value: stage },
  ];
  return (
    <ul className="overflow-hidden rounded-[10px] border border-line">
      {rows.map((row) => (
        <li
          key={row.label}
          className="flex items-start gap-3 border-b border-line/60 px-4 py-3 last:border-b-0"
        >
          <span className="w-32 shrink-0 text-sm font-medium">{row.label}</span>
          <span className="min-w-0 flex-1 text-sm text-muted">
            {row.value.trim() === "" || row.value.trim() === "—" ? "—" : row.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
