"use client";

// Find emails on the Pipeline page: from the table's selection bar, or for
// every A-tier or B-tier lead. The plan is read from the server first — who
// would be covered, how many need the paid extractor, the most it could
// cost — and confirmed before anything runs. The run itself is the job
// runner's, with the same progress panel as a re-crawl, and its summary is
// counted off the stored results once it ends.

import { useEffect, useState } from "react";
import { fmtEstimate } from "@/lib/pipelineSettings";
import { FindEmailsPlan, FindEmailsSource, FindEmailsTarget, planFindEmails, startFindEmails } from "@/lib/actions/jobs";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";

const OUTCOME_ROWS: { key: string; label: string; tone: string }[] = [
  { key: "valid_owner", label: "Valid owner email", tone: "text-ok" },
  { key: "valid_generic", label: "Valid generic email", tone: "text-ok" },
  { key: "risky", label: "Risky only", tone: "text-warn" },
  { key: "unknown", label: "Unknown only", tone: "text-warn" },
  { key: "none", label: "None", tone: "text-muted" },
  { key: "skipped_manual", label: "Skipped (entered by hand)", tone: "text-muted" },
];

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function confirmText(plan: Extract<FindEmailsPlan, { ok: true }>, what: string): string {
  const lines = [
    `Find emails for ${plural(plan.leads, "lead")} (${what})?`,
    "",
    `• ${plural(plan.fromCrawl, "lead")} already have an address in the stored crawl — free to read`,
    `• ${plural(plan.needExtractor, "lead")} need the paid extractor`,
  ];
  if (plan.extractorOff > 0) {
    lines.push(`• ${plural(plan.extractorOff, "lead")} have nothing stored and will not be crawled (extractor off, or no website)`);
  }
  if (plan.imported > 0) lines.push(`• ${plural(plan.imported, "imported address", "imported addresses")} verified, never replaced`);
  lines.push(`• ${plural(plan.withDecisionMaker, "lead")} name a decision-maker, so owner addresses can be guessed`);
  lines.push(`• Up to ${plural(plan.maxVerifications, "verification")}`);
  lines.push("");
  lines.push(`Up to ${fmtEstimate(plan.ceilingUsd)} in Apify usage — most leads stop well short of it.`);
  const skipped: string[] = [];
  if (plan.manual > 0) skipped.push(`${plural(plan.manual, "lead")} with an address entered by hand`);
  if (plan.alreadyValid > 0) skipped.push(`${plural(plan.alreadyValid, "lead")} already holding a valid address`);
  if (skipped.length > 0) lines.push(`Left alone: ${skipped.join("; ")}.`);
  return lines.join("\n");
}

export function useFindEmails(source: FindEmailsSource) {
  const { running, track } = useJobRun(source);
  const [planning, setPlanning] = useState(false);

  async function run(target: FindEmailsTarget, what: string) {
    if (running || planning) return;
    setPlanning(true);
    const plan = await planFindEmails(target).catch(() => null);
    setPlanning(false);
    if (!plan) {
      alert("The estimate could not be worked out. Check the server is still up.");
      return;
    }
    if (!plan.ok) {
      alert(plan.error);
      return;
    }
    if (plan.leads === 0) {
      alert(
        `Nothing to run for ${what}.` +
          (plan.manual > 0 ? ` ${plural(plan.manual, "lead")} have an address entered by hand.` : "") +
          (plan.alreadyValid > 0 ? ` ${plural(plan.alreadyValid, "lead")} already hold a valid address.` : ""),
      );
      return;
    }
    if (!confirm(confirmText(plan, what))) return;
    const started = await startFindEmails(plan.ids, source).catch(() => null);
    if (!started || !started.ok) {
      alert(started?.error ?? "Find emails could not be started. Check the server is still up.");
      return;
    }
    track(started.id);
  }

  const panel = (
    <>
      <JobProgressFor source={source} className="mb-3" />
      <FindEmailsSummary source={source} />
    </>
  );
  return { run, running: running || planning, panel };
}

// "Find emails for all A-tier / all B-tier".
export function FindEmailsByTier() {
  const { run, running, panel } = useFindEmails("pipeline-find-emails-tier");
  return (
    <div className="mb-4">
      <div className="card flex flex-wrap items-center gap-2 px-4 py-3 text-sm max-md:px-3">
        <span className="text-ink-soft">Find emails for</span>
        <button type="button" className="btn" disabled={running} onClick={() => void run({ tier: "A" }, "all A-tier")}>
          All A-tier
        </button>
        <button type="button" className="btn" disabled={running} onClick={() => void run({ tier: "B" }, "all B-tier")}>
          All B-tier
        </button>
        <span className="helper-text text-xs text-muted">
          Stored crawl first, then the extractor, then owner-name guesses — every address verified. Addresses entered by
          hand are never touched.
        </span>
      </div>
      <div className="mt-2">{panel}</div>
    </div>
  );
}

// The counts, once a run has ended: one row per outcome, read off the results
// the runner stored for each lead.
function FindEmailsSummary({ source }: { source: FindEmailsSource }) {
  const { job } = useJobRun(source);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const ended = job !== null && job.status !== "running";
  const id = job?.id ?? null;

  useEffect(() => {
    setCounts(null);
    if (!ended || !id) return;
    let live = true;
    fetch(`/api/jobs/results?id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { results?: { result: unknown }[] }) => {
        if (!live) return;
        const next: Record<string, number> = { errors: 0 };
        for (const row of body.results ?? []) {
          const outcome = (row.result as { outcome?: string | null } | null)?.outcome ?? null;
          if (outcome) next[outcome] = (next[outcome] ?? 0) + 1;
          else next.errors++;
        }
        setCounts(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ended, id]);

  if (!ended || !counts) return null;
  return (
    <section className="card mb-3 px-5 py-4 max-md:px-4" aria-label="Find emails results">
      <p className="text-sm font-medium">Find emails — results</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {OUTCOME_ROWS.filter((r) => r.key !== "skipped_manual" || (counts[r.key] ?? 0) > 0).map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-soft">{r.label}</dt>
            <dd className={`num font-medium ${r.tone}`}>{counts[r.key] ?? 0}</dd>
          </div>
        ))}
        {counts.errors > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-soft">Failed (not written)</dt>
            <dd className="num font-medium text-bad">{counts.errors}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
