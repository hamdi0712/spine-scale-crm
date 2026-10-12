"use client";

// The lead's ICP scorecard under the new model — the disqualifier gate, Fit and
// Signals, every line with its citation, and every line overridable.
//
// It replaces the old A–D card on the lead page. The card starts from one of
// three things: the breakdown stored on the lead (from Discovery, or saved
// here before), a fresh suggestion from "Score against the ICP", or — on a
// lead nobody has scored this way — a blank card against the active ICP for
// scoring by hand. Whichever it is, the override controls sit over it and the
// total, tier and verdict are worked out live by the same function a queue run
// uses (applyOverride in src/lib/icpScoring.ts), so what the card shows is what
// Save stores.
//
// Same rule as the old card's assist: a suggestion is pre-filled and explains
// itself, and nothing is stored until Save.

import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CriterionEntry,
  CriterionKey,
  FIT_KEYS,
  IcpBreakdownV2,
  PAYMENT_MODEL_LABELS,
  SIGNAL_KEYS,
  SOURCE_PRECHECK,
  V2_TIER_BANDS,
  allowedPoints,
  applyOverride,
  serializeBreakdownV2,
} from "@/lib/icpScoring";
import { FIT_FLOOR, FIT_MAX, SIGNALS_MAX, V2_MAX_SCORE } from "@/lib/icpWeights";
import { fmtDateTime } from "@/lib/format";
import { IcpTierBadge } from "@/components/Badge";
import AiButton from "@/components/AiButton";
import {
  ChiroProgramChecklist,
  CitationLine,
  SourceChip,
  VERDICT_CLS,
  VERDICT_TITLES,
} from "@/components/IcpBreakdownV2View";

type SuggestResult =
  | { ok: true; breakdown: IcpBreakdownV2 }
  | { ok: false; error: string };

type Points = Partial<Record<CriterionKey, number>>;

function pointsOf(b: IcpBreakdownV2): Points {
  return Object.fromEntries([...b.fit, ...b.signals].map((e) => [e.key, e.points]));
}

function dqsOf(b: IcpBreakdownV2): Record<string, boolean> {
  return Object.fromEntries(b.disqualifiers.map((d) => [d.id, d.triggered]));
}

