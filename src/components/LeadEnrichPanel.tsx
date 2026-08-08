"use client";

// Enrich this lead — one press, four actors, run from what the lead already
// carries, plus the Facebook page lookup in front of the ads actor when the
// lead has no Facebook URL for it to run on.
//
// There is nothing to fill in here, which is the point of it: the actor IDs
// are fixed (src/lib/leadEnrich.ts) and every input is built from a field on
// the lead, so pressing the button is the whole interaction. The dialog exists
// to say what is happening and to report what came back — which actors ran,
// which were skipped and for want of what, which failed, and what got written.
//
// The one thing it asks about is identity. When a company lookup or a Maps
// search comes back with several candidate clinics, that actor's fields are
// left unwritten and the candidates are listed to pick from, because writing
// another clinic's review count onto this lead is the one mistake here that
// would look like a fact afterwards.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ENRICH_FIELD_LABELS,
  EnrichActorKey,
  EnrichOutcome,
  EnrichPlanEntry,
  EnrichRunResult,
} from "@/lib/leadEnrich";

export default function LeadEnrichPanel({
  run,
  applySelection,
  plan,
  clinicName,
}: {
  run: () => Promise<EnrichRunResult>;
  applySelection: (
    actorKey: string,
    headers: string[],
    row: string[],
  ) => Promise<EnrichRunResult>;
  plan: EnrichPlanEntry[];
  clinicName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn">
        Enrich this lead
      </button>
      {open && (
        <EnrichDialog
          run={run}
          applySelection={applySelection}
          plan={plan}
          clinicName={clinicName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Mounted only while open, and starts the run on mount — the press was the
// instruction, so a dialog that opened and then waited to be told again would
// be asking twice.
function EnrichDialog({
  run,
  applySelection,
  plan,
  clinicName,
  onClose,
}: {
  run: () => Promise<EnrichRunResult>;
  applySelection: (
    actorKey: string,
    headers: string[],
    row: string[],
  ) => Promise<EnrichRunResult>;
  plan: EnrichPlanEntry[];
  clinicName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(true);
  const [result, setResult] = useState<EnrichRunResult | null>(null);
  const [applying, setApplying] = useState<EnrichActorKey | null>(null);

  const start = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const next = await run();
      setResult(next);
      // The page behind the dialog is showing values this may have just
      // changed.
      if (next.written.length > 0) router.refresh();
    } catch {
      setResult({
        outcomes: [],
        written: [],
        enrichedAt: null,
        error:
          "The run could not be reached. Check the server is still up and try again.",
      });
    } finally {
      setRunning(false);
    }
  }, [run, router]);

  // Once per open, and never again on its own.
  //
  // The guard is load-bearing, not tidiness. A finished run refreshes the page
  // behind the dialog, which re-renders this component's parent, which hands
  // it a freshly bound `run` — a new function identity every time. Without the
  // ref, that new identity re-fires this effect, which starts another run,
  // which refreshes again: four actors billed per lap, forever, from one
  // press. Re-running is a thing the user asks for with the button below.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  // Escape closes, like the dialog it looks like. A run already under way
  // finishes on the server and writes what it could — closing gives up the
  // report, not the work.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The page behind a modal should not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function choose(
    key: EnrichActorKey,
    headers: string[],
    row: string[],
  ) {
    setApplying(key);
    try {
      const applied = await applySelection(key, headers, row);
      setResult((prev) => mergeSelection(prev, applied, key));
      if (applied.written.length > 0) router.refresh();
    } catch {
      setResult((prev) =>
        replaceOutcome(prev, key, {
          key,
          status: "failed",
          detail:
            "That selection could not be saved. Check the server is still up and try again.",
        }),
      );
    } finally {
      setApplying(null);
    }
  }

  function dismiss(key: EnrichActorKey) {
    setResult((prev) =>
      replaceOutcome(prev, key, {
        key,
        status: "empty",
        detail: "left alone — none of the matches was this clinic",
      }),
    );
  }

  const runnable = plan.filter((p) => p.willRun);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrich-title"
        className="card my-auto flex max-h-[88vh] w-full max-w-2xl flex-col"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
          <div className="min-w-0">
            <h2 id="enrich-title" className="display text-lg font-semibold">
              Enrich this lead
            </h2>
            <p className="mt-0.5 truncate text-xs leading-relaxed text-muted">
              {clinicName} — {runnable.length} step
              {runnable.length === 1 ? "" : "s"}, run from this lead’s own
              fields. Nothing new is created.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost h-[34px] shrink-0 px-3 text-base leading-none"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {running && (
            <p className="text-xs leading-relaxed text-muted">
              {runnable.length === 0
                ? "Checking what this lead has to run on…"
                : `Running ${runnable.length} actor${runnable.length === 1 ? "" : "s"} in turn — each one can take a couple of minutes. Anything already written stays written if you close this.`}
            </p>
          )}

          {result?.error && (
            <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
              <p className="text-sm font-medium text-bad">
                The run didn’t start
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {result.error}
              </p>
            </div>
          )}

          {/* One row per actor, always — while the run is going they read from
              the plan, and afterwards from what actually happened. An actor
              that did nothing still says which nothing it did. */}
          <ul className="divide-y divide-line/60 rounded-[10px] border border-line">
            {plan.map((entry) => {
              const outcome = result?.outcomes.find((o) => o.key === entry.key);
              return (
                <li key={entry.key} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {entry.label}
                      </p>
                      <p className="truncate font-mono text-xs text-muted">
                        {entry.actorId}
                      </p>
                    </div>
                    <StatusChip
                      running={running}
                      willRun={entry.willRun}
                      outcome={outcome}
                    />
                  </div>
                  <OutcomeDetail
                    entry={entry}
                    outcome={outcome}
                    running={running}
                  />
                  {outcome?.status === "choose" && (
                    <Chooser
                      outcome={outcome}
                      busy={applying === entry.key}
                      onPick={(row) => void choose(entry.key, outcome.headers, row)}
                      onDismiss={() => dismiss(entry.key)}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {result && !running && (
            <p className="text-xs leading-relaxed text-muted">
              {result.written.length === 0
                ? "Nothing was written, so the lead is exactly as it was."
                : `Written onto ${clinicName}: ${result.written
                    .map((f) => ENRICH_FIELD_LABELS[f])
                    .join(", ")}. Everything else on the lead is untouched.`}{" "}
              These are readings taken just now, not a live feed — the lead page
              dates them so they can be seen going stale.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/60 px-6 py-4">
          <button
            type="button"
            onClick={() => void start()}
            disabled={running || applying !== null}
            className="btn disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Running…" : "Run again"}
          </button>
          <button type="button" onClick={onClose} className="btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Where the actor got to, in one word. Colour follows the app's convention:
// green for a write, amber for a run that landed on nothing, red for a
// failure, neutral for a skip — a skip is a decision, not a problem.
function StatusChip({
  running,
  willRun,
  outcome,
}: {
  running: boolean;
  willRun: boolean;
  outcome: EnrichOutcome | undefined;
}) {
  const [label, cls]: [string, string] = !outcome
    ? running
      ? willRun
        ? ["Running…", "bg-[#E8F0FE] text-accent"]
        : ["Skipped", "bg-line/70 text-muted"]
      : ["—", "bg-line/70 text-muted"]
    : outcome.status === "wrote"
      ? ["Written", "bg-ok-soft text-ok"]
      : outcome.status === "failed"
        ? ["Failed", "bg-bad-soft text-bad"]
        : outcome.status === "choose"
          ? ["Needs a choice", "bg-warn-soft text-warn"]
          : outcome.status === "empty"
            ? ["Nothing read", "bg-warn-soft text-warn"]
            : ["Skipped", "bg-line/70 text-muted"];

  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function OutcomeDetail({
  entry,
  outcome,
  running,
}: {
  entry: EnrichPlanEntry;
  outcome: EnrichOutcome | undefined;
  running: boolean;
}) {
  // Before the report lands, the row says what this actor is for — or, for one
  // that cannot run, why not. The skip reason is known without running
  // anything, so it is stated from the start rather than reported at the end.
  if (!outcome) {
    return (
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {entry.willRun
          ? `${running ? "Fills" : "Would fill"} ${entry.writes.join(" and ")}`
          : `Skipped — ${entry.skipReason}`}
      </p>
    );
  }
  if (outcome.status === "wrote") {
    return (
      <ul className="mt-1.5 space-y-1">
        {outcome.fields.map((field, i) => (
          <li key={field} className="flex gap-2 text-xs leading-relaxed">
            <span className="w-[110px] shrink-0 text-muted">
              {ENRICH_FIELD_LABELS[field]}
            </span>
            <span className="min-w-0 flex-1 break-words font-medium">
              {outcome.values[i]}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p
      className={`mt-1 text-xs leading-relaxed ${
        outcome.status === "failed" ? "text-muted" : "text-muted"
      }`}
    >
      {outcome.status === "skipped" ? "Skipped — " : ""}
      {outcome.detail}
    </p>
  );
}

// The one question this flow asks. Listed rather than mapped: the fields are
// known, so the only thing in doubt is which of these records is the clinic.
function Chooser({
  outcome,
  busy,
  onPick,
  onDismiss,
}: {
  outcome: Extract<EnrichOutcome, { status: "choose" }>;
  busy: boolean;
  onPick: (row: string[]) => void;
  onDismiss: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const name = `enrich-choice-${outcome.key}`;

  return (
    <div className="mt-3 rounded-[10px] border border-line bg-wash/50 p-3">
      <ul className="space-y-1.5">
        {outcome.options.map((option, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-surface">
              <input
                type="radio"
                name={name}
                checked={selected === i}
                onChange={() => setSelected(i)}
                className="mt-0.5 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1 break-words text-xs leading-relaxed">
                {option}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPick(outcome.rows[selected] ?? [])}
          disabled={busy}
          className="btn-primary h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Use this one"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          None of these
        </button>
      </div>
    </div>
  );
}

function replaceOutcome(
  prev: EnrichRunResult | null,
  key: EnrichActorKey,
  outcome: EnrichOutcome,
): EnrichRunResult | null {
  if (!prev) return prev;
  return {
    ...prev,
    outcomes: prev.outcomes.map((o) => (o.key === key ? outcome : o)),
  };
}

// Folds an applied selection back into the run's report, so the summary keeps
// reading as one run rather than a run and an afterthought.
function mergeSelection(
  prev: EnrichRunResult | null,
  applied: EnrichRunResult,
  key: EnrichActorKey,
): EnrichRunResult | null {
  if (!prev) return prev;
  const outcome = applied.outcomes[0];
  return {
    outcomes: outcome
      ? prev.outcomes.map((o) => (o.key === key ? outcome : o))
      : prev.outcomes,
    written: Array.from(new Set([...prev.written, ...applied.written])),
    enrichedAt: applied.enrichedAt ?? prev.enrichedAt,
    error: applied.error,
  };
}
