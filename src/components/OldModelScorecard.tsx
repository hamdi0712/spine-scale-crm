// A lead's old A–D scorecard, read-only, labelled as the old model's.
//
// The old card was the lead page's editable scorecard until the ICP model
// replaced it. Its answers stay on the lead exactly as they were saved — they
// are what this lead was judged on, and the brief is that they are kept and
// readable, never deleted. This draws them the way a person would read them:
// the total, what fired, and each category in the framework's own words.

import {
  ICP_CATEGORIES,
  ICP_DISQUALIFIERS,
  ICP_GAPS,
  ICP_MAX_SCORE,
  IcpAnswers,
  scoreIcp,
} from "@/lib/icp";
import { OLD_MODEL_LABEL } from "@/lib/storedBreakdown";
import { fmtDate } from "@/lib/format";
import { IcpTierBadge } from "@/components/Badge";

export default function OldModelScorecard({
  answers,
  notes,
  inForce,
}: {
  answers: IcpAnswers & { icpScoredAt: Date | null };
  notes: string | null;
  // Whether this card still sets the lead's tier — true until the lead has an
  // ICP-model card of its own.
  inForce: boolean;
}) {
  const result = scoreIcp(answers);
  return (
    <details className="card" open={inForce}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-6 py-4 max-md:px-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{OLD_MODEL_LABEL}</span>
          <span className="helper-text mt-0.5 block text-xs text-muted">
            The A–D scorecard, out of {ICP_MAX_SCORE}
            {answers.icpScoredAt ? ` · scored ${fmtDate(answers.icpScoredAt)}` : ""}
            {inForce
              ? " · sets this lead’s tier until it is scored under the ICP model"
              : " · kept for the record; the ICP model’s card above sets the tier"}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="num text-sm text-muted">
            {result.total} / {ICP_MAX_SCORE}
          </span>
          <IcpTierBadge tier={result.tier} tooltip={false} />
        </span>
      </summary>
      <div className="space-y-4 border-t border-line/60 px-6 py-4 text-xs leading-relaxed max-md:px-4">
        <div>
          <p className="field-label mb-1">Layer 1 — disqualifiers</p>
          {result.triggered.length === 0 ? (
            <p className="text-muted">None ticked.</p>
          ) : (
            <ul className="space-y-0.5">
              {result.triggered.map((d) => (
                <li key={d.key} className="text-bad">
                  {d.label}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-muted">
            Checked against: {ICP_DISQUALIFIERS.length} hard disqualifiers.
          </p>
        </div>
        <ul className="divide-y divide-line/60 rounded-[10px] border border-line">
          {ICP_CATEGORIES.map((c) => {
            const value = answers[c.key];
            const option = c.options.find((o) => o.points === value);
            return (
              <li key={c.key} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block font-medium text-ink-soft">
                    {c.letter} — {c.title}
                  </span>
                  <span className="block text-muted">{option?.label ?? "Not answered"}</span>
                </span>
                <span className="num shrink-0 text-muted">
                  {value ?? 0} / {c.max}
                </span>
              </li>
            );
          })}
          <li className="flex items-start justify-between gap-3 px-3.5 py-2.5">
            <span className="min-w-0">
              <span className="block font-medium text-ink-soft">D — Automation Gap</span>
              <span className="block text-muted">
                {ICP_GAPS.filter((g) => answers[g.key])
                  .map((g) => g.label)
                  .join("; ") || "No gaps ticked"}
              </span>
            </span>
            <span className="num shrink-0 text-muted">
              {result.gapTotal} / {ICP_GAPS.length}
            </span>
          </li>
        </ul>
        {notes && notes.trim() !== "" && (
          <div>
            <p className="field-label mb-1">Scorecard notes</p>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-muted">{notes}</p>
          </div>
        )}
      </div>
    </details>
  );
}
