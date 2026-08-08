"use client";

// Process queue — the discovery chain, run in front of you.
//
// This is the one long-running thing in the app, and the design decision
// behind it is stated rather than hidden: it runs here, in this tab, one
// candidate at a time, for as long as the tab stays open. There is no job
// runner and this does not pretend to be one. The dialog says so before it
// starts anything, because a queue of forty candidates is forty enrichment
// runs and forty model calls billed to live accounts, and the person pressing
// the button is the one who should decide to spend that.
//
// So, unlike "Enrich this lead", opening this does not start it. The press
// opens a plan — what is queued, what it will cost in time, what closing the
// tab does — and a second press starts it. Everything after that is one server
// call per candidate, awaited in turn, with the result of each shown as it
// lands and the ones behind it still waiting.
//
// Stopping is honest about what it can do: the candidate in flight finishes on
// the server (its four actors are already running), and nothing after it
// starts. Every candidate the queue never reached is exactly as it was.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DISCOVERY_STATUS_LABELS,
  DiscoveryProcessResult,
  DiscoveryStep,
  DiscoveryStepStatus,
} from "@/lib/discovery";
import {
  BATCH_QUEUE_DESCRIPTION,
  defaultBatchLabel,
} from "@/lib/discoveryBatch";
import { ICP_MAX_SCORE, ICP_TIER_BANDS } from "@/lib/icp";
import { PipelineSettings } from "@/lib/pipelineSettings";
import CostEstimate from "@/components/CostEstimate";
import AiButton from "@/components/AiButton";

interface QueueItem {
  id: string;
  clinicName: string;
  state: "waiting" | "running" | "done";
  result: DiscoveryProcessResult | null;
}

