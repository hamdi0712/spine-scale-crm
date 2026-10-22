"use client";

// "Apply new scoring to existing records" — the confirm screen, the revert,
// and the short history under them. See src/lib/scoringApplication.ts.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApplicationPlan, KeptEntry, PlanEntry, StaleEntry } from "@/lib/scoringApplication";
import {
  applyScoringToExisting,
  previewScoringApplication,
  revertScoringApplication,
} from "@/lib/actions/scoringApplication";

export interface HistoryRow {
  id: string;
  appliedAt: string;
  revertedAt: string | null;
  promoted: number;
  rejected: number;
  flagged: number;
  protected: number;
  stale: number;
  protectedList: PlanEntry[];
  staleList: StaleEntry[];
  revertKeptList: KeptEntry[];
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function EntryList({ title, entries }: { title: string; entries: { clinicName: string; reason: string }[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-ink-soft">
        {title} ({entries.length})
      </summary>
      <ul className="mt-1.5 space-y-1 pl-4">
        {entries.map((e, i) => (
          <li key={i} className="list-disc break-words leading-relaxed text-muted">
            <span className="font-medium text-ink-soft">{e.clinicName}</span> — {e.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

// Each skipped record with what changed: the field, what the comparison saw,
// what it is now, and when. Open by default — it is the list that explains a
// count somebody did not expect.
function StaleList({ entries, open = true }: { entries: StaleEntry[]; open?: boolean }) {
  if (entries.length === 0) return null;
  return (
    <details className="mt-2 text-xs" open={open}>
      <summary className="cursor-pointer text-ink-soft">
        Skipped, changed since the comparison ({entries.length})
      </summary>
      <ul className="mt-1.5 max-h-80 space-y-1.5 overflow-y-auto pl-4">
        {entries.map((e) => (
          <li key={`${e.kind}-${e.id}`} className="list-disc break-words leading-relaxed text-muted">
            <span className="font-medium text-ink-soft">{e.clinicName || "(no name)"}</span>{" "}
            <span className="opacity-70">({e.kind})</span>
            <ul className="mt-0.5">
              {(e.changes ?? []).map((c, i) => (
                <li key={i}>
                  {c.field}: <span className="text-ink-soft">{c.compared}</span> → <span className="text-ink-soft">{c.current}</span>
                  {c.at ? <span className="opacity-70"> · {fmt(c.at)}</span> : null}
                </li>
              ))}
              {(!e.changes || e.changes.length === 0) && <li>{e.reason}</li>}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function ApplyScoringToExisting({
  model,
  history,
}: {
  model: "v1" | "v2";
  history: HistoryRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [plan, setPlan] = useState<ApplicationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<KeptEntry[] | null>(null);
  const active = history.find((h) => h.revertedAt === null) ?? null;

  function preview() {
    setError(null);
    setKept(null);
    startTransition(async () => {
      const result = await previewScoringApplication();
      if (result.ok) setPlan(result.plan);
      else setError(result.error);
    });
  }

  function apply() {
    startTransition(async () => {
      const result = await applyScoringToExisting();
      setPlan(null);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function revert(id: string) {
    if (!confirm("Revert new scoring? Every record it changed goes back to how it was, leads it created are deleted unless you have worked on them, and Process Queue goes back to the model it used before.")) return;
    setError(null);
    startTransition(async () => {
      const result = await revertScoringApplication(id);
      if (result.ok) setKept(result.kept);
      else setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="card mb-8 p-6 max-md:p-4">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Process queue scores with:{" "}
            <span className={model === "v2" ? "text-ok" : "text-ink-soft"}>
              {model === "v2" ? "the new ICP model" : "the old A–D scorecard"}
            </span>
          </p>
          <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
            {active
              ? `New scoring was applied to existing records on ${fmt(active.appliedAt)}. Revert puts every record it changed back.`
              : "Apply the latest finished Compare scoring run to the records you already have: newly promoted candidates become leads, newly rejected ones are rejected, and leads it rejects are flagged rather than deleted. No new AI or Apify calls."}
          </p>
        </div>
        {active ? (
          <button type="button" className="btn shrink-0" disabled={pending} onClick={() => revert(active.id)}>
            {pending ? "Reverting…" : "Revert new scoring"}
          </button>
        ) : (
          <button type="button" className="btn-primary shrink-0" disabled={pending} onClick={preview}>
            {pending && !plan ? "Checking…" : "Apply new scoring to existing records"}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-xs leading-relaxed text-bad">{error}</p>}

      {plan && (
        <div className="mt-4 rounded-lg border border-line p-4 max-md:p-3">
          <p className="text-sm font-medium">Apply this?</p>
          <p className="mt-1 text-xs text-muted">From the comparison finished {fmt(String(plan.runCompletedAt))}.</p>
          <ul className="num mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
            <li><span className="font-semibold">{plan.promote.length}</span> promoted</li>
            <li><span className="font-semibold">{plan.reject.length}</span> rejected</li>
            <li><span className="font-semibold">{plan.flag.length}</span> leads flagged</li>
            <li><span className="font-semibold">{plan.protectedLeads.length}</span> protected</li>
            <li><span className="font-semibold">{(plan.insufficient ?? []).length}</span> not enough evidence</li>
          </ul>
          <div className="mt-3 space-y-0.5 text-xs leading-relaxed text-ink-soft">
            <p>
              <span className="num font-semibold">{plan.rescoreUnchanged ?? 0}</span> unchanged record
              {(plan.rescoreUnchanged ?? 0) === 1 ? "" : "s"} will be re-scored (no status change).
            </p>
            {(plan.rescoreOther ?? 0) > 0 && (
              <p className="text-muted">
                <span className="num">{plan.rescoreOther}</span> flagged, protected, kept or not-enough-evidence record
                {plan.rescoreOther === 1 ? "" : "s"} also get the new scorecard, so no lead in the comparison keeps a 0–10 score.
              </p>
            )}
            {(plan.rescoreSkipped ?? 0) > 0 && (
              <p className="text-muted">
                <span className="num">{plan.rescoreSkipped}</span> keep their current score: changed since the comparison, or the comparison could not score them.
              </p>
            )}
            <p className="text-muted">
              <span className="num">{plan.leadsAddedSince ?? 0}</span> lead{(plan.leadsAddedSince ?? 0) === 1 ? "" : "s"} added
              after the comparison ran — not in it, so {(plan.leadsAddedSince ?? 0) === 1 ? "it keeps its" : "they keep their"} current score.
            </p>
          </div>
          {plan.stale.length > 0 && (
            <p className={`mt-2 text-xs leading-relaxed ${plan.staleWarning ? "text-bad" : "text-muted"}`}>
              {plan.stale.length} changed since the comparison and will be skipped.
              {plan.staleWarning && " That is more than 10% of the records — consider running a fresh Compare scoring first."}
            </p>
          )}
          <EntryList title="Promoted" entries={plan.promote} />
          <EntryList title="Rejected" entries={plan.reject} />
          <EntryList title="Leads flagged — on cited evidence (a disqualifier or a cited non-fit)" entries={plan.flag} />
          <EntryList title="Not enough evidence — left as they are, not rejected or flagged" entries={plan.insufficient ?? []} />
          <EntryList title="Kept by you — un-flagged by hand, skipped" entries={plan.kept ?? []} />
          <EntryList title="Protected — review these yourself" entries={plan.protectedLeads} />
          <StaleList entries={plan.stale} />
          <p className="mt-3 text-xs text-muted">Process Queue switches to the new model. Everything is snapshotted and can be reverted.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary" disabled={pending} onClick={apply}>
              {pending ? "Applying…" : "Apply"}
            </button>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {kept && (
        <div className="mt-4 text-xs">
          <p className="font-medium">Reverted.</p>
          {kept.length === 0 ? (
            <p className="text-muted">Every record went back exactly as it was.</p>
          ) : (
            <EntryList title="Left as you left them" entries={kept} />
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium text-ink-soft">History</p>
          <ul className="mt-1.5 divide-y divide-line text-xs">
            {history.map((h) => (
              <li key={h.id} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>{fmt(h.appliedAt)}</span>
                  <span className={h.revertedAt ? "text-muted" : "text-ok"}>
                    {h.revertedAt ? `Reverted ${fmt(h.revertedAt)}` : "Applied"}
                  </span>
                </div>
                <p className="num text-muted">
                  {h.promoted} promoted · {h.rejected} rejected · {h.flagged} flagged · {h.protected} protected
                  {h.stale > 0 ? ` · ${h.stale} skipped` : ""}
                </p>
                <EntryList title="Protected" entries={h.protectedList} />
                <StaleList entries={h.staleList} open={false} />
                <EntryList title="Left as you left them on revert" entries={h.revertKeptList} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
