"use client";

// Process queue — the discovery chain, run on the server while you watch.
//
// Opening this does not start it. The press opens a plan — what is queued,
// what it will cost, what to keep running — and a second press starts it.
// Everything after that is one server call per candidate, awaited in turn, by
// the job runner (src/lib/jobRunner.ts) rather than by this tab: leaving the
// page, refreshing it or closing the dialog does not stop the run, and the
// progress panel (JobProgress.tsx) shows each result as it lands, here, on
// the Discovery page, and behind the header pill on any page.
//
// What it runs is either everything pending or exactly what was ticked on the
// list below. Selection is the list's, shared through DiscoverySelection —
// tick nothing and this is the batch button it has always been; tick five and
// it says so on its face, quotes five in the estimate, and runs those five.
//
// Stopping is honest about what it can do: the candidate in flight finishes on
// the server (its four actors are already running), and nothing after it
// starts. Every candidate the queue never reached is exactly as it was.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DISCOVERY_STATUS_LABELS,
  DiscoveryProcessResult,
  DiscoveryStep,
  DiscoveryStepStatus,
} from "@/lib/discovery";
import { ICP_MAX_SCORE, ICP_TIER_BANDS } from "@/lib/icp";
import { FIT_FLOOR, FIT_MAX, SIGNALS_MAX } from "@/lib/icpWeights";
import { V2_TIER_BANDS } from "@/lib/icpScoring";
import { PipelineSettings, estimateQueueCost, fmtEstimate } from "@/lib/pipelineSettings";
import CostEstimate from "@/components/CostEstimate";
import AiButton from "@/components/AiButton";
import { createPortal } from "react-dom";
import useDialogMotion from "@/components/useDialogMotion";
import { useDiscoverySelection } from "@/components/DiscoverySelection";
import { JobProgressPanel, useJobRun } from "@/components/JobProgress";

type StartQueue = (
  selectedIds: string[] | null,
) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;


