"use server";

// Starting, stopping and dismissing the long-running jobs. Each start reads
// its list fresh on the server, as the page-driven loops did, and hands the
// loop to src/lib/jobRunner.ts with the same per-item server function the page
// used to call in turn. The answer is the run's id; the page then polls it.

import { prisma } from "@/lib/prisma";
import { dismissJob, JobItemResult, launchJob, LaunchResult, requestJobStop } from "@/lib/jobRunner";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { costPerCandidate, stepCostPerCandidate } from "@/lib/pipelineSettings";
import {
  discoveryQueue,
  discoveryQueueSelected,
  processDiscoveryCandidate,
  recrawlCandidateWebsite,
  RecrawlResult,
} from "@/lib/actions/discovery";
import { recrawlLeadWebsite } from "@/lib/actions/leadRecrawl";
import {
  compareOneSubject,
  finishScoringComparison,
  startScoringComparison,
} from "@/lib/actions/scoringComparison";
import { COMPARISON_OUTCOME_LABELS } from "@/lib/scoringComparison";
import { BATCH_QUEUE_DESCRIPTION, defaultBatchLabel } from "@/lib/discoveryBatch";
import { ICP_MAX_SCORE } from "@/lib/icp";

// ─── Re-crawl website ──────────────────────────────────────────────────────

function recrawlLine(r: RecrawlResult): JobItemResult {
  // Apify's limit on runs at once or memory: not this clinic's failure. The
  // runner backs off to fewer at once and runs it again.
  if (!r.ok && r.capacity) return { outcome: "error", detail: r.error, backoff: true };
  // Still running on Apify when the wait ran out. Not cancelled and not
  // thrown away: its pages are saved to the record when it finishes.
  if (!r.ok && r.pending) return { outcome: "warn", detail: r.error };
  if (!r.ok) return { outcome: "error", detail: r.error };
  const parts = [`${r.pages} page${r.pages === 1 ? "" : "s"}`, `${r.links} link${r.links === 1 ? "" : "s"}`];
  // A note means the crawl read less than it set out to — the home page only,
  // or the crawler choosing for itself. Stored, but worth a second look.
  return r.note
    ? { outcome: "warn", detail: `${parts.join(" · ")} · ${r.note}` }
    : { outcome: "ok", detail: parts.join(" · ") };
}

export async function startCandidateRecrawl(ids: string[]): Promise<LaunchResult> {
  const settings = await loadPipelineSettings();
  const per = stepCostPerCandidate("websiteContent", settings);
  const rows = await prisma.discoveryCandidate.findMany({
    where: { id: { in: ids }, websiteUrl: { not: null }, NOT: { websiteUrl: "" } },
    select: { id: true, clinicName: true },
  });
  // In the order they were ticked, as the page ran them.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [{ id: r.id, name: r.clinicName, estimateUsd: per }] : [];
  });
  return launchJob({
    kind: "recrawl-candidates",
    source: "discovery-recrawl",
    verb: "Re-crawling",
    href: "/discovery",
    items,
    concurrency: settings.recrawlConcurrency,
    work: async (item) => recrawlLine(await recrawlCandidateWebsite(item.id)),
  });
}

