"use server";

// Starting, stopping and dismissing the long-running jobs. Each start reads
// its list fresh on the server, as the page-driven loops did, and hands the
// loop to src/lib/jobRunner.ts with the same per-item server function the page
// used to call in turn. The answer is the run's id; the page then polls it.

import { prisma } from "@/lib/prisma";
import { dismissJob, JobItemResult, launchJob, LaunchResult, requestJobStop } from "@/lib/jobRunner";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { FACEBOOK_PAGE_USD_PER_PAGE, costPerCandidate, stepCostPerCandidate } from "@/lib/pipelineSettings";
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
import { readPipelineChannel } from "@/lib/emailChannel";
import { normalizeApifyId } from "@/lib/apifyId";
import {
  ClinicTermResult,
  MAX_CLINIC_RESULTS,
  readClinicSearchConfig,
} from "@/lib/clinicDiscovery";
import { clinicTermLine, runClinicSearchTerm } from "@/lib/clinicSearchRun";
import { fmtCredits } from "@/lib/emailCheck";
import { releaseInboxIfUnsent, syncReadyInboxes } from "@/lib/emailInboxes";
import { resolveHeldCandidates } from "@/lib/heldCleanup";
import { finderBudget, finderDueLeads, finderQueueLeads, markForFinder, runContactFinder } from "@/lib/contactFinderRun";
import { CONTACT_STATUS_LABELS, finderWorstCase } from "@/lib/contactFinder";
import { OPENER_CALL_USD, OPENER_MAX_CALLS_PER_LEAD, openerRerunLeads } from "@/lib/openerRerun";
import { generateEmailOpener } from "@/lib/actions/emailWorkflow";

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

