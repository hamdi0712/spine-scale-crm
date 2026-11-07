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
import { checkLeadEmail, checkReadiness, creditsUsedThisMonth, uncheckedEmailLeads } from "@/lib/emailCheckRun";
import { fmtCredits } from "@/lib/emailCheck";
import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { facebookEmailLeads, findBackupEmail } from "@/lib/facebookEmailRun";
import { findOwner, findOwnerEmail, findOwnerLeads, ownerBudget, ownerReadiness, hunterCreditsUsedThisMonth, OwnerEmailOutcome } from "@/lib/ownerFindRun";
import { ownerCostPerLead } from "@/lib/ownerFind";
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
    // Addresses the email finder found on promoted leads, checked once the
    // run is over (one may have been running while they turned up).
    finish: async () => {
      await autoCheckEmails();
      await autoFindOwners();
      return null;
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

// ─── Email check (Instantly) ───────────────────────────────────────────────

// Checks addresses through Instantly's email-verification endpoint, one lead
// at a time, in the shared runner and progress panel. Never sends anything.
//
// leadIds null is every unchecked email lead. A job that would go past this
// month's credit budget is refused, saying how many would fit — except the
// automatic one (auto), which checks as many as fit and leaves the rest.
// force re-checks leads that were checked already ("Check again").
// A refused key or a plan without API access stops the run at once.
export async function startEmailCheckJob(args: { leadIds?: string[] | null; force?: boolean; auto?: boolean }): Promise<LaunchResult> {
  const leadIds = Array.isArray(args?.leadIds) ? args.leadIds.filter((x) => typeof x === "string") : null;
  const force = args?.force === true;
  const rows = leadIds
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds }, stage: { not: "LOST" }, email: { not: null }, NOT: { email: "" }, ...(force ? {} : { emailStatus: null }) },
        select: { id: true, clinicName: true },
      })
    : await uncheckedEmailLeads();
  if (rows.length === 0) {
    return { ok: false, error: force ? "There is no address to check." : "Nothing to check — every address has been checked. Use Check again on a lead to check it again." };
  }
  const ready = await checkReadiness(rows.length);
  if (!ready.hasKey) return { ok: false, error: "No Instantly API key — add one under Settings → API Keys." };
  let items = rows;
  if (!ready.fits) {
    if (!args?.auto) {
      return {
        ok: false,
        error: `That needs ${fmtCredits(ready.needed)} credits and ${fmtCredits(ready.left)} are left of this month's ${ready.settings.checkCreditBudget} — ${ready.affordable} check${ready.affordable === 1 ? "" : "s"} would fit. Raise the budget in Settings → Email, or check fewer.`,
      };
    }
    if (ready.affordable === 0) return { ok: false, error: "This month's credit budget is used up." };
    items = rows.slice(0, ready.affordable);
  }
  const per = ready.settings.creditsPerCheck;
  return launchJob({
    kind: "email-check",
    source: "email-check",
    verb: "Checking",
    href: "/pipeline",
    items: items.map((r) => ({ id: r.id, name: r.clinicName })),
    work: async (item) => {
      const r = await checkLeadEmail(item.id, { force });
      if (r.kind === "failed") return { outcome: "error", detail: r.detail, result: { code: r.code } };
      if (r.kind === "skipped") return { outcome: "warn", detail: r.detail };
      return { outcome: r.status === "valid" ? "ok" : "warn", detail: r.detail };
    },
    halt: (results) => {
      const last = results[results.length - 1] as { result?: { code?: string }; detail: string } | undefined;
      const code = last?.result?.code;
      return code === "auth" || code === "plan" || code === "no_key" ? `Stopped: ${last?.detail}` : null;
    },
    finish: async ({ halted }) => {
      const used = await creditsUsedThisMonth();
      const settings = await loadEmailSettings();
      if (halted) return `${halted.replace(/\.?$/, ".")} ${fmtCredits(used)} of ${settings.checkCreditBudget} credits used this month.`;
      return `About ${fmtCredits(items.length * per)} credits estimated · ${fmtCredits(used)} of ${settings.checkCreditBudget} used this month.${
        items.length < rows.length ? ` ${rows.length - items.length} left unchecked — the budget ran out.` : ""
      }`;
    },
  });
}

// Checks new email leads' addresses on its own, as long as there is a key and
// budget left: whatever is unchecked, as many as fit. Quiet — nothing to
// check, no key, no budget or a check already running all mean it simply
// does not start. Called wherever a lead gets an address.
export async function autoCheckEmails(): Promise<void> {
  try {
    const pending = await uncheckedEmailLeads();
    if (pending.length === 0) return;
    const ready = await checkReadiness(1);
    if (!ready.hasKey || !ready.fits) return;
    await startEmailCheckJob({ auto: true });
  } catch {
    // An automatic check that cannot start is not an error anybody is waiting on.
  }
}