export default function IcpScorecardV2({
  stored,
  blank,
  action,
  suggest,
  enriched,
  activeIcpName,
}: {
  // The breakdown on the lead, or null for a lead never scored this way.
  stored: IcpBreakdownV2 | null;
  // A blank card against the active ICP, for scoring by hand. Null when no ICP
  // is active, which is also when nothing can be scored at all.
  blank: IcpBreakdownV2 | null;
  action: (formData: FormData) => Promise<void>;
  suggest: (() => Promise<SuggestResult>) | null;
  enriched: boolean;
  activeIcpName: string | null;
}) {
  const [base, setBase] = useState<IcpBreakdownV2 | null>(stored ?? blank);
  const [fromSuggestion, setFromSuggestion] = useState(false);
  const [points, setPoints] = useState<Points>(() => (base ? pointsOf(base) : {}));
  const [dqs, setDqs] = useState<Record<string, boolean>>(() => (base ? dqsOf(base) : {}));
  const [chiro, setChiro] = useState(base?.primaryService.chiropractic ?? false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const askingRef = useRef(false);

  // What Save would store, worked out live from the base and the overrides.
  const live = useMemo(
    () =>
      base
        ? applyOverride(
            base,
            { points, disqualifiers: dqs, chiropractic: chiro, note: null },
            new Date(base.scoredAt || Date.now()),
          )
        : null,
    [base, points, dqs, chiro],
  );

  async function askForScores() {
    if (!suggest || askingRef.current) return;
    askingRef.current = true;
    setAsking(true);
    setError(null);
    try {
      const next = await suggest();
      if (!next.ok) {
        setError(next.error);
        return;
      }
      setBase(next.breakdown);
      setPoints(pointsOf(next.breakdown));
      setDqs(dqsOf(next.breakdown));
      setChiro(next.breakdown.primaryService.chiropractic);
      setFromSuggestion(true);
    } catch {
      setError("The scoring run could not be reached. Check the server is still up and try again.");
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  }

  if (!base || !live) {
    return (
      <div className="card px-6 py-8 text-center">
        <p className="text-sm font-medium">No ICP is active</p>
        <p className="helper-text mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
          The scorecard judges fit against the active ICP Definition. Switch one
          on under Settings → ICP to score this lead.
        </p>
      </div>
    );
  }

  const kind = live.verdict.kind;

  return (
    <form action={action} className="card">
      <input type="hidden" name="base" value={serializeBreakdownV2(base)} />

      <div className="flex items-center justify-between gap-4 border-b border-line/60 px-6 py-4 max-md:flex-col max-md:items-start max-md:gap-2 max-md:px-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Score — ICP model</h3>
          <p className="helper-text mt-0.5 text-xs text-muted">
            Against “{base.icp.name}” · {V2_TIER_BANDS}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="flex shrink-0 items-baseline gap-1 whitespace-nowrap">
            <span
              className={`num text-2xl font-semibold tracking-[-0.02em] ${
                live.tier === "DISQUALIFIED" ? "text-muted" : "text-ink"
              }`}
            >
              {live.total}
            </span>
            <span className="num text-sm text-muted">/ {V2_MAX_SCORE}</span>
          </span>
          <IcpTierBadge tier={live.tier} tooltip={false} />
        </div>
      </div>

      <div className="space-y-7 p-6 max-md:p-4">
        {/* The assist. Reads the lead's stored enrichment against the active
            ICP; the answer arrives pre-filled and is stored only on Save. */}
        {suggest && (
          <div className="rounded-[10px] border border-line bg-wash/50 p-4">
            <div className="flex items-start justify-between gap-4 max-md:flex-col">
              <div className="min-w-0">
                <p className="text-sm font-medium">Score against the ICP</p>
                <p className="helper-text mt-0.5 text-xs leading-relaxed text-muted">
                  {enriched
                    ? `Reads this lead’s enrichment against “${activeIcpName ?? base.icp.name}” and fills in every line below with the quote behind it. Nothing is stored until you save.`
                    : "Run “Enrich this lead” first — the scoring reads the website copy, the ads signal and the review count, and this lead has none of them yet."}
                </p>
              </div>
              <AiButton
                onClick={() => void askForScores()}
                disabled={!enriched || asking}
                className="h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {asking ? "Scoring…" : stored || fromSuggestion ? "Score again" : "Score against the ICP"}
              </AiButton>
            </div>
            {error && (
              <div className="mt-3 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-3.5 py-2.5">
                <p className="text-sm font-medium text-bad">Nothing was scored</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{error}</p>
              </div>
            )}
            {fromSuggestion && (
              <p className="mt-3 rounded-[10px] border border-accent/30 bg-accent/5 px-3.5 py-2 text-xs leading-relaxed text-muted">
                A fresh run is on the card below, not yet saved. Check each line
                against its quote and save the card yourself.
              </p>
            )}
          </div>
        )}

        <div className={`rounded-[10px] border px-4 py-3 ${VERDICT_CLS[kind]}`}>
          <p className="text-sm font-medium">{VERDICT_TITLES[kind]}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{live.verdict.reason}</p>
          <p className="helper-text mt-1 text-xs text-muted">
            The verdict Process Queue would reach on this card — on a lead it
            sets the tier, not the stage.
          </p>
        </div>

        <fieldset>
          <legend className="field-label">Disqualifier gate</legend>
          <p className="helper-text -mt-1 mb-2 text-xs leading-relaxed text-muted">
            Any one ticked scores the clinic 0. A run ticks one only on a cited
            quote that states it.
          </p>
          <div className="space-y-2">
            {base.disqualifiers.map((d) => {
              const on = dqs[d.id] === true;
              const hit = live.disqualifiers.find((x) => x.id === d.id);
              return (
                <label
                  key={d.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-[10px] border px-3.5 py-3 transition-colors ${
                    on ? "border-bad/40 bg-bad-soft/60" : "border-line hover:bg-wash/70"
                  }`}
                >
                  <input
                    type="checkbox"
                    name={`dq_${d.id}`}
                    checked={on}
                    onChange={(e) => setDqs((prev) => ({ ...prev, [d.id]: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-bad"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-medium ${on ? "text-bad" : "text-ink"}`}>
                      {d.label}
                    </span>
                    {on && d.citation && <CitationLine citation={d.citation} />}
                    {hit?.scoredTriggered !== undefined && (
                      <span className="mt-0.5 block text-xs text-muted">
                        Overridden — the run had this {hit.scoredTriggered ? "on" : "off"}.
                      </span>
                    )}
                    {!on && d.discarded && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {d.discarded}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <CriteriaSection
          title="Fit"
          meta={`${live.fitTotal} / ${FIT_MAX} · needs ${FIT_FLOOR}`}
          keys={FIT_KEYS}
          live={live}
          points={points}
          onPoints={(key, value) => setPoints((prev) => ({ ...prev, [key]: value }))}
        />
        <CriteriaSection
          title="Signals"
          meta={`${live.signalsTotal} / ${SIGNALS_MAX}`}
          keys={SIGNAL_KEYS}
          live={live}
          points={points}
          onPoints={(key, value) => setPoints((prev) => ({ ...prev, [key]: value }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line px-3.5 py-3 hover:bg-wash/70">
            <input
              type="checkbox"
              name="chiro"
              checked={chiro}
              onChange={(e) => setChiro(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Primary service is chiropractic</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                A qualifying chiro-first clinic is promoted only with a real program — 2 of the 5 signals below.
                {base.primaryService.service ? ` The run read it as ${base.primaryService.service}.` : ""}
              </span>
              {base.primaryService.citation && <CitationLine citation={base.primaryService.citation} />}
            </span>
          </label>
          <div className="rounded-[10px] border border-line px-3.5 py-3">
            <p className="text-sm font-medium">
              Payment model:{" "}
              <span className="font-normal text-ink-soft">
                {PAYMENT_MODEL_LABELS[base.paymentModel.model]}
              </span>
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{base.paymentModel.reason}</p>
            {base.paymentModel.citation && <CitationLine citation={base.paymentModel.citation} />}
          </div>
        </div>

        {chiro && <ChiroProgramChecklist check={live.chiroProgram} />}

        {base.summary !== "" && (
          <div className="rounded-[10px] border border-accent/30 bg-accent/5 px-3.5 py-2.5">
            <p className="text-xs font-medium">Overall fit</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{base.summary}</p>
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="overrideNote">
            Override note
          </label>
          <textarea
            id="overrideNote"
            name="overrideNote"
            defaultValue={base.overrideNote ?? ""}
            rows={3}
            placeholder="Why a line was changed — what you saw on the site, what they said on the call…"
            className="field"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line/60 px-6 py-4 max-md:px-4">
        <span className="num text-xs text-muted">
          {base.overriddenAt
            ? `Last saved ${fmtDateTime(base.overriddenAt)}`
            : stored
              ? `Scored ${fmtDateTime(stored.scoredAt)}`
              : "Not saved yet"}
        </span>
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save scorecard"}
    </button>
  );
}

function CriteriaSection({
  title,
  meta,
  keys,
  live,
  points,
  onPoints,
}: {
  title: string;
  meta: string;
  keys: readonly CriterionKey[];
  live: IcpBreakdownV2;
  points: Points;
  onPoints: (key: CriterionKey, value: number) => void;
}) {
  const entries = [...live.fit, ...live.signals];
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="field-label mb-0">{title}</p>
        <span className="num text-xs text-muted">{meta}</span>
      </div>
      <ul className="divide-y divide-line/60 rounded-[10px] border border-line">
        {keys.map((key) => {
          const entry = entries.find((e) => e.key === key);
          return entry ? (
            <EditableRow
              key={key}
              entry={entry}
              value={points[key] ?? entry.points}
              onChange={(v) => onPoints(key, v)}
            />
          ) : null;
        })}
      </ul>
    </div>
  );
}

// One criterion: the reason and its citations, and the point values it can
// take as a row of pills. Picking a different value than the run's is an
// override, and the row says what the run had.
function EditableRow({
  entry,
  value,
  onChange,
}: {
  entry: CriterionEntry;
  value: number;
  onChange: (v: number) => void;
}) {
  const options = allowedPoints(entry.key);
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium">{entry.label}</p>
        <SourceChip source={entry.scoredPoints !== undefined ? "override" : entry.source} />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{entry.reason}</p>
      {entry.parts && entry.parts.length > 0
        ? entry.parts.map((p, i) =>
            p.citation && p.points > 0 && p.citation.source !== SOURCE_PRECHECK ? (
              <CitationLine key={i} citation={p.citation} />
            ) : null,
          )
        : entry.citations.map((c, i) => <CitationLine key={i} citation={c} />)}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={`${entry.label} points`}>
        {options.map((option) => {
          const selected = value === option;
          return (
            <label
              key={option}
              className={`num inline-flex h-[30px] min-w-[44px] cursor-pointer items-center justify-center rounded-full border px-2.5 text-xs font-medium transition-colors ${
                selected
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-muted hover:bg-wash/70"
              }`}
            >
              <input
                type="radio"
                name={`points_${entry.key}`}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              {option}
            </label>
          );
        })}
        <span className="num ml-1 text-xs text-muted">/ {entry.max}</span>
        {entry.scoredPoints !== undefined && (
          <span className="text-xs text-warn-on-soft">Overridden — was {entry.scoredPoints}</span>
        )}
      </div>
    </li>
  );
}
