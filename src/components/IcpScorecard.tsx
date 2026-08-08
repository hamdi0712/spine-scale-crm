"use client";

import { useMemo, useRef, useState } from "react";
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
import {
  ASSIST_CATEGORY_KEY,
  AssistGapKey,
  IcpAssistResult,
  IcpAssistSuggestion,
  isAssistGapKey,
} from "@/lib/icpAssist";
import { fmtDate } from "@/lib/format";
import { IcpTierBadge } from "@/components/Badge";
import AiButton from "@/components/AiButton";

export type IcpScorecardValues = Record<IcpDisqualifierKey, boolean> &
  Record<IcpGapKey, boolean> &
  Record<IcpCategoryKey, number | null> & {
    icpNotes: string | null;
    icpScoredAt: string | null;
  };

export interface StaffSizeSuggestion {
  staffCount: number;
  points: number;
}

// What the answers were the moment a model suggestion was applied over them,
// so a suggestion that overwrote somebody's own answer says so instead of
// quietly replacing it.
type AssistPrior = Pick<
  IcpScorecardValues,
  "icpPackageEconomics" | "icpGapBooking" | "icpGapReviews"
>;

export default function IcpScorecard({
  values,
  action,
  staffSizeSuggestion = null,
  suggestScores = null,
  enriched = false,
}: {
  values: IcpScorecardValues;
  action: (formData: FormData) => Promise<void>;
  // Offered by the CSV import when the lead arrived with a staff count and
  // category A has never been answered. It pre-selects an option and says so —
  // it is not a score until this form is saved, which is the whole point: a
  // number off a scrape is evidence, not a judgement.
  staffSizeSuggestion?: StaffSizeSuggestion | null;
  // Asks DeepSeek to read this lead's enrichment against the framework and
  // suggest category B and the two Automation Gap boxes. Held to the same rule
  // as the staff-size suggestion above: it pre-selects and explains itself,
  // and nothing it says is stored until this form is saved.
  suggestScores?: (() => Promise<IcpAssistResult>) | null;
  // Whether the lead has been enriched at all. Without it there is nothing for
  // the assist to read, so the button says so rather than asking anyway.
  enriched?: boolean;
}) {
  const suggestingStaffSize =
    staffSizeSuggestion != null && values.icpStaffSize == null;
  const [answers, setAnswers] = useState(() =>
    suggestingStaffSize
      ? { ...values, icpStaffSize: staffSizeSuggestion!.points }
      : values,
  );

  const [asking, setAsking] = useState(false);
  const [assist, setAssist] = useState<IcpAssistSuggestion | null>(null);
  const [assistBasedOn, setAssistBasedOn] = useState<string[]>([]);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistPrior, setAssistPrior] = useState<AssistPrior | null>(null);

  // The answers as they stand right now, for the moment after an await — the
  // handler's own closure was captured before the request went out.
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const result = useMemo(() => scoreIcp(answers as IcpAnswers), [answers]);
  const { disqualified } = result;

  function setFlag(key: IcpDisqualifierKey | IcpGapKey, value: boolean) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  function setPoints(key: IcpCategoryKey, points: number) {
    setAnswers((a) => ({ ...a, [key]: points }));
  }

  // Runs the assist and pre-selects what comes back. Every failure — a missing
  // key, a refused request, an answer that doesn't read as scores, a server
  // that isn't there — lands in one place and leaves the form exactly as it
  // was: a suggestion that didn't arrive must not disturb answers already on
  // screen.
  async function askForSuggestions() {
    if (!suggestScores || asking) return;
    setAsking(true);
    setAssistError(null);
    try {
      const next = await suggestScores();
      if (!next.ok) {
        setAssistError(next.error);
        return;
      }
      const current = answersRef.current;
      setAssistPrior({
        icpPackageEconomics: current.icpPackageEconomics,
        icpGapBooking: current.icpGapBooking,
        icpGapReviews: current.icpGapReviews,
      });
      setAssist(next.suggestion);
      setAssistBasedOn(next.basedOn);
      setAnswers((a) => {
        const applied = { ...a };
        if (next.suggestion.packageEconomics) {
          applied[ASSIST_CATEGORY_KEY] = next.suggestion.packageEconomics.points;
        }
        for (const [key, gap] of Object.entries(next.suggestion.gaps)) {
          applied[key as AssistGapKey] = gap.checked;
        }
        return applied;
      });
    } catch {
      setAssistError(
        "The suggestion could not be reached. Check the server is still up and try again.",
      );
    } finally {
      setAsking(false);
    }
  }

  // Whether a suggestion overwrote an answer that was already there. Only the
  // gaps need the scored-at check: an unchecked box is also the default for a
  // card nobody has filled in, and "changed what you had" is only true of a
  // card somebody has.
  function replacedPoints(): number | null {
    const suggested = assist?.packageEconomics?.points;
    const prior = assistPrior?.icpPackageEconomics ?? null;
    return prior != null && suggested != null && prior !== suggested
      ? prior
      : null;
  }

  function changedGap(key: AssistGapKey): boolean {
    const suggested = assist?.gaps[key];
    if (!suggested || !assistPrior || !answers.icpScoredAt) return false;
    return assistPrior[key] !== suggested.checked;
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
          {/* Inside the fieldset on purpose: a disqualified clinic is not
              scored, so the assist dims and stops working with everything else
              it would have been suggesting. */}
          {suggestScores && (
            <div className="rounded-[10px] border border-line bg-wash/50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Scoring assist</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {enriched
                      ? "Reads this lead’s enrichment — website notes, Meta ads signal, review count — against the framework below and suggests B and the two Automation Gap boxes it can see. Suggestions arrive pre-selected with their reasoning; nothing is scored until you save this card."
                      : "Run “Enrich this lead” first. The suggestion is made from the website notes, the Meta ads signal and the review count, and this lead has none of them yet."}
                  </p>
                </div>
                <AiButton
                  onClick={() => void askForSuggestions()}
                  disabled={!enriched || asking}
                  className="h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {asking
                    ? "Asking…"
                    : assist
                      ? "Suggest again"
                      : "Suggest remaining scores"}
                </AiButton>
              </div>

              {assistError && (
                <div className="mt-3 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-3.5 py-2.5">
                  <p className="text-sm font-medium text-bad">
                    No suggestion was made
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {assistError}
                  </p>
                </div>
              )}

              {assist && (
                <div className="mt-3 rounded-[10px] border border-accent/30 bg-accent/5 px-3.5 py-2.5">
                  <p className="text-xs font-medium">Overall fit</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {assist.summary === ""
                      ? "No summary came back with this suggestion."
                      : assist.summary}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    Read from{" "}
                    {assistBasedOn.length === 0
                      ? "this lead’s enrichment"
                      : assistBasedOn.join(", ")}
                    . A suggestion, not a score — check each one against the
                    option text and save the card yourself.
                  </p>
                </div>
              )}
            </div>
          )}

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
              {suggestingStaffSize && category.key === "icpStaffSize" && (
                <SuggestionNote className="mb-2">
                  Imported staff count of{" "}
                  <span className="num font-medium text-ink">
                    {staffSizeSuggestion!.staffCount}
                  </span>{" "}
                  suggests{" "}
                  <span className="num font-medium text-ink">
                    {staffSizeSuggestion!.points} pt
                  </span>
                  , pre-selected below. Change it if the headcount is wrong —
                  nothing is scored until you save this card.
                </SuggestionNote>
              )}
              {category.key === ASSIST_CATEGORY_KEY &&
                assist?.packageEconomics && (
                  <SuggestionNote className="mb-2">
                    DeepSeek suggests{" "}
                    <span className="num font-medium text-ink">
                      {assist.packageEconomics.points} pt
                    </span>
                    , pre-selected below. {assist.packageEconomics.reason}
                    {replacedPoints() != null && (
                      <>
                        {" "}
                        It replaced the{" "}
                        <span className="num font-medium text-ink">
                          {replacedPoints()} pt
                        </span>{" "}
                        you had — put it back if the model has this wrong.
                      </>
                    )}{" "}
                    Nothing is scored until you save this card.
                  </SuggestionNote>
                )}
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
              {ICP_GAPS.map((gap) => {
                // Only two of the three are ever suggested — remarketing is
                // judged on evidence the enrichment run does not gather, so
                // that box stays entirely the user's (see src/lib/icpAssist.ts).
                const suggested = isAssistGapKey(gap.key)
                  ? assist?.gaps[gap.key]
                  : undefined;
                return (
                  <div key={gap.key}>
                    <label
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
                    {suggested && (
                      <SuggestionNote className="mt-1.5">
                        DeepSeek suggests this box{" "}
                        <span className="font-medium text-ink">
                          {suggested.checked ? "checked" : "left unchecked"}
                        </span>
                        , pre-selected above. {suggested.reason}
                        {isAssistGapKey(gap.key) && changedGap(gap.key) && (
                          <> It changed what you had — untick or retick it if the model has this wrong.</>
                        )}
                      </SuggestionNote>
                    )}
                  </div>
                );
              })}
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

// Every suggestion on this card reads the same way, whether it came from a
// staff count or from a model: brand-tinted, sitting against the option it
// pre-selected, and saying so. One component so a second kind of suggestion
// could never quietly look like a different kind of fact.
function SuggestionNote({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`rounded-[10px] border border-accent/30 bg-accent/5 px-3.5 py-2 text-xs leading-relaxed text-muted ${className}`}
    >
      {children}
    </p>
  );
}
