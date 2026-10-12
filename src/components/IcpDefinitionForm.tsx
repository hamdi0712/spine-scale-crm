"use client";

// One ICP Definition, in three cards: what it is, what it matches, and the
// context the outreach and the scorer read.
//
// A plain form posting a server action, like every other settings form here.
// It is a client component for the tag inputs and for two lines that read the
// form as it stands: the size band in words, and how many disqualifiers and
// buying triggers the scorer will be asked about — each non-empty line is one.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  ICP_LONG_TEXT_MAX,
  ICP_NAME_MAX,
  ICP_SIZE_MAX,
  ICP_TAG_FIELDS,
  ICP_TAG_FIELD_HINTS,
  ICP_TAG_FIELD_LABELS,
  ICP_TAG_PLACEHOLDERS,
  IcpDefinitionData,
  buyingTriggerLines,
  disqualifierLines,
  orderedSize,
  readSize,
  sizeRangeLabel,
} from "@/lib/icpDefinition";
import TagInput from "@/components/TagInput";

export default function IcpDefinitionForm({
  icp,
  save,
}: {
  icp: IcpDefinitionData;
  save: (formData: FormData) => Promise<void>;
}) {
  const [sizeMin, setSizeMin] = useState(icp.sizeMin === null ? "" : String(icp.sizeMin));
  const [sizeMax, setSizeMax] = useState(icp.sizeMax === null ? "" : String(icp.sizeMax));
  const [disqualifiers, setDisqualifiers] = useState(icp.disqualifiers);
  const [buyingTriggers, setBuyingTriggers] = useState(icp.buyingTriggers);

  const band = orderedSize(readSize(sizeMin), readSize(sizeMax));
  const swapped =
    readSize(sizeMin) !== null &&
    readSize(sizeMax) !== null &&
    readSize(sizeMin)! > readSize(sizeMax)!;
  const dqCount = disqualifierLines({ disqualifiers }).length;
  const triggerCount = buyingTriggerLines({ buyingTriggers }).length;

  return (
    <form action={save} className="space-y-6">
      {/* ─── Basic information ─────────────────────────────────────────── */}
      <section className="card">
        <CardHeader
          title="Basic information"
          subtitle="What this profile is, in your own words"
        />
        <div className="space-y-5 p-6">
          <div>
            <label className="field-label" htmlFor="icp-name">
              Name
            </label>
            <input
              id="icp-name"
              name="name"
              defaultValue={icp.name}
              maxLength={ICP_NAME_MAX}
              required
              className="field"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="icp-description">
              Description
            </label>
            <textarea
              id="icp-description"
              name="description"
              defaultValue={icp.description}
              maxLength={ICP_LONG_TEXT_MAX}
              rows={4}
              placeholder="Who this is for, and why — a paragraph you would hand a new hire."
              className="field leading-relaxed"
            />
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {icp.isActive
              ? "Active — this is the profile the new scoring model judges clinics against."
              : "Not active. Switch it on from the list to score against it; only one profile is active at a time."}
          </p>
        </div>
      </section>

      {/* ─── Target criteria ───────────────────────────────────────────── */}
      <section className="card">
        <CardHeader
          title="Target criteria"
          subtitle="What a fit looks like. Every list is trimmed, lowercased and kept once"
        />
        <div className="space-y-6 p-6">
          {ICP_TAG_FIELDS.map((field) => (
            <TagInputField key={field} field={field} initial={icp[field]} />
          ))}

          <div>
            <p className="field-label">Size, in locations</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs text-muted" htmlFor="icp-size-min">
                  Minimum
                </label>
                <input
                  id="icp-size-min"
                  name="sizeMin"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={ICP_SIZE_MAX}
                  step={1}
                  value={sizeMin}
                  onChange={(e) => setSizeMin(e.target.value)}
                  className="field num"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted" htmlFor="icp-size-max">
                  Maximum
                </label>
                <input
                  id="icp-size-max"
                  name="sizeMax"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={ICP_SIZE_MAX}
                  step={1}
                  value={sizeMax}
                  onChange={(e) => setSizeMax(e.target.value)}
                  className="field num"
                />
              </div>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {swapped
                ? `The minimum is above the maximum — it saves as ${sizeRangeLabel(band)}.`
                : `Scores as ${sizeRangeLabel(band)}. Locations, not employees. Leave a side blank for no bound.`}
            </p>
          </div>
        </div>
      </section>

      {/* ─── Messaging context ─────────────────────────────────────────── */}
      <section className="card">
        <CardHeader
          title="Messaging context"
          subtitle="What the outreach and the scorer read about this profile"
        />
        <div className="space-y-5 p-6">
          <div>
            <label className="field-label" htmlFor="icp-pain-points">
              Pain points
            </label>
            <textarea
              id="icp-pain-points"
              name="painPoints"
              defaultValue={icp.painPoints}
              maxLength={ICP_LONG_TEXT_MAX}
              rows={5}
              placeholder="What this kind of clinic struggles with. Step 2 of the outreach sequence reads this as context, so an observation can tie to a real pain."
              className="field leading-relaxed"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label className="field-label" htmlFor="icp-buying-triggers">
                Buying triggers
              </label>
              <span className="num text-xs text-muted">
                {triggerCount} {triggerCount === 1 ? "trigger" : "triggers"}
              </span>
            </div>
            <textarea
              id="icp-buying-triggers"
              name="buyingTriggers"
              value={buyingTriggers}
              onChange={(e) => setBuyingTriggers(e.target.value)}
              maxLength={ICP_LONG_TEXT_MAX}
              rows={5}
              placeholder="One per line. Each one found on a clinic, with a citation, scores in Signals."
              className="field leading-relaxed"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label className="field-label" htmlFor="icp-disqualifiers">
                Disqualifiers
              </label>
              <span className="num text-xs text-muted">
                {dqCount} {dqCount === 1 ? "line" : "lines"}
              </span>
            </div>
            <textarea
              id="icp-disqualifiers"
              name="disqualifiers"
              value={disqualifiers}
              onChange={(e) => setDisqualifiers(e.target.value)}
              maxLength={ICP_LONG_TEXT_MAX}
              rows={12}
              placeholder="One per line."
              className="field font-mono text-[13px] leading-relaxed"
            />
            <p className="helper-text mt-1.5 text-xs leading-relaxed text-muted">
              One per line. A disqualifier only fires on a cited quote that
              states it is true — never on something the scorer could not find.
            </p>
          </div>
        </div>
      </section>

      <SaveBar />
    </form>
  );
}

function TagInputField({
  field,
  initial,
}: {
  field: (typeof ICP_TAG_FIELDS)[number];
  initial: string[];
}) {
  return (
    <TagInput
      id={`icp-${field}`}
      name={field}
      label={ICP_TAG_FIELD_LABELS[field]}
      hint={ICP_TAG_FIELD_HINTS[field]}
      placeholder={ICP_TAG_PLACEHOLDERS[field]}
      initial={initial}
    />
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="border-b border-line/60 px-6 py-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="helper-text mt-0.5 text-xs text-muted">{subtitle}</p>
    </div>
  );
}

function SaveBar() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line/60 pt-6">
      <button
        type="submit"
        disabled={pending}
        className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save ICP"}
      </button>
      <p className="text-xs leading-relaxed text-muted">
        Saving changes what the next scoring run measures against. Nothing
        already scored is re-judged.
      </p>
    </div>
  );
}