// source tells the Pipeline page's two re-crawl panels apart: the table's
// selection bar and the "crawled before" card.
export async function startLeadRecrawl(
  ids: string[],
  source: "pipeline-recrawl-selected" | "pipeline-recrawl-before",
): Promise<LaunchResult> {
  const settings = await loadPipelineSettings();
  const per = stepCostPerCandidate("websiteContent", settings);
  const rows = await prisma.lead.findMany({
    where: { id: { in: ids }, websiteUrl: { not: null }, NOT: { websiteUrl: "" } },
    select: { id: true, clinicName: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [{ id: r.id, name: r.clinicName, estimateUsd: per }] : [];
  });
  return launchJob({
    kind: "recrawl-leads",
    source,
    verb: "Re-crawling",
    href: "/pipeline",
    items,
    concurrency: settings.recrawlConcurrency,
    work: async (item) => recrawlLine(await recrawlLeadWebsite(item.id)),
  });
}

// ─── Compare scoring ───────────────────────────────────────────────────────

// Three model errors in a row is a key, an account or an outage — not three
// clinics. The run stops rather than spending its way through the rest.
const MAX_CONSECUTIVE_ERRORS = 3;

export async function startComparisonJob(): Promise<LaunchResult> {
  const started = await startScoringComparison();
  if (!started.ok) return started;
  const run = await prisma.scoringComparisonRun.findUnique({
    where: { id: started.runId },
    select: { estimatedUsd: true },
  });
  const per = started.subjects.length > 0 ? (run?.estimatedUsd ?? 0) / started.subjects.length : 0;
  const runId = started.runId;

  return launchJob({
    kind: "compare-scoring",
    source: "compare-scoring",
    verb: "Scoring",
    href: "/discovery/compare",
    items: started.subjects.map((s) => ({ id: s.id, name: s.clinicName, kind: s.kind, estimateUsd: per })),
    work: async (item) => {
      const row = await compareOneSubject(runId, item.kind, item.id);
      if (row.outcome === "error") return { outcome: "error", detail: row.reason ?? "Not scored." };
      const score = row.newScore != null ? ` (${row.newScore})` : "";
      return {
        outcome: row.outcome === "unchanged" ? "ok" : "warn",
        detail: `${COMPARISON_OUTCOME_LABELS[row.outcome]} · ${row.oldLabel} → ${row.newLabel}${score}`,
      };
    },
    halt: (results) => {
      const tail = results.slice(-MAX_CONSECUTIVE_ERRORS);
      return tail.length === MAX_CONSECUTIVE_ERRORS && tail.every((r) => r.outcome === "error")
        ? `Stopped after ${MAX_CONSECUTIVE_ERRORS} DeepSeek errors in a row — fix what they say and run it again. A partial run does not unlock Apply.`
        : null;
    },
    finish: async ({ halted }) => {
      const result = await finishScoringComparison(runId);
      if (halted) return halted;
      if (result.complete) return `All ${result.subjects} scored. The report below is this run.`;
      return `${result.scored} of ${result.subjects} scored${
        result.errors > 0 ? ` and ${result.errors} error${result.errors === 1 ? "" : "s"}` : ""
      }. A partial run does not unlock Apply — run it again to the end.`;
    },
  });
}

// ─── Process queue ─────────────────────────────────────────────────────────

// selectedIds null is the whole pending queue; a list is exactly what was
// ticked. Read fresh here, at the moment it starts, either way.
export async function startQueueJob(selectedIds: string[] | null): Promise<LaunchResult> {
  const queue = selectedIds ? await discoveryQueueSelected(selectedIds) : await discoveryQueue();
  if (queue.length === 0) {
    return {
      ok: false,
      error: selectedIds
        ? "Nothing to run — every candidate you selected has already been through the chain."
        : "Nothing is queued — every candidate has already been through the chain.",
    };
  }
  const per = costPerCandidate(await loadPipelineSettings());
  // One batch for this run, dated now, generated once rather than per
  // candidate — otherwise a queue that took two hours over midnight would
  // file its candidates under two different days.
  const runBatchLabel = defaultBatchLabel(new Date(), BATCH_QUEUE_DESCRIPTION);

  return launchJob({
    kind: "process-queue",
    source: "process-queue",
    verb: "Processing",
    href: "/discovery",
    items: queue.map((c) => ({ id: c.id, name: c.clinicName, estimateUsd: per })),
    work: async (item) => {
      const result = await processDiscoveryCandidate(item.id, runBatchLabel);
      const score = result.total != null ? ` (${result.total}/${result.max ?? ICP_MAX_SCORE})` : "";
      return {
        outcome: result.status === "PROMOTED" ? "ok" : result.status === "REJECTED" ? "warn" : "error",
        detail: `${result.headline}${score}`,
        result,
      };
    },
  });
}

// ─── Stop and dismiss ──────────────────────────────────────────────────────

// The item in flight finishes on the server; nothing after it starts.
export async function stopJobRun(id: string): Promise<void> {
  await requestJobStop(id);
}

export async function dismissJobRun(id: string): Promise<void> {
  await dismissJob(id);
}
