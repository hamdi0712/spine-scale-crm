import Link from "next/link";
import { loadActiveIcp } from "@/lib/icpDefinitionStore";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { getDeepseekApiKey } from "@/lib/appSecretsStore";
import { estimateScoringCostUsd } from "@/lib/icpScoringAssist";
import { fmtEstimate } from "@/lib/pipelineSettings";
import { IcpTier } from "@/lib/icp";
import { parseBreakdownV2 } from "@/lib/icpScoring";
import { FIT_FLOOR, FIT_MAX, V2_MAX_SCORE } from "@/lib/icpWeights";
import {
  COMPARISON_OUTCOME_LABELS,
  COMPARISON_OUTCOME_MEANINGS,
  ComparisonOutcome,
} from "@/lib/scoringComparison";
import {
  latestComparisonRun,
  loadComparisonSubjects,
} from "@/lib/scoringComparisonStore";
import {
  compareOneSubject,
  finishScoringComparison,
  startScoringComparison,
} from "@/lib/actions/scoringComparison";
import { setScoringModel } from "@/lib/actions/pipelineSettings";
import { fmtDateTime } from "@/lib/format";
import { IcpTierBadge } from "@/components/Badge";
import ScoringComparisonRunner from "@/components/ScoringComparisonRunner";
import ApplyScoringModel from "@/components/ApplyScoringModel";
import IcpBreakdownV2View from "@/components/IcpBreakdownV2View";

export const dynamic = "force-dynamic";

// Compare scoring — what the new model would do to everything already decided,
// before anything switches.
//
// The page is three things in the order they are used: the dry run (cost
// first, then the button), the switch it unlocks, and the last run's report,
// grouped by what would change. The report is the reason the switch exists:
// it is meant to be read, row by row, before "Apply new scoring" is pressed.
const GROUP_ORDER: ComparisonOutcome[] = [
  "newly_rejected",
  "newly_promoted",
  "newly_held",
  "newly_failed",
  "unchanged",
];