// "Retry failed records": the records a finished-with-errors comparison could
// not score (a dropped connection, an outage), scored again into the same
// run. Nothing else in the run is touched. Once none is left in error the run
// counts as finished and Apply unlocks — no need to re-score the rest.
export async function startComparisonRetryJob(runId: string): Promise<LaunchResult> {
  const run = await prisma.scoringComparisonRun.findUnique({
    where: { id: runId },
    select: { id: true, completedAt: true, estimatedUsd: true, subjects: true },
  });
  if (!run) return { ok: false, error: "That comparison run no longer exists." };
  if (run.completedAt) return { ok: false, error: "That comparison already finished — there is nothing to retry." };
  const failed = await prisma.scoringComparison.findMany({
    where: { runId, outcome: "error" },
    orderBy: { createdAt: "asc" },
    select: { subjectKind: true, subjectId: true, clinicName: true },
  });
  // One item per record, however many times it failed before.
  const seen = new Set<string>();
  const items = failed.flatMap((f) => {
    const key = `${f.subjectKind}:${f.subjectId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: f.subjectId, name: f.clinicName, kind: f.subjectKind }];
  });
  if (items.length === 0) return { ok: false, error: "No failed records in that comparison." };
  const per = run.subjects > 0 ? run.estimatedUsd / run.subjects : 0;

  return launchJob({
    kind: "compare-scoring",
    source: "compare-scoring",
    verb: "Retrying",
    href: "/discovery/compare",
    items: items.map((i) => ({ ...i, estimateUsd: per })),
    work: async (item) => {
      // The old error row goes; the record's new row (a score, or a fresh
      // error) takes its place.
      await prisma.scoringComparison.deleteMany({
        where: { runId, subjectKind: item.kind, subjectId: item.id, outcome: "error" },
      });
      const row = await compareOneSubject(runId, item.kind, item.id);
      if (row.outcome === "error") return { outcome: "error", detail: row.reason ?? "Not scored." };
      const score = row.newScore != null ? ` (${row.newScore})` : "";
      return {
        outcome: row.outcome === "unchanged" ? "ok" : "warn",
        detail: `${COMPARISON_OUTCOME_LABELS[row.outcome]} · ${row.oldLabel} → ${row.newLabel}${score}`,
      };
    },
    finish: async () => {
      const result = await finishScoringComparison(runId);
      if (result.complete) return `All ${result.subjects} scored — the comparison is finished and Apply is unlocked.`;
      if (result.errors > 0) return `${result.errors} still failed. Retry them again, or run Compare from the start.`;
      return `${result.scored} of ${result.subjects} scored — the run stopped before the end, so the rest were never scored. Run Compare from the start.`;
    },
  });
}

// ─── Process queue ─────────────────────────────────────────────────────────

// selectedIds null is the whole pending queue; a list is exactly what was
// ticked. Read fresh here, at the moment it starts, either way — and only the
// channel Discovery is showing, so the Email view never runs LinkedIn
// candidates and the other way round.
export async function startQueueJob(channel: unknown, selectedIds: string[] | null): Promise<LaunchResult> {
  const ch = readPipelineChannel(channel);
  // Anything the retired Tier 2 chiro hold left behind is re-judged under the
  // real-program check first, so none is stranded — here, where the queue is
  // about to be read, rather than every time Discovery is opened. A candidate
  // it puts back in the queue is picked up by this run.
  const held = await resolveHeldCandidates();
  if (held.promoted.length > 0) void kickContactFinder();
  const queue = selectedIds ? await discoveryQueueSelected(selectedIds, ch) : await discoveryQueue(ch);
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
    // The promoted email leads arrive "finding": the contact finder takes
    // them once the run is over.
    finish: async () => {
      await syncReadyInboxes();
      return null;
    },
    after: async () => {
      await kickContactFinder();
    },
  });
}

// ─── Clinic-first search ───────────────────────────────────────────────────

// One item per search term, one at a time, each a started-then-checked run
// on Apify (src/lib/clinicSearchRun.ts). Each term's clinics are stored on its
// item, and the panel reads them back once the run is over
// (combineClinicTermResults) — so the search can be left running and its
// results are there to import whenever the page is opened again. Nothing is
// written to Discovery from here; importing is still its own button.
export async function startClinicSearchJob(args: { config: unknown; actorId?: string }): Promise<LaunchResult> {
  const config = readClinicSearchConfig(args?.config);
  if (config.terms.length === 0) return { ok: false, error: "Add at least one search term to run." };

  const settings = await loadPipelineSettings();
  if (!settings.clinicDiscovery.enabled) {
    return {
      ok: false,
      error: "Clinic-First Discovery is turned off. Turn it on under Settings → Pipeline, where its actor is set too.",
    };
  }
  // Overrides the stored actor for this run only, held to the same shape a
  // saved one is held to.
  const typed = typeof args?.actorId === "string" ? args.actorId.trim() : "";
  const actorId = typed === "" ? settings.clinicDiscovery.actorId : normalizeApifyId(typed);
  if (!actorId) return { ok: false, error: "That actor ID is not one Apify would recognise." };

  let collected = 0;
  return launchJob({
    kind: "clinic-search",
    source: "clinic-search",
    verb: "Searching",
    href: "/discovery/import/clinic",
    items: config.terms.map((term) => ({ id: term, name: term })),
    work: async (item) => {
      const r: ClinicTermResult = await runClinicSearchTerm(item.name, config, actorId);
      collected += r.clinics.length;
      return { ...clinicTermLine(r), result: r };
    },
    // Past the cap, another term is a run paid for and thrown away.
    halt: () =>
      collected >= MAX_CLINIC_RESULTS
        ? `Stopped at ${MAX_CLINIC_RESULTS} clinics, the most one search keeps — the remaining terms were not run.`
        : null,
    finish: async ({ status, halted }) => {
      if (halted) return halted;
      if (status === "stopped") return "Stopped — the terms that ran have their results below, ready to import.";
      return null;
    },
  });
}

// ─── The contact finder ────────────────────────────────────────────────────

// One run per lead, in the fixed order (src/lib/contactFinder.ts), from a
// budget shared by the whole job. leadIds null is whatever is due (new
// leads, retries, credit blocks with room again); a list is exactly those
// leads — Retry, the backfill, a trigger. propose: "Look up again" on one
// lead, which only ever proposes.
export async function startContactFinderJob(args: { leadIds?: string[] | null; mode?: "apply" | "propose" } = {}): Promise<LaunchResult> {
  const mode = args?.mode === "propose" ? "propose" : "apply";
  const ids = Array.isArray(args?.leadIds) ? args.leadIds.filter((x) => typeof x === "string") : null;
  if (ids && mode === "apply") await markForFinder(ids);
  const rows = ids
    ? await prisma.lead.findMany({ where: { id: { in: ids }, channel: "email" }, select: { id: true, clinicName: true } })
    : await finderDueLeads();
  if (rows.length === 0) return { ok: false, error: ids ? "None of those is an email lead the finder can work on." : "No lead is waiting on the contact finder." };
  const budget = await finderBudget();
  const tally: Record<string, number> = {};
  return launchJob({
    kind: "contact-finder",
    source: "contact-finder",
    verb: mode === "propose" ? "Looking up" : "Finding contacts",
    href: "/pipeline",
    items: rows.map((r) => ({ id: r.id, name: r.clinicName })),
    work: async (item) => {
      const r = await runContactFinder(item.id, budget, { mode });
      const key = r.status ?? "unchanged";
      tally[key] = (tally[key] ?? 0) + 1;
      const label = r.status ? CONTACT_STATUS_LABELS[r.status] : "Unchanged";
      return {
        outcome: r.status === "needs_you" ? "error" : r.status === "finding" || r.status === null ? "warn" : "ok",
        detail: `${label} — ${r.detail}`,
        result: { stop: r.stop === true },
      };
    },
    halt: (results) => {
      const last = results[results.length - 1] as { result?: { stop?: boolean }; detail: string } | undefined;
      return last?.result?.stop ? `Stopped: ${last.detail}` : null;
    },
    finish: async ({ status, halted }) => {
      const parts = Object.entries(tally).map(([k, n]) => `${n} ${k === "unchanged" ? "unchanged" : CONTACT_STATUS_LABELS[k as keyof typeof CONTACT_STATUS_LABELS].toLowerCase()}`);
      const spent = `${fmtCredits(budget.hunterSpent)} Hunter · ${fmtCredits(budget.instantlySpent)} Instantly credits · $${budget.deepseekUsd.toFixed(3)} DeepSeek${budget.facebookUsd > 0 ? ` · $${budget.facebookUsd.toFixed(2)} Apify` : ""}`;
      const head = halted ? `${halted.replace(/\.?$/, ".")} ` : status === "stopped" ? "Stopped. " : "";
      return `${head}${parts.join(" · ") || "Nothing to do"} — ${spent}.`;
    },
    // Leads that arrived while this ran (promotions, retries) are taken next.
    after: async () => {
      if (mode === "apply") await kickContactFinder();
    },
  });
}

// Starts the finder on whatever is due — and first puts these leads in line,
// when given. Quiet: nothing due, or a run already going (it takes them when
// it ends), means it simply does not start. Called by every trigger: a
// promotion, a hand-saved email, the connector, the hourly timer.
export async function kickContactFinder(leadIds?: string[]): Promise<void> {
  try {
    if (leadIds && leadIds.length > 0) await markForFinder(leadIds);
    if ((await finderDueLeads()).length === 0) return;
    await startContactFinderJob({});
  } catch {
    // An automatic run that cannot start is not an error anybody is waiting on.
  }
}

// "Retry" on a needs-you lead.
export async function retryContactFinder(leadId: string): Promise<LaunchResult> {
  if (typeof leadId !== "string") return { ok: false, error: "No lead." };
  const r = await startContactFinderJob({ leadIds: [leadId] });
  // A run already going takes it when it ends (it is marked finding).
  if (!r.ok && /already running/i.test(r.error)) return { ok: false, error: "The contact finder is running — this lead is next." };
  return r;
}

// "Look up again" on a lead page: proposes, never replaces.
export async function lookUpContactAgain(leadId: string): Promise<LaunchResult> {
  if (typeof leadId !== "string") return { ok: false, error: "No lead." };
  return startContactFinderJob({ leadIds: [leadId], mode: "propose" });
}

// What the Settings → Email backfill would cost at most, for its confirm.
export async function contactFinderEstimate(): Promise<{
  count: number;
  hunterMax: number;
  instantlyMax: number;
  deepseekMaxUsd: number;
  facebookMaxUsd: number;
  hunterLeft: number;
  instantlyLeft: number;
}> {
  const rows = await finderQueueLeads();
  const budget = await finderBudget();
  const per = finderWorstCase(budget.guess);
  const facebookOn = (await loadPipelineSettings()).facebookEmails.enabled;
  return {
    count: rows.length,
    hunterMax: rows.length * per.hunter,
    instantlyMax: rows.length * per.instantlyChecks * budget.perCheck,
    deepseekMaxUsd: rows.length * per.deepseekUsd,
    facebookMaxUsd: facebookOn ? rows.length * FACEBOOK_PAGE_USD_PER_PAGE : 0,
    hunterLeft: budget.hunterLeft,
    instantlyLeft: budget.instantlyLeft,
  };
}

// Settings → Email: "Run contact finder on queue leads".
export async function startContactFinderBackfill(): Promise<LaunchResult> {
  const rows = await finderQueueLeads();
  if (rows.length === 0) return { ok: false, error: "No lead is \"Not run yet\"." };
  return startContactFinderJob({ leadIds: rows.map((r) => r.id) });
}

// ─── Stop and dismiss ──────────────────────────────────────────────────────

// The item in flight finishes on the server; nothing after it starts.
export async function stopJobRun(id: string): Promise<void> {
  await requestJobStop(id);
}

export async function dismissJobRun(id: string): Promise<void> {
  await dismissJob(id);
}

// ─── Re-run openers (Settings → Email) ─────────────────────────────────────

// Approved-but-unsent leads are unapproved with their old opener kept as a
// note, then every lead is regenerated under the playbook rules, A-tier
// first. Nothing is approved.
export async function startOpenerRerun(): Promise<LaunchResult> {
  const items = await openerRerunLeads();
  if (items.length === 0) return { ok: false, error: "No leads to re-run." };
  return launchJob({
    kind: "rerun-openers",
    source: "rerun-openers",
    verb: "Re-running openers",
    href: "/pipeline",
    items: items.map((i) => ({ ...i, estimateUsd: OPENER_CALL_USD * OPENER_MAX_CALLS_PER_LEAD })),
    halt: (results) => {
      const last = results.slice(-MAX_CONSECUTIVE_ERRORS);
      return last.length === MAX_CONSECUTIVE_ERRORS && last.every((r) => r.outcome === "error")
        ? "Stopped after three errors in a row."
        : null;
    },
    work: async (item) => {
      const lead = await prisma.lead.findUnique({
        where: { id: item.id },
        select: { emailOpener: true, openerAngle: true, emailApprovedAt: true, emailSends: { select: { id: true } } },
      });
      if (!lead) return { outcome: "warn", detail: "Lead no longer exists" };
      if (lead.emailSends.length > 0) return { outcome: "warn", detail: "Email 1 already sent — left alone" };
      if (lead.emailOpener) {
        await prisma.leadNote.create({
          data: {
            leadId: item.id,
            body: `Previous email opener${lead.emailApprovedAt ? " (was approved)" : ""}, replaced by Re-run openers: ${lead.emailOpener}`,
          },
        });
      }
      if (lead.emailApprovedAt) {
        await prisma.lead.update({ where: { id: item.id }, data: { emailApprovedAt: null } });
        await releaseInboxIfUnsent(item.id);
      }
      const r = await generateEmailOpener(item.id);
      if (!r.ok) return { outcome: "error", detail: r.error };
      return r.manual
        ? { outcome: "warn", detail: "No cited evidence — needs manual opener" }
        : { outcome: "ok", detail: `Opener drafted (${r.angle}) — needs approval` };
    },
  });
}
