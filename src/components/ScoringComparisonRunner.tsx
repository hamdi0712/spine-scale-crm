"use client";

// Runs Compare scoring one record at a time on the server, the same way
// Process queue runs: the cost is quoted before the press, every result is
// shown as it lands, and Stop finishes the record in flight and goes no
// further. Leaving the page does not stop it — the panel below polls the run
// (JobProgress.tsx). Nothing it does changes a record — the results go to the
// comparison report below, which reloads when the run ends.

import { useState } from "react";
import AiButton from "@/components/AiButton";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";
import { confirmText } from "@/lib/displayMode";

export default function ScoringComparisonRunner({
  estimate,
  subjects,
  disabledReason,
  start,
}: {
  estimate: string;
  subjects: number;
  disabledReason: string | null;
  start: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
}) {
  const { running, track } = useJobRun("compare-scoring");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function run() {
    if (running || starting) return;
    if (
      !confirm(
        confirmText(
          `Compare scoring rescores ${subjects} record${subjects === 1 ? "" : "s"} from stored enrichment — one DeepSeek call each, ${estimate}. No Apify runs, and no status changes. Start?`,
          `Rescore ${subjects} record${subjects === 1 ? "" : "s"}? · ${estimate}`,
        ),
      )
    ) {
      return;
    }
    setError(null);
    setStarting(true);
    const started = await start().catch(() => ({
      ok: false as const,
      error: "The comparison could not be started. Check the server is still up.",
    }));
    setStarting(false);
    if (!started.ok) {
      setError(started.error);
      return;
    }
    track(started.id);
  }

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
          <AiButton
            onClick={() => void run()}
            disabled={disabledReason !== null || subjects === 0 || running || starting}
            className="disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Comparing…" : "Compare scoring"}
          </AiButton>
        </div>
      </div>

      {disabledReason && <p className="mt-3 text-xs leading-relaxed text-bad">{disabledReason}</p>}
      {error && (
        <div className="mt-3 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
          <p className="text-sm font-medium text-bad">The comparison didn’t start</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{error}</p>
        </div>
      )}

      <JobProgressFor source="compare-scoring" className="mt-4" />
    </div>
  );
}
