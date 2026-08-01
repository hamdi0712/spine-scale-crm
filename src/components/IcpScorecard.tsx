"use client";

import { useMemo, useState } from "react";
import {
  ICP_CATEGORIES,
  ICP_DISQUALIFIERS,
  ICP_DISQUALIFIER_RULE,
  ICP_GAPS,
  ICP_GAP_GUIDANCE,
  ICP_GAP_MAX,
  ICP_MAX_SCORE,
  ICP_TIER_ACTIONS,
  ICP_TIER_BANDS,
  IcpAnswers,
  IcpCategoryKey,
  IcpDisqualifierKey,
  IcpGapKey,
  scoreIcp,
} from "@/lib/icp";
import { fmtDate } from "@/lib/format";
import { IcpTierBadge } from "@/components/Badge";

export type IcpScorecardValues = Record<IcpDisqualifierKey, boolean> &
  Record<IcpGapKey, boolean> &
  Record<IcpCategoryKey, number | null> & {
    icpNotes: string | null;
    icpScoredAt: string | null;
  };

export default function IcpScorecard({
  values,
  action,
}: {
  values: IcpScorecardValues;
  action: (formData: FormData) => Promise<void>;
}) {
  const [answers, setAnswers] = useState(values);

  const result = useMemo(() => scoreIcp(answers as IcpAnswers), [answers]);
  const { disqualified } = result;

  function setFlag(key: IcpDisqualifierKey | IcpGapKey, value: boolean) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  function setPoints(key: IcpCategoryKey, points: number) {
    setAnswers((a) => ({ ...a, [key]: points }));
  }

  return (
    <form action={action} className="card">
      <div className="flex items-center justify-between gap-4 border-b border-line/60 px-6 py-4">
        <div>
          <h3 className="text-sm font-medium">Score</h3>
          <p className="mt-0.5 text-xs text-muted">
            {disqualified
              ? "Disqualified at Layer 1 — scoring does not apply"
              : ICP_TIER_BANDS}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex shrink-0 items-baseline gap-1 whitespace-nowrap">
            <span
              className={`num text-2xl font-semibold tracking-[-0.02em] ${
                disqualified ? "text-muted" : "text-ink"
              }`}
            >
              {result.total}
            </span>
            <span className="num text-sm text-muted">/ {ICP_MAX_SCORE}</span>
          </span>
          {/* Action spelled out here, so the badge drops its hover title. */}
          <IcpTierBadge tier={result.tier} tooltip={false} />
          {ICP_TIER_ACTIONS[result.tier] && (
            <span className="text-xs leading-relaxed text-muted">
              {ICP_TIER_ACTIONS[result.tier]}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-7 p-6">
        <fieldset>
          <legend className="field-label">
            Layer 1 — Hard disqualifiers (check first)
          </legend>
          <p className="-mt-1 mb-2 text-xs leading-relaxed text-muted">
            {ICP_DISQUALIFIER_RULE}
          </p>
          <div className="space-y-2">
            {ICP_DISQUALIFIERS.map((d) => (
              <label
                key={d.key}
                className={`flex cursor-pointer items-start gap-3 rounded-[10px] border px-3.5 py-3 transition-colors ${
                  answers[d.key]
                    ? "border-bad/40 bg-bad-soft/60"
                    : "border-line hover:bg-wash/70"
                }`}
              >
                <input
                  type="checkbox"
                  name={d.key}
                  checked={answers[d.key]}
                  onChange={(e) => setFlag(d.key, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-bad"
                />
                <span className="flex-1">
                  <span
                    className={`block text-sm font-medium ${
                      answers[d.key] ? "text-bad" : "text-ink"
                    }`}
                  >
                    {d.label}
                  </span>
                  {d.signal && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {d.signal}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {disqualified && (
          <>
            <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
              <p className="text-sm font-medium text-bad">
                Disqualified — do not proceed to scoring
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                This clinic is not a fit right now regardless of how it would
                score below. Triggered by{" "}
                {result.triggered.map((d) => d.label).join("; ")}.
              </p>
            </div>
            {/* The scoring fieldset below is disabled, so its controls do not
                post. Carry the existing answers through so disqualifying a
                lead never destroys work already recorded. */}
            {ICP_CATEGORIES.map((c) =>
              answers[c.key] == null ? null : (
                <input
                  key={c.key}
                  type="hidden"
                  name={c.key}
                  value={String(answers[c.key])}
                />
              ),
            )}
            {ICP_GAPS.map((g) =>
              answers[g.key] ? (
                <input key={g.key} type="hidden" name={g.key} value="true" />
              ) : null,
            )}
          </>
        )}

        <fieldset
          disabled={disqualified}
          className={`space-y-7 ${disqualified ? "opacity-45" : ""}`}
        >
          {ICP_CATEGORIES.map((category) => (
            <div key={category.key}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="field-label mb-0">
                  {category.letter} — {category.title}
                </span>
                <span className="num shrink-0 text-xs text-muted">
                  {answers[category.key] ?? 0} / {category.max}
                </span>
              </div>
              <p className="mb-2 mt-1 text-xs leading-relaxed text-muted">
                {category.guidance}
              </p>
              <div className="space-y-2" role="radiogroup">
                {category.options.map((option) => {
                  const selected = answers[category.key] === option.points;
                  return (
                    <label
                      key={option.points}
                      className={`flex items-start gap-3 rounded-[10px] border px-3.5 py-3 transition-colors ${
                        disqualified ? "" : "cursor-pointer"
                      } ${
                        selected
                          ? "border-accent bg-accent/5"
                          : `border-line ${disqualified ? "" : "hover:bg-wash/70"}`
                      }`}
                    >
                      <input
                        type="radio"
                        name={category.key}
                        value={option.points}
                        checked={selected}
                        onChange={() => setPoints(category.key, option.points)}
                        className="sr-only"
                      />
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          selected ? "border-accent" : "border-line bg-surface"
                        }`}
                      >
                        {selected && (
                          <span className="h-2 w-2 rounded-full bg-accent" />
                        )}
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-medium">
                          {option.label}
                        </span>
                        {option.signal && (
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                            {option.signal}
                          </span>
                        )}
                      </span>
                      <span
                        className={`num shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          selected
                            ? "bg-accent/10 text-accent"
                            : "bg-wash text-muted"
                        }`}
                      >
                        {option.points} pt
                      </span>
                    </label>
                  );
                })}
              </div>
              {category.note && (
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {category.note}
                </p>
              )}
            </div>
          ))}

          <div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="field-label mb-0">D — Automation Gap</span>
              <span className="num shrink-0 text-xs text-muted">
                {result.gapTotal} / {ICP_GAP_MAX}
              </span>
            </div>
            <p className="mb-2 mt-1 text-xs leading-relaxed text-muted">
              {ICP_GAP_GUIDANCE}
            </p>
            <div className="space-y-2">
              {ICP_GAPS.map((gap) => (
                <label
                  key={gap.key}
                  className={`flex items-start gap-3 rounded-[10px] border px-3.5 py-3 transition-colors ${
                    disqualified ? "" : "cursor-pointer"
                  } ${
                    answers[gap.key]
                      ? "border-accent bg-accent/5"
                      : `border-line ${disqualified ? "" : "hover:bg-wash/70"}`
                  }`}
                >
                  <input
                    type="checkbox"
                    name={gap.key}
                    checked={answers[gap.key]}
                    onChange={(e) => setFlag(gap.key, e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">
                      {gap.label}
                    </span>
                    {gap.signal && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {gap.signal}
                      </span>
                    )}
                  </span>
                  <span
                    className={`num shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      answers[gap.key]
                        ? "bg-accent/10 text-accent"
                        : "bg-wash text-muted"
                    }`}
                  >
                    1 pt
                  </span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <div>
          <label className="field-label" htmlFor="icpNotes">
            Scorecard notes
          </label>
          <textarea
            id="icpNotes"
            name="icpNotes"
            defaultValue={answers.icpNotes ?? ""}
            placeholder="Evidence behind the scores — what you saw on the site, what they said on the call…"
            className="field"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line/60 px-6 py-4">
        <span className="num text-xs text-muted">
          {answers.icpScoredAt
            ? `Last scored ${fmtDate(answers.icpScoredAt)}`
            : "Not scored yet"}
        </span>
        <button type="submit" className="btn-primary">
          Save scorecard
        </button>
      </div>
    </form>
  );
}