export default function DiscoveryQueue({
  loadQueue,
  process,
  queued,
  settings,
}: {
  loadQueue: () => Promise<{ id: string; clinicName: string }[]>;
  process: (
    id: string,
    runBatchLabel?: string | null,
  ) => Promise<DiscoveryProcessResult>;
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

  return (
    <>
      <AiButton
        onClick={() => setOpen(true)}
        disabled={queued === 0}
        className="disabled:cursor-not-allowed disabled:opacity-50"
      >
        Process queue{queued > 0 && <span className="num">({queued})</span>}
      </AiButton>
      {open && (
        <QueueDialog
          loadQueue={loadQueue}
          process={process}
          queued={queued}
          settings={settings}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function QueueDialog({
  loadQueue,
  process,
  queued,
  settings,
  onClose,
}: {
  loadQueue: () => Promise<{ id: string; clinicName: string }[]>;
  process: (
    id: string,
    runBatchLabel?: string | null,
  ) => Promise<DiscoveryProcessResult>;
  queued: number;
  settings: PipelineSettings;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"planning" | "running" | "finished">(
    "planning",
  );
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  // Read by the loop between candidates. A ref rather than state because the
  // loop is a single async function that captured its state on the way in —
  // it needs the value as it stands now, not as it stood when it started.
  const stopRequested = useRef(false);

  const start = useCallback(async () => {
    setError(null);
    setStopping(false);
    stopRequested.current = false;

    let queue: { id: string; clinicName: string }[];
    try {
      queue = await loadQueue();
    } catch {
      setError(
        "The queue could not be read. Check the server is still up and try again.",
      );
      return;
    }
    if (queue.length === 0) {
      setItems([]);
      setPhase("finished");
      return;
    }

    setItems(
      queue.map((c) => ({ ...c, state: "waiting" as const, result: null })),
    );
    setPhase("running");

    // One batch for this run, dated now, generated once rather than per
    // candidate — otherwise a queue that took two hours over midnight would
    // file its candidates under two different days. It only ever fills a gap
    // on a candidate that arrived without a batch; every import stamps its own.
    const runBatchLabel = defaultBatchLabel(new Date(), BATCH_QUEUE_DESCRIPTION);

    // One at a time, awaited. In parallel this would finish sooner and cost
    // the same, but four actor runs times eight candidates at once is a shape
    // of spending nobody can watch — and watching it is the point.
    for (const candidate of queue) {
      if (stopRequested.current) break;
      setItems((prev) =>
        prev.map((item) =>
          item.id === candidate.id ? { ...item, state: "running" } : item,
        ),
      );
      let result: DiscoveryProcessResult;
      try {
        result = await process(candidate.id, runBatchLabel);
      } catch {
        result = {
          id: candidate.id,
          clinicName: candidate.clinicName,
          status: "FAILED",
          headline:
            "The run could not be reached. Check the server is still up — this candidate is still queued.",
          total: null,
          tier: null,
          promotedLeadId: null,
          steps: [],
        };
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === candidate.id
            ? { ...item, state: "done", result }
            : item,
        ),
      );
    }

    setPhase("finished");
    // The list behind the dialog is showing statuses this just changed.
    router.refresh();
  }, [loadQueue, process, router]);

  // Escape closes, like the dialog it looks like — but not while the queue is
  // running. A stray keypress must not look like it stopped something that is
  // still spending money on the server.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "running") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  // The page behind a modal should not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const done = items.filter((i) => i.state === "done");
  const tally = {
    promoted: done.filter((i) => i.result?.status === "PROMOTED").length,
    rejected: done.filter((i) => i.result?.status === "REJECTED").length,
    failed: done.filter((i) => i.result?.status === "FAILED").length,
  };
  const unreached = items.filter((i) => i.state === "waiting").length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== "running") onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-title"
        className="card my-auto flex max-h-[88vh] w-full max-w-2xl flex-col"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
          <div className="min-w-0">
            <h2 id="queue-title" className="display text-lg font-semibold">
              Process queue
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Enrich, score and decide — every pending candidate, and every one
              that failed last time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "running"}
            aria-label="Close"
            className="btn-ghost h-[34px] shrink-0 px-3 text-base leading-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {/* The one thing this dialog must say, and it says it first. */}
          <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
            <p className="text-sm font-medium text-ink">
              This runs here, in this tab, while you watch it
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              It is not a background job. Each candidate takes an actor run per
              enabled step and a model call, in turn, so a few minutes each is
              normal. Close
              this tab, navigate away, or put the machine to sleep and the queue
              stops after whatever candidate is in flight — everything it never
              reached stays exactly as it is, and pressing this again picks up
              where it left off.
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
            candidates={phase === "planning" ? queued : items.length}
            settings={settings}
          />

          {phase === "planning" && (
            <ol className="space-y-2 text-xs leading-relaxed text-muted">
              <li>
                <span className="num font-medium text-ink">1.</span> Enrich —
                the same steps the lead page runs, from whatever URLs the
                candidate carries, and only the ones switched on in{" "}
                <Link
                  href="/pipeline/settings"
                  className="text-accent hover:underline"
                >
                  Pipeline Settings
                </Link>
                . A missing Facebook URL is searched for before the ads step,
                and a missing website before the crawler once nothing else has
                reported one — both saved back, so the next run needn&rsquo;t
                search again.
              </li>
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
                out of {ICP_MAX_SCORE}, band it — <span className="num">{ICP_TIER_BANDS}</span> — and store the whole
                breakdown.
              </li>
              <li>
                <span className="num font-medium text-ink">5.</span> Anything
                scoring{" "}
                <span className="num">{settings.promotionThreshold}</span> or
                more becomes a lead with its scorecard pre-filled; anything
                disqualified or under the bar is rejected with its reasoning
                kept. An actor that fails outright stops that candidate before
                anything is scored, and so does evidence too thin to attempt
                the card — two or more categories with nothing behind them is a
                Failed with the missing inputs named, not a low score.
              </li>
            </ol>
          )}

          {items.length > 0 && (
            <ul className="divide-y divide-line/60 rounded-[10px] border border-line">
              {items.map((item) => (
                <li key={item.id} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {item.clinicName}
                    </p>
                    <QueueChip item={item} />
                  </div>
                  {item.result && (
                    <>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        {item.result.headline}
                        {item.result.total != null && (
                          <span className="num">
                            {" "}
                            ({item.result.total}/{ICP_MAX_SCORE})
                          </span>
                        )}
                      </p>
                      {item.result.steps.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {item.result.steps.map((step, i) => (
                            <StepLine key={i} step={step} />
                          ))}
                        </ul>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.result.promotedLeadId && (
                          <Link
                            href={`/pipeline/${item.result.promotedLeadId}`}
                            className="text-xs text-accent hover:underline"
                          >
                            Open the lead →
                          </Link>
                        )}
                        <Link
                          href={`/discovery/${item.id}`}
                          className="text-xs text-accent hover:underline"
                        >
                          Open the candidate →
                        </Link>
                      </div>
                    </>
                  )}
                  {item.state === "running" && (
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Running the chain — four actors and a model call, in turn.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {phase === "finished" && (
            <p className="num text-xs leading-relaxed text-muted">
              {items.length === 0
                ? "Nothing was queued — every candidate has already been through the chain."
                : `${done.length} processed — ${tally.promoted} promoted, ${tally.rejected} rejected, ${tally.failed} failed.`}
              {unreached > 0 &&
                ` ${unreached} not reached, still queued for next time.`}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/60 px-6 py-4">
          {phase === "running" ? (
            <button
              type="button"
              onClick={() => {
                stopRequested.current = true;
                setStopping(true);
              }}
              disabled={stopping}
              className="btn disabled:cursor-not-allowed disabled:opacity-50"
            >
              {stopping ? "Stopping after this one…" : "Stop after this one"}
            </button>
          ) : phase === "finished" ? (
            /* Run again stays the plain button it has always been: once the
               batch has finished the emphasis belongs to Done, and a lit AI
               pill beside it would fight over that. */
            <button type="button" onClick={() => void start()} className="btn">
              Run again
            </button>
          ) : (
            /* Start is the press that actually spends the model calls — the
               dialog above it is the plan, this is the commit — so it wears
               the AI button in place of the primary one. */
            <AiButton onClick={() => void start()}>Start</AiButton>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "running"}
            className={`${phase === "finished" ? "btn-primary" : "btn-ghost"} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {phase === "running" ? "Running…" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Where this candidate got to, in one word. Same colour convention the
// enrichment panel uses: green for a result, amber for one that landed
// somewhere short of it, red for a failure, neutral for not started.
function QueueChip({ item }: { item: QueueItem }) {
  const [label, cls]: [string, string] =
    item.state === "waiting"
      ? ["Queued", "bg-line/70 text-muted"]
      : item.state === "running"
        ? ["Running…", "bg-[#E8F0FE] text-accent"]
        : item.result?.status === "PROMOTED"
          ? ["Promoted", "bg-ok-soft text-ok"]
          : item.result?.status === "REJECTED"
            ? ["Rejected", "bg-warn-soft text-warn"]
            : ["Failed", "bg-bad-soft text-bad"];
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${cls}`}
      title={
        item.result ? DISCOVERY_STATUS_LABELS[item.result.status] : undefined
      }
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