// ─── Find emails on Facebook ───────────────────────────────────────────────

// Email leads with no address, a Facebook page, and that page not read yet:
// the website first (free), then the page. Every new address is checked
// through Instantly when the run is over. The page shows the estimate and asks
// before this is pressed.
export async function startFacebookEmailJob(args: { leadIds?: string[] | null } = {}): Promise<LaunchResult> {
  const settings = await loadPipelineSettings();
  if (!settings.facebookEmails.enabled) {
    return { ok: false, error: "Facebook page emails is turned off. Turn it on under Settings → Pipeline, where its actor is set too." };
  }
  // leadIds: a pick made on the Email pipeline; the rest stay for later.
  const only = Array.isArray(args?.leadIds) ? new Set(args.leadIds.filter((x) => typeof x === "string")) : null;
  const rows = (await facebookEmailLeads()).filter((r) => !only || only.has(r.id));
  if (rows.length === 0) return { ok: false, error: "No email lead without an address has an unread Facebook page." };
  let found = 0;
  return launchJob({
    kind: "facebook-emails",
    source: "facebook-emails",
    verb: "Reading",
    href: "/pipeline",
    items: rows.map((r) => ({ id: r.id, name: r.clinicName, estimateUsd: FACEBOOK_PAGE_USD_PER_PAGE })),
    work: async (item) => {
      const r = await findBackupEmail(item.id, settings);
      if (r.kind === "found") found++;
      return { outcome: r.kind === "found" ? "ok" : r.kind === "failed" ? "error" : "warn", detail: r.detail };
    },
    finish: async ({ status }) => {
      if (found > 0) await autoCheckEmails();
      const head = `${found} email${found === 1 ? "" : "s"} found${found > 0 ? " — checking them through Instantly" : ""}.`;
      return status === "stopped" ? `Stopped. ${head}` : head;
    },
  });
}

// A lead just promoted outside the queue (by hand, or by the decision-maker
// stage): the email finder in the background, and the check if it found one.
export async function autoFindBackupEmail(leadId: string): Promise<void> {
  try {
    const r = await findBackupEmail(leadId, await loadPipelineSettings());
    if (r.kind === "found") await autoCheckEmails();
  } catch {
    // Nobody is waiting on it; the bulk action can try the lead again.
  }
  await autoFindOwners();
}

// ─── Find owners ───────────────────────────────────────────────────────────