export default function DiscoveryQueue({
  start,
  queued,
  settings,
}: {
  // Starts the run on the server: the ticked ids, or null for the whole
  // pending queue. The queue is re-read there at the moment it starts rather
  // than trusted from a page that may be an hour old.
  start: StartQueue;
  // What the page counted when it rendered. Only ever a label on the button —
  // the queue itself is re-read at the moment it starts, because a list that
  // has sat open for an hour is not the queue any more.
  queued: number;
  // Which steps are on, for the estimate. The run itself reads the settings
  // again on the server, per candidate — these are for the sentence the dialog
  // shows before anything is spent.
  settings: PipelineSettings;
}) {
  const [open, setOpen] = useState(false);
  const { selectedQueueable } = useDiscoverySelection();
  const scoped = selectedQueueable.length > 0;
  // What this press would run. With a selection it is the ticked candidates
  // the chain has work to do on; without one it is the whole pending queue,
  // as counted by the page.
  const count = scoped ? selectedQueueable.length : queued;
  const { job } = useJobRun("process-queue");
  const running = job?.status === "running";

  return (
    <>
      <AiButton
        onClick={() => setOpen(true)}
        disabled={count === 0 && !running}
        title={
          scoped
            ? "Run the chain on the candidates you have selected"
            : undefined
        }
        className="disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running && job ? (
          <span className="num">
            Processing {job.done}/{job.total}
          </span>
        ) : (
          <>
            Process queue{scoped && " (selected)"}
            {count > 0 && <span className="num">({count})</span>}
          </>
        )}
      </AiButton>
      {open && (
        <QueueDialog
          start={start}
          selectedIds={scoped ? selectedQueueable : null}
          queued={count}
          settings={settings}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function QueueDialog({
  start,
  selectedIds,
  queued,
  settings,
  onClose,
}: {
  start: StartQueue;
  // The ticked candidates, or null for the whole pending queue. Captured when
  // the dialog opened: a selection that changed underneath a plan somebody is
  // reading is not a plan they agreed to.
  selectedIds: string[] | null;
  queued: number;
  settings: PipelineSettings;
  onClose: () => void;
}) {
  // Opening is CSS; closing has to be sequenced, or the dialog would be
  // unmounted mid-fade. `close` plays the exit and then calls onClose —
  // every dismissal below goes through it rather than through onClose.
  const { close, scrimClass, dialogClass } = useDialogMotion(onClose);
  const { job, track } = useJobRun("process-queue");
  // The run this dialog is showing: one already live when it opened, or the
  // one started from it. An old finished run is not this dialog's business —
  // opening it again is for planning the next one.
  const [runId, setRunId] = useState<string | null>(
    job?.status === "running" ? job.id : null,
  );
  const shown = job && job.id === runId ? job : null;
  const phase: "planning" | "running" | "finished" = !shown
    ? "planning"
    : shown.status === "running"
      ? "running"
      : "finished";
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [results, setResults] = useState<DiscoveryProcessResult[] | null>(null);

  const begin = useCallback(async () => {
    setError(null);
    setResults(null);
    setStarting(true);
    const started = await start(selectedIds).catch(() => ({
      ok: false as const,
      error: "The queue could not be started. Check the server is still up and try again.",
    }));
    setStarting(false);
    if (!started.ok) {
      setError(started.error);
      return;
    }
    setRunId(started.id);
    track(started.id);
  }, [start, selectedIds, track]);

  // Once the run is over, every candidate's full result — the per-step lines
  // and the links — for the list under the panel.
  const finishedId = phase === "finished" ? runId : null;
  useEffect(() => {
    if (!finishedId) return;
    let cancelled = false;
    fetch(`/api/jobs/results?id=${encodeURIComponent(finishedId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { results: { result: unknown }[] } | null) => {
        if (cancelled || !body) return;
        setResults(
          body.results
            .map((r) => r.result as DiscoveryProcessResult | null)
            .filter((r): r is DiscoveryProcessResult => r !== null),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [finishedId]);

  // Escape closes, like the dialog it looks like. Closing never stops a run —
  // it carries on on the server, and the header pill and the Discovery page
  // keep showing it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // The page behind a modal should not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const tally = results && {
    promoted: results.filter((r) => r.status === "PROMOTED").length,
    rejected: results.filter((r) => r.status === "REJECTED").length,
    failed: results.filter((r) => r.status === "FAILED").length,
  };

  // Portalled to <body>: on a phone this dialog can be opened from a page's
  // ⋯ actions sheet (PageActions), which hides itself as the dialog opens.
  return createPortal(
    <div
      className={`${scrimClass} dialog-scrim fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-ink/25 p-4 sm:p-8`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-title"
        className={`${dialogClass} dialog-sheet card my-auto flex max-h-[88dvh] w-full max-w-2xl flex-col`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
          <div className="min-w-0">
            <h2 id="queue-title" className="display text-lg font-semibold">
              Process queue{selectedIds && " (selected)"}
            </h2>
            <p className="helper-text mt-0.5 text-xs leading-relaxed text-muted">
              {selectedIds
                ? "Enrich, score and decide — only the candidates you selected. Everything else stays queued."
                : "Enrich, score and decide — every pending candidate, and every one that failed last time."}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="btn-ghost h-[34px] shrink-0 px-3 text-base leading-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {/* Pro: the whole plan in one line — how many, what it costs, and
              the warning. The cost and the Mac are information, so they
              stay. */}
          <p className="pro-only rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3 text-sm font-medium text-ink">
            <span className="num">
              {phase === "planning" &&
                `Process ${queued} candidate${queued === 1 ? "" : "s"} · ${fmtEstimate(estimateQueueCost(queued, settings))} · `}
            </span>
            Runs in the background. Keep your Mac awake.
          </p>

          {/* The one thing this dialog must say, and it says it first. */}
          <div className="guided-only rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
            <p className="text-sm font-medium text-ink">
              This runs on the server — keep your Mac awake until it finishes
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Each candidate takes an actor run per enabled step and a model
              call, in turn, so a few minutes each is normal. Closing this
              dialog, leaving the page or refreshing does not stop it — the
              header shows its progress from any page. Shut the app down or let
              the Mac sleep and the queue stops after whatever candidate is in
              flight; everything it never reached stays exactly as it is, and
              pressing this again picks up where it left off.
            </p>
          </div>
          {error && (
            <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
              <p className="text-sm font-medium text-bad">
                The queue didn’t start
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {error}
              </p>
            </div>
          )}

          {/* What it will cost, before the press that spends it. Quoted
              against the count the page had while planning, and against the
              queue as actually read once it has been — the second is the real
              number, and it is the one left on screen afterwards. */}
          <CostEstimate
            candidates={shown ? shown.total : queued}
            settings={settings}
            className="guided-only"
          />

          {phase === "planning" && (
            <ol className="helper-text space-y-2 text-xs leading-relaxed text-muted">
              <li>
                <span className="num font-medium text-ink">1.</span> Enrich —
                the same steps the lead page runs, from whatever URLs the
                candidate carries, and only the ones switched on in{" "}
                <Link
                  href="/settings/pipeline"
                  className="text-accent hover:underline"
                >
                  Pipeline settings
                </Link>
                . A missing Facebook URL is searched for before the ads step,
                and a missing website before the crawler once nothing else has
                reported one — both saved back, so the next run needn&rsquo;t
                search again.
              </li>
              {settings.scoringModel === "v2" ? (
                <>
                  <li>
                    <span className="num font-medium text-ink">2.</span> Check
                    there is enough to judge fit. No website copy is Failed, not
                    rejected — unless the clinic&rsquo;s own Maps listing shows it
                    has no site.
                  </li>
                  <li>
                    <span className="num font-medium text-ink">3.</span> Ask
                    DeepSeek for cited findings against the active ICP:
                    disqualifiers, services, decision-maker, location, size,
                    buying triggers, payment model and the three automation
                    gaps. Every quote is checked word for word against the
                    evidence before it counts.
                  </li>
                  <li>
                    <span className="num font-medium text-ink">4.</span> Any
                    cited disqualifier scores 0. Otherwise fit out of {FIT_MAX}{" "}
                    plus signals out of {SIGNALS_MAX}, banded{" "}
                    <span className="num">{V2_TIER_BANDS}</span>.
                  </li>
                  <li>
                    <span className="num font-medium text-ink">5.</span> Fit
                    under <span className="num">{FIT_FLOOR}</span> is rejected
                    as not a confirmed fit. Anything scoring{" "}
                    <span className="num">{settings.promotionThresholdV2}</span>{" "}
                    or more becomes a lead with its scorecard attached — a
                    chiropractic-first clinic only with a real program, two of
                    five cited signals.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <span className="num font-medium text-ink">2.</span> Score Staff
                    Size Fit and Budget Signal from the data, with no model
                    involved.
                  </li>
                  <li>
                    <span className="num font-medium text-ink">3.</span> Ask
                    DeepSeek for the five hard disqualifiers, Package/Economics, and
                    the three Automation Gap boxes — each keyword pre-checked first,
                    each answered with a reason.
                  </li>
                  <li>
                    <span className="num font-medium text-ink">4.</span> Total it
                    out of {ICP_MAX_SCORE}, band it —{" "}
                    <span className="num">{ICP_TIER_BANDS}</span> — and store the
                    whole breakdown.
                  </li>
                  <li>
                    <span className="num font-medium text-ink">5.</span> Anything
                    scoring{" "}
                    <span className="num">{settings.promotionThreshold}</span> or
                    more becomes a lead with its scorecard pre-filled; anything
                    disqualified or under the bar is rejected with its reasoning
                    kept. An actor that fails outright stops that candidate before
                    anything is scored, and so does evidence too thin to attempt the
                    card — two or more categories with nothing behind them is a
                    Failed with the missing inputs named, not a low score.
                  </li>
                </>
              )}
            </ol>
          )}

          {shown && <JobProgressPanel job={shown} className="!shadow-none" />}

          {/* Every candidate's full result, once the run is over: the steps,
              and the way to the lead or the candidate. */}
          {phase === "finished" && results && results.length > 0 && (
            <ul className="divide-y divide-line/60 rounded-[10px] border border-line">
              {results.map((result) => (
                <li key={result.id} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {result.clinicName}
                    </p>
                    <QueueChip result={result} />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {result.headline}
                    {result.total != null && (
                      <span className="num">
                        {" "}
                        ({result.total}/{result.max ?? ICP_MAX_SCORE})
                      </span>
                    )}
                  </p>
                  {result.steps.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {result.steps.map((step, i) => (
                        <StepLine key={i} step={step} />
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.promotedLeadId && (
                      <Link
                        href={`/pipeline/${result.promotedLeadId}`}
                        className="text-xs text-accent hover:underline"
                      >
                        Open the lead →
                      </Link>
                    )}
                    <Link
                      href={`/discovery/${result.id}`}
                      className="text-xs text-accent hover:underline"
                    >
                      Open the candidate →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {phase === "finished" && tally && shown && (
            <p className="num text-xs leading-relaxed text-muted">
              {`${results?.length ?? 0} processed — ${tally.promoted} promoted, ${tally.rejected} rejected, ${tally.failed} failed.`}
              {shown.total - shown.done > 0 &&
                ` ${shown.total - shown.done} not reached, still queued for next time.`}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/60 px-6 py-4">
          {phase === "running" ? (
            /* Stop is on the panel above, with the progress it stops. */
            <span className="text-xs text-muted">
              Closing this won&rsquo;t stop the run.
            </span>
          ) : phase === "finished" ? (
            /* Run again stays the plain button it has always been: once the
               batch has finished the emphasis belongs to Done, and a lit AI
               pill beside it would fight over that. */
            <button
              type="button"
              onClick={() => void begin()}
              disabled={starting}
              className="btn disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run again
            </button>
          ) : (
            /* Start is the press that actually spends the model calls — the
               dialog above it is the plan, this is the commit — so it wears
               the AI button in place of the primary one. */
            <AiButton
              onClick={() => void begin()}
              disabled={starting}
              className="disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? "Starting…" : "Start"}
            </AiButton>
          )}
          <button
            type="button"
            onClick={close}
            className={phase === "planning" ? "btn-ghost" : "btn-primary"}
          >
            {phase === "running" ? "Close" : "Done"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Where this candidate got to, in one word. Same colour convention the
// enrichment panel uses: green for a result, amber for one that landed
// somewhere short of it, red for a failure.
function QueueChip({ result }: { result: DiscoveryProcessResult }) {
  const [label, cls]: [string, string] =
    result.status === "PROMOTED"
      ? ["Promoted", "bg-ok-soft text-ok"]
      : result.status === "REJECTED"
        ? ["Rejected", "bg-warn-soft text-warn"]
        : ["Failed", "bg-bad-soft text-bad"];
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${cls}`}
      title={DISCOVERY_STATUS_LABELS[result.status]}
    >
      {label}
    </span>
  );
}

const STEP_MARKS: Record<DiscoveryStepStatus, { mark: string; cls: string }> = {
  ok: { mark: "●", cls: "text-ok" },
  warned: { mark: "●", cls: "text-warn" },
  failed: { mark: "●", cls: "text-bad" },
  skipped: { mark: "○", cls: "text-muted" },
};

function StepLine({ step }: { step: DiscoveryStep }) {
  const mark = STEP_MARKS[step.status];
  return (
    <li className="flex gap-2 text-xs leading-relaxed">
      <span className={`shrink-0 ${mark.cls}`} aria-hidden>
        {mark.mark}
      </span>
      <span className="w-[190px] shrink-0 text-muted">{step.label}</span>
      <span className="min-w-0 flex-1 break-words text-muted">
        {step.detail}
      </span>
    </li>
  );
}
