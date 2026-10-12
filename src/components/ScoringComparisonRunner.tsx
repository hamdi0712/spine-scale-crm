"use client";

// Runs Compare scoring one record at a time, in the foreground, the same way
// Process queue runs: the cost is quoted before the press, every result is
// shown as it lands, Stop finishes the record in flight and goes no further,
// and closing the tab stops it too. Nothing it does changes a record — the
// results go to the comparison report below, which reloads when the run ends.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AiButton from "@/components/AiButton";
import {
  COMPARISON_OUTCOME_LABELS,
  ComparisonOutcome,
  ComparisonSubject,
} from "@/lib/scoringComparison";

type RowView = {
  clinicName: string;
  outcome: ComparisonOutcome | "error";
  oldLabel: string;
  newLabel: string;
  newScore: number | null;
  reason: string | null;
};

// Three model errors in a row is a key, an account or an outage — not three
// clinics. The run stops rather than spending its way through the rest.
const MAX_CONSECUTIVE_ERRORS = 3;

export default function ScoringComparisonRunner({
  estimate,
  subjects,
  disabledReason,
  start,
  compareOne,
  finish,
}: {
  estimate: string;
  subjects: number;
  disabledReason: string | null;
  start: () => Promise<
    { ok: true; runId: string; subjects: ComparisonSubject[] } | { ok: false; error: string }
  >;
  compareOne: (runId: string, kind: string, id: string) => Promise<RowView>;
  finish: (
    runId: string,
  ) => Promise<{ complete: boolean; scored: number; errors: number; subjects: number }>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running" | "finished">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RowView[]>([]);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const stopRequested = useRef(false);

  async function run() {
    if (phase === "running") return;
    if (
      !confirm(
        `Compare scoring rescores ${subjects} record${subjects === 1 ? "" : "s"} from stored enrichment — one DeepSeek call each, ${estimate}. No Apify runs, and no status changes. Start?`,
      )
    ) {
      return;
    }
    setError(null);
    setSummary(null);
    setDone([]);
    stopRequested.current = false;
    setPhase("running");

    let started;
    try {
      started = await start();
    } catch {
      started = { ok: false as const, error: "The comparison could not be started. Check the server is still up." };
    }
    if (!started.ok) {
      setError(started.error);
      setPhase("idle");
      return;
    }
    setTotal(started.subjects.length);

    let consecutiveErrors = 0;
    let stoppedOnErrors = false;
    for (const subject of started.subjects) {
      if (stopRequested.current) break;
      setCurrent(subject.clinicName);
      let row: RowView;
      try {
        row = await compareOne(started.runId, subject.kind, subject.id);
      } catch {
        row = {
          clinicName: subject.clinicName,
          outcome: "error",
          oldLabel: "",
          newLabel: "",
          newScore: null,
          reason: "The server could not be reached for this one.",
        };
      }
      setDone((prev) => [...prev, row]);
      consecutiveErrors = row.outcome === "error" ? consecutiveErrors + 1 : 0;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        stoppedOnErrors = true;
        break;
      }
    }
    setCurrent(null);

    const result = await finish(started.runId).catch(() => null);
    setPhase("finished");
    if (!result) {
      setSummary("The run ended, but its results could not be totalled. Reload the page.");
    } else if (result.complete) {
      setSummary(`Finished — all ${result.subjects} scored. The report below is this run.`);
    } else {
      setSummary(
        stoppedOnErrors
          ? `Stopped after ${MAX_CONSECUTIVE_ERRORS} DeepSeek errors in a row — fix what they say and run it again. A partial run does not unlock Apply.`
          : `Stopped with ${result.scored} of ${result.subjects} scored${result.errors > 0 ? ` and ${result.errors} error${result.errors === 1 ? "" : "s"}` : ""}. A partial run does not unlock Apply — run it again to the end.`,
      );
    }
    router.refresh();
  }

  const counts = done.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="card-ai p-6 max-md:p-4">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div className="min-w-0">
          <p className="text-sm font-medium">Run the dry run</p>
          <p className="num mt-1 text-sm">
            {subjects} record{subjects === 1 ? "" : "s"} · {estimate}
          </p>
          <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
            One DeepSeek call per record, from the enrichment already stored on
            it. No Apify runs, and nothing on any candidate or lead changes. The
            estimate is measured off the prompts these records would actually
            send; records with too little evidence to judge cost nothing.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {phase === "running" ? (
            <button type="button" className="btn" onClick={() => (stopRequested.current = true)}>
              Stop
            </button>
          ) : (
            <AiButton onClick={() => void run()} disabled={disabledReason !== null || subjects === 0} className="disabled:cursor-not-allowed disabled:opacity-50">
              Compare scoring
            </AiButton>
          )}
        </div>
      </div>

      {disabledReason && <p className="mt-3 text-xs leading-relaxed text-bad">{disabledReason}</p>}
      {error && (
        <div className="mt-3 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
          <p className="text-sm font-medium text-bad">The comparison didn’t start</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{error}</p>
        </div>
      )}

      {(phase === "running" || phase === "finished") && total > 0 && (
        <div className="mt-4 space-y-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-line/70">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round((done.length / total) * 100)}%` }}
            />
          </div>
          <p className="num text-xs text-muted">
            {done.length} of {total}
            {current ? ` · scoring ${current}…` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(counts).map(([outcome, n]) => (
              <span key={outcome} className="num inline-flex h-[24px] items-center rounded-full bg-wash px-2.5 text-xs text-muted">
                {outcome === "error" ? "Errors" : COMPARISON_OUTCOME_LABELS[outcome as ComparisonOutcome]}: {n}
              </span>
            ))}
          </div>
          {done.filter((r) => r.outcome === "error").slice(-1).map((r, i) => (
            <p key={i} className="text-xs leading-relaxed text-bad">
              {r.clinicName}: {r.reason}
            </p>
          ))}
          {summary && <p className="text-sm">{summary}</p>}
        </div>
      )}
    </div>
  );
}