// The owner's name (NPI Registry + the stored crawl, free) and then, for a
// confirmed owner on the clinic's own domain, their address (Hunter, then
// the pattern or the guesses, each checked with Instantly). The page shows
// the worst-case estimate and asks before this is pressed; a job whose worst
// case would go past either monthly budget is refused (auto trims to what
// fits). leadIds: one lead (the lead page's button) or a pick just made.
export async function startOwnerJob(args: { leadIds?: string[] | null; auto?: boolean } = {}): Promise<LaunchResult> {
  const only = Array.isArray(args?.leadIds) ? new Set(args.leadIds.filter((x) => typeof x === "string")) : null;
  const all = await findOwnerLeads({ onlyNew: args?.auto === true && !only, includePipeline: only !== null });
  const rows = only ? all.filter((r) => only.has(r.id)) : all;
  if (rows.length === 0) return { ok: false, error: "No email lead is waiting on its owner — every one has been looked up, or already has the owner's email." };
  const ready = await ownerReadiness(rows.length);
  if (!ready.hasHunterKey) return { ok: false, error: "No Hunter API key — add one under Settings → API Keys." };
  if (!ready.hasInstantlyKey) return { ok: false, error: "No Instantly API key — every address found is checked through it. Add one under Settings → API Keys." };
  let items = rows;
  if (!ready.fits) {
    if (!args?.auto) {
      const parts = [
        !ready.hunter.fits ? `up to ${ready.hunter.needed} Hunter credits and ${fmtCredits(ready.hunter.left)} are left of this month's ${ready.hunter.budget}` : null,
        !ready.instantly.fits ? `up to ${fmtCredits(ready.instantly.needed)} Instantly credits and ${fmtCredits(ready.instantly.left)} are left of this month's ${ready.instantly.budget}` : null,
      ].filter(Boolean);
      return {
        ok: false,
        error: `That could need ${parts.join(", and ")} — ${ready.affordable} lead${ready.affordable === 1 ? "" : "s"} would fit. Raise the budget in Settings → Email, or run fewer.`,
      };
    }
    if (ready.affordable === 0) return { ok: false, error: "This month's Hunter or Instantly budget is used up." };
    items = rows.slice(0, ready.affordable);
  }

  const budget = await ownerBudget();
  const tally = { confirmed: 0, pick: 0, found: 0, valid: 0, risky: 0, invalid: 0 };
  const emailLine = (e: OwnerEmailOutcome | null): string | null => {
    if (!e) return null;
    if (e.kind === "found") return e.detail;
    if (e.kind === "skipped" && /already|No confirmed/i.test(e.detail)) return null;
    return e.detail;
  };
  return launchJob({
    kind: "find-owners",
    source: "find-owners",
    verb: "Finding owners",
    href: "/pipeline",
    items: items.map((r) => ({ id: r.id, name: r.clinicName })),
    work: async (item) => {
      const name = await findOwner(item.id);
      if (name.kind === "failed") return { outcome: "error", detail: name.detail };
      if (name.kind === "confirmed" && name.source !== "manual" && !/earlier/.test(name.detail)) tally.confirmed++;
      if (name.kind === "pick") tally.pick++;
      if (name.kind !== "confirmed") return { outcome: "warn", detail: name.detail };

      const e = await findOwnerEmail(item.id, budget);
      if (e.kind === "found") {
        tally.found++;
        if (e.status === "valid") tally.valid++;
        else if (e.status === "risky") tally.risky++;
      }
      if (e.kind === "invalid") {
        tally.found++;
        tally.invalid++;
      }
      const line = [name.detail, emailLine(e)].filter(Boolean).join(" · ");
      if (e.kind === "failed") return { outcome: "error", detail: line, result: { stop: e.stop === true } };
      return { outcome: e.kind === "found" && e.status === "valid" ? "ok" : "warn", detail: line, result: { budget: e.kind === "skipped" && e.budget === true } };
    },
    halt: (results) => {
      const last = results[results.length - 1] as { result?: { stop?: boolean; budget?: boolean }; detail: string } | undefined;
      if (last?.result?.stop) return `Stopped: ${last.detail}`;
      if (last?.result?.budget) return "Stopped: this month's budget ran out.";
      return null;
    },
    finish: async ({ status, halted }) => {
      const settings = await loadEmailSettings();
      const hunterUsed = await hunterCreditsUsedThisMonth();
      const owners = `${tally.confirmed} owner${tally.confirmed === 1 ? "" : "s"} confirmed${tally.pick > 0 ? ` (${tally.pick} to pick by hand)` : ""}`;
      const emails = `${tally.found} owner email${tally.found === 1 ? "" : "s"} found — ${tally.valid} valid, ${tally.risky} risky, ${tally.invalid} invalid`;
      const credits = `${fmtCredits(budget.hunterSpent)} Hunter credits (${fmtCredits(hunterUsed)} of ${settings.hunterCreditBudget} this month) · ${fmtCredits(budget.instantlySpent)} Instantly credits`;
      const trimmed = items.length < rows.length ? ` ${rows.length - items.length} left for later — the budget would not cover them.` : "";
      const head = halted ? `${halted.replace(/\.?$/, ".")} ` : status === "stopped" ? "Stopped. " : "";
      return `${head}${owners} · ${emails} · ${credits}.${trimmed}`;
    },
  });
}

// Newly promoted email leads, looked up on their own while there are keys
// and budget left — as many as fit. Quiet, like autoCheckEmails.
export async function autoFindOwners(): Promise<void> {
  try {
    const pending = await findOwnerLeads({ onlyNew: true });
    if (pending.length === 0) return;
    const ready = await ownerReadiness(1);
    if (!ready.hasHunterKey || !ready.hasInstantlyKey || ready.affordable === 0) return;
    await startOwnerJob({ auto: true });
  } catch {
    // Nobody is waiting on it; Find owners can run it by hand.
  }
}

// What Find owners would cost at most, for the confirm.
export async function ownerJobEstimate(): Promise<{
  count: number;
  hunterMax: number;
  instantlyMax: number;
  hunterLeft: number;
  instantlyLeft: number;
  fits: boolean;
  affordable: number;
  hasKeys: boolean;
}> {
  const rows = await findOwnerLeads();
  const r = await ownerReadiness(rows.length);
  return {
    count: rows.length,
    hunterMax: r.hunter.needed,
    instantlyMax: rows.length * ownerCostPerLead(r.guess).instantly * r.perCheck,
    hunterLeft: r.hunter.left,
    instantlyLeft: r.instantly.left,
    fits: r.fits,
    affordable: r.affordable,
    hasKeys: r.hasHunterKey && r.hasInstantlyKey,
  };
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
      if (lead.emailApprovedAt) await prisma.lead.update({ where: { id: item.id }, data: { emailApprovedAt: null } });
      const r = await generateEmailOpener(item.id);
      if (!r.ok) return { outcome: "error", detail: r.error };
      return r.manual
        ? { outcome: "warn", detail: "No cited evidence — needs manual opener" }
        : { outcome: "ok", detail: `Opener drafted (${r.angle}) — needs approval` };
    },
  });
}