export default async function CompareScoringPage() {
  const [icp, settings, subjects, run, key] = await Promise.all([
    loadActiveIcp(),
    loadPipelineSettings(),
    loadComparisonSubjects(),
    latestComparisonRun(),
    getDeepseekApiKey(),
  ]);

  const estimateUsd = icp
    ? subjects.reduce((sum, s) => sum + estimateScoringCostUsd(s.evidence, icp), 0)
    : 0;
  const modelCalls = icp
    ? subjects.filter((s) => estimateScoringCostUsd(s.evidence, icp) > 0).length
    : 0;
  const estimate = `${fmtEstimate(estimateUsd)} in DeepSeek usage (${modelCalls} call${modelCalls === 1 ? "" : "s"})`;

  const disabledReason = !icp
    ? "No ICP Definition is active — switch one on under Settings → ICP first."
    : !key
      ? "No DeepSeek API key is set — add one under Settings → API Keys."
      : subjects.length === 0
        ? "There is nothing to compare yet."
        : null;

  const lastComplete = run?.completedAt ?? null;
  const canApply = run !== null && lastComplete !== null && icp !== null;
  const lockedReason = !run
    ? "Locked until a comparison has run to the end."
    : !lastComplete
      ? "Locked — the last comparison did not finish. Run it again to the end."
      : !icp
        ? "Locked — no ICP Definition is active."
        : null;

  const rows = run?.rows ?? [];
  const groups = GROUP_ORDER.map((outcome) => ({
    outcome,
    rows: rows.filter((r) => r.outcome === outcome),
  }));
  const errors = rows.filter((r) => r.outcome === "error");

  return (
    <div className="max-w-5xl">
      <div>
        <Link href="/discovery" className="text-sm text-accent hover:underline">
          ← Discovery
        </Link>
        <h1 className="display mt-2 text-[32px] font-semibold">Compare scoring</h1>
        <p className="helper-text mt-1.5 text-sm text-muted">
          What the ICP model would do to every clinic already promoted or
          rejected — before anything switches
        </p>
      </div>

      <div className="mt-6 grid gap-4">
        <div className="card px-6 py-4 max-md:px-4">
          <p className="text-sm">
            Judged against{" "}
            {icp ? (
              <Link href={`/settings/icp/${icp.id}`} className="font-medium text-accent hover:underline">
                {icp.name}
              </Link>
            ) : (
              <span className="font-medium text-bad">no active ICP</span>
            )}
            <span className="num text-muted">
              {" "}
              · promotion bar {settings.promotionThresholdV2}/{V2_MAX_SCORE} · fit floor{" "}
              {FIT_FLOOR}/{FIT_MAX}
            </span>
          </p>
          <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
            The bar is under{" "}
            <Link href="/settings/pipeline" className="text-accent hover:underline">
              Settings → Pipeline
            </Link>
            ; the weights and the floor are in{" "}
            <code className="rounded bg-wash/70 px-1 py-0.5 font-mono text-[11px]">
              src/lib/icpWeights.ts
            </code>
            .
          </p>
        </div>

        <ScoringComparisonRunner
          estimate={estimate}
          subjects={subjects.length}
          disabledReason={disabledReason}
          start={startScoringComparison}
          compareOne={compareOneSubject}
          finish={finishScoringComparison}
        />

        <ApplyScoringModel
          model={settings.scoringModel}
          canApply={canApply}
          lockedReason={lockedReason}
          setModel={setScoringModel}
        />
      </div>

      {run && (
        <section className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="display text-xl font-semibold">Last comparison</h2>
            <p className="num text-xs text-muted">
              {fmtDateTime(run.startedAt)} · against “{run.icpName}” · bar {run.threshold} ·{" "}
              {rows.length} of {run.subjects} scored ·{" "}
              {run.completedAt ? "finished" : "did not finish"} · estimated{" "}
              {fmtEstimate(run.estimatedUsd)}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {groups.map((g) => (
              <a
                key={g.outcome}
                href={`#${g.outcome}`}
                className="num inline-flex h-[30px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs text-ink-soft hover:bg-wash/70"
              >
                {COMPARISON_OUTCOME_LABELS[g.outcome]}
                <span className="font-semibold">{g.rows.length}</span>
              </a>
            ))}
            {errors.length > 0 && (
              <span className="num inline-flex h-[30px] items-center rounded-full bg-bad-soft px-3 text-xs text-bad">
                Errors {errors.length}
              </span>
            )}
          </div>

          <div className="mt-6 space-y-8">
            {groups.map((g) => (
              <GroupSection key={g.outcome} outcome={g.outcome} rows={g.rows} />
            ))}
            {errors.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-bad">Could not be scored</h3>
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {errors.map((r) => (
                    <li key={r.id}>
                      <span className="font-medium text-ink-soft">{r.clinicName}</span> — {r.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

type Row = NonNullable<Awaited<ReturnType<typeof latestComparisonRun>>>["rows"][number];

function GroupSection({ outcome, rows }: { outcome: ComparisonOutcome; rows: Row[] }) {
  const list = (
    <ul className="mt-3 space-y-3">
      {rows.map((row) => (
        <ComparisonRow key={row.id} row={row} />
      ))}
    </ul>
  );
  return (
    <div id={outcome} className="scroll-mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          {COMPARISON_OUTCOME_LABELS[outcome]} <span className="num text-muted">({rows.length})</span>
        </h3>
      </div>
      <p className="helper-text mt-0.5 text-xs leading-relaxed text-muted">
        {COMPARISON_OUTCOME_MEANINGS[outcome]}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted">None.</p>
      ) : outcome === "unchanged" ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-accent hover:underline">
            Show all {rows.length}
          </summary>
          {list}
        </details>
      ) : (
        list
      )}
    </div>
  );
}

function ComparisonRow({ row }: { row: Row }) {
  const breakdown = parseBreakdownV2(row.breakdown);
  const href = row.subjectKind === "lead" ? `/pipeline/${row.subjectId}` : `/discovery/${row.subjectId}`;
  return (
    <li className="card">
      <div className="px-5 py-4 max-md:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={href} className="min-w-0 truncate text-sm font-medium hover:underline">
            {row.clinicName}
          </Link>
          <span className="text-xs text-muted">{row.subjectKind === "lead" ? "Lead" : "Candidate"}</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Standing
            heading="Today"
            label={row.oldStatus}
            score={row.oldScore}
            max={row.oldMax}
            tier={(row.oldTier as IcpTier | null) ?? null}
          />
          <Standing
            heading="New model"
            label={row.newStatus}
            score={row.newScore}
            max={row.newScore === null ? null : V2_MAX_SCORE}
            tier={(row.newTier as IcpTier | null) ?? null}
          />
        </div>
        {row.flipReason && (
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">{row.flipReason}</p>
        )}
      </div>
      {breakdown && (
        <details className="border-t border-line/60">
          <summary className="cursor-pointer px-5 py-2.5 text-xs text-accent hover:underline max-md:px-4">
            Show the new breakdown
          </summary>
          <IcpBreakdownV2View breakdown={breakdown} />
        </details>
      )}
    </li>
  );
}

function Standing({
  heading,
  label,
  score,
  max,
  tier,
}: {
  heading: string;
  label: string;
  score: number | null;
  max: number | null;
  tier: IcpTier | null;
}) {
  return (
    <div className="rounded-[10px] border border-line px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">{heading}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-soft">{label}</span>
        {score !== null && max !== null && (
          <span className="num text-xs text-muted">
            {score}/{max}
          </span>
        )}
        <IcpTierBadge tier={tier} />
      </div>
    </div>
  );
}
