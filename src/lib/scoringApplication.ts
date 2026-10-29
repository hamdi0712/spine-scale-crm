// "Apply new scoring to existing records", and its revert.
//
// Compare scoring is a dry run: it scores every promoted and rejected
// candidate and every hand-added lead under the ICP model and stores what
// would change, without changing anything. This turns the latest finished run
// into real changes — and keeps a snapshot of everything it touched, so a
// revert puts it all back.
//
// No model calls and no actor runs: every verdict, score and reason comes off
// the comparison rows. Applying, reverting and applying again cost nothing.
//
//   Newly promoted candidate  → promoted into the Pipeline (stage New), the
//                               same promotion the queue makes.
//   Newly rejected candidate  → status Rejected, with the new reason.
//   Newly rejected, and it is already a lead in the Pipeline
//                             → the lead is flagged "Rejected by new scoring"
//                               (scoringRejectedAt). Never deleted, never
//                               moved: hidden from the default views and the
//                               counts while the flag is set.
//   Protected                 → a lead with a reply, a call logged, at
//                               Discovery Call Booked or later, or converted
//                               to a client. Never flagged; listed instead.
//   Stale                     → the record changed since the comparison ran
//                               (deleted, promoted by hand, already flagged).
//                               Skipped and listed.
//
// Server-only and not a "use server" module: the actions in
// src/lib/actions/scoringApplication.ts call it, and so does the verify script.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { promoteWithin } from "@/lib/promoteLead";
import { TALKING_ON_LINKEDIN_LABEL } from "@/lib/emailChannel";
import { finish, parseBreakdownV2, serializeBreakdownV2 } from "@/lib/icpScoring";
import { OldStanding } from "@/lib/scoringComparison";
import { LEAD_SCORE_SELECT, candidateStanding, leadStanding } from "@/lib/scoringComparisonStore";
import { loadPipelineSettings, savePipelineSettings } from "@/lib/pipelineSettingsStore";

// Discovery Call Booked and everything after it. Lost and No Contact are not
// protected: a lead the new model rejects there can be flagged.
export const PROTECTED_STAGES = ["DISCOVERY", "PROPOSAL", "NEGOTIATING", "WON"] as const;

// More stale records than this share of the plan, and the confirm screen
// suggests running a fresh Compare first.
export const STALE_WARNING_SHARE = 0.1;

export interface PlanEntry {
  kind: "candidate" | "lead";
  id: string;
  clinicName: string;
  reason: string;
}

export interface PromoteEntry extends PlanEntry {
  breakdown: string | null;
  score: number | null;
  tier: string | null;
}

export type RejectEntry = PromoteEntry;

// A record skipped because it changed since the comparison: which field, what
// the comparison saw, what it is now, and when it changed where that is known.
export interface StaleChange {
  field: string;
  compared: string;
  current: string;
  at: string | null;
}

export interface StaleEntry extends PlanEntry {
  changes: StaleChange[];
}

export interface FlagEntry extends PlanEntry {
  leadId: string;
}

// A record that gets the new-model scorecard (score out of 100, tier and
// breakdown) and nothing else: no status, no stage. Every subject of the
// comparison the apply does not already score — unchanged ones, and the
// flagged, protected, kept and not-enough-evidence ones — so no lead in the
// comparison is left showing an old 0–10 score.
export interface RescoreEntry {
  kind: "candidate" | "lead";
  id: string;
  clinicName: string;
  breakdown: string;
  score: number;
  tier: string;
}

export interface ApplicationPlan {
  runId: string;
  runCompletedAt: Date;
  promote: PromoteEntry[];
  reject: RejectEntry[];
  flag: FlagEntry[];
  protectedLeads: PlanEntry[];
  // Missed the fit floor only because nothing was found. Left exactly as they
  // are: not rejected, not flagged. Re-crawl and re-run Compare to judge them.
  insufficient: PlanEntry[];
  rescore: RescoreEntry[];
  // How many comparison records the rescore covers: "unchanged" ones, and the
  // rest (flagged, protected, kept, not enough evidence). A candidate and its
  // Pipeline lead are one record.
  rescoreUnchanged: number;
  rescoreOther: number;
  // Comparison records that keep their old score: changed since the
  // comparison ran, or never scored by it (no evidence at all).
  rescoreSkipped: number;
  // Leads added after the comparison ran: not in it, so they keep whatever
  // score they have.
  leadsAddedSince: number;
  // Leads un-flagged by hand ("Un-flag (keep this lead)"): never flagged again.
  kept: PlanEntry[];
  stale: StaleEntry[];
  staleShare: number;
  staleWarning: boolean;
}

export type PlanResult = { ok: true; plan: ApplicationPlan } | { ok: false; error: string };

const LEAD_GUARD_SELECT = {
  id: true,
  clinicName: true,
  stage: true,
  archived: true,
  repliedAt: true,
  scoringRejectedAt: true,
  scoringKeptAt: true,
  _count: { select: { calls: true } },
} as const;

type GuardLead = Prisma.LeadGetPayload<{ select: typeof LEAD_GUARD_SELECT }>;

// A message sent this recently means follow-ups are due, and they live in
// Today's Focus — a flag would hide them.
export const RECENT_OUTREACH_DAYS = 30;

function protectionReason(lead: GuardLead, recentlyMessaged: Set<string>): string | null {
  if (lead.repliedAt) return "a reply is recorded";
  if (recentlyMessaged.has(lead.id)) return `an outreach message was sent in the last ${RECENT_OUTREACH_DAYS} days`;
  if (lead._count.calls > 0) return "a call is logged";
  if ((PROTECTED_STAGES as readonly string[]).includes(lead.stage)) return `it is at ${LEAD_STAGE_LABELS[lead.stage as LeadStage] ?? lead.stage}`;
  if (lead.archived) return "it has been converted to a client";
  return null;
}

function verdictReason(row: { flipReason: string | null; breakdown: string | null }, fallback: string): string {
  const stored = parseBreakdownV2(row.breakdown);
  return (stored ? finish(stored, stored.verdict.threshold).verdict.reason : null) ?? row.flipReason ?? fallback;
}

// What changed on a record since the comparison read it, comparing only what
// decides the verdict: its status, its score and tier, and its evidence (the
// website notes and links, ads, reviews and the rest of the enrichment, which
// are re-gathered together and stamp enrichedAt). updatedAt is not compared —
// it moves on writes that change none of these.
//
// The comparison row stores the old standing as its display label
// ("Rejected", "Promoted (ICP model)", "In the pipeline (B-tier)") and its
// score and tier, so the current record is read back into the same shape.
function changesSince(
  row: { oldStatus: string; oldScore: number | null; oldTier: string | null },
  runStartedAt: Date,
  now: OldStanding,
  enrichedAt: Date | null,
  updatedAt: Date,
  rawStatus: string | null,
): StaleChange[] {
  const changes: StaleChange[] = [];
  const saved = updatedAt.toISOString();
  const statusNow = rawStatus !== null && rawStatus !== "PROMOTED" && rawStatus !== "REJECTED" ? rawStatus.toLowerCase() : now.label;
  if (statusNow !== row.oldStatus) {
    changes.push({ field: "status", compared: row.oldStatus, current: statusNow, at: saved });
  }
  if ((now.score ?? null) !== (row.oldScore ?? null)) {
    changes.push({ field: "score", compared: String(row.oldScore ?? "none"), current: String(now.score ?? "none"), at: saved });
  }
  if ((now.tier ?? null) !== (row.oldTier ?? null)) {
    changes.push({ field: "tier", compared: row.oldTier ?? "none", current: now.tier ?? "none", at: saved });
  }
  if (enrichedAt && enrichedAt > runStartedAt) {
    changes.push({ field: "website notes, links and enrichment", compared: "as compared", current: "re-gathered", at: enrichedAt.toISOString() });
  }
  return changes;
}

function describeChange(c: StaleChange): string {
  return `${c.field}: ${c.compared} → ${c.current}`;
}

// Whether a comparison subject changed since the run read it, by the same
// test the stale check uses. Deleted counts as changed.
async function changedSinceComparison(
  row: { subjectKind: string; subjectId: string; oldStatus: string; oldScore: number | null; oldTier: string | null },
  runStartedAt: Date,
): Promise<boolean> {
  if (row.subjectKind === "lead") {
    const lead = await prisma.lead.findUnique({
      where: { id: row.subjectId },
      select: { ...LEAD_SCORE_SELECT, enrichedAt: true, updatedAt: true },
    });
    return !lead || changesSince(row, runStartedAt, leadStanding(lead), lead.enrichedAt, lead.updatedAt, null).length > 0;
  }
  const c = await prisma.discoveryCandidate.findUnique({
    where: { id: row.subjectId },
    select: { status: true, icpTotal: true, icpTier: true, scoringModel: true, disqualifiedReason: true, enrichedAt: true, updatedAt: true },
  });
  return !c || changesSince(row, runStartedAt, candidateStanding(c), c.enrichedAt, c.updatedAt, c.status).length > 0;
}

export async function latestFinishedRun() {
  return prisma.scoringComparisonRun.findFirst({
    where: { completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
  });
}

// What an apply would do right now, from the latest finished comparison and
// the records as they stand. The confirm screen shows this; the apply builds
// it again inside its own write so the counts it saves are the ones it did.
export async function planApplication(): Promise<PlanResult> {
  const run = await latestFinishedRun();
  if (!run || !run.completedAt) {
    return { ok: false, error: "There is no finished Compare scoring run. Run one to the end first — this applies its results." };
  }
  const rows = await prisma.scoringComparison.findMany({
    where: { runId: run.id },
    orderBy: { createdAt: "asc" },
  });
  const recentlyMessaged = new Set(
    (
      await prisma.outreachMessage.findMany({
        where: { sentAt: { gte: new Date(Date.now() - RECENT_OUTREACH_DAYS * 86_400_000) } },
        select: { leadId: true },
        distinct: ["leadId"],
      })
    ).map((m) => m.leadId),
  );

  const plan: ApplicationPlan = {
    runId: run.id,
    runCompletedAt: run.completedAt,
    promote: [],
    reject: [],
    flag: [],
    protectedLeads: [],
    insufficient: [],
    rescore: [],
    rescoreUnchanged: 0,
    rescoreOther: 0,
    rescoreSkipped: 0,
    leadsAddedSince: await prisma.lead.count({ where: { createdAt: { gt: run.startedAt } } }),
    kept: [],
    stale: [],
    staleShare: 0,
    staleWarning: false,
  };

  const flagOrProtect = (lead: GuardLead, reason: string, kind: "candidate" | "lead", subjectId: string): boolean => {
    // Un-flagged by hand: a manual override no apply reverses.
    if (lead.scoringKeptAt) {
      plan.kept.push({
        kind: "lead",
        id: lead.id,
        clinicName: lead.clinicName,
        reason: `you un-flagged it on ${lead.scoringKeptAt.toISOString().slice(0, 10)}. New scoring would reject it: ${reason}`,
      });
      return true;
    }
    if (lead.scoringRejectedAt) {
      plan.stale.push({
        kind,
        id: subjectId,
        clinicName: lead.clinicName,
        reason: "already flagged by new scoring",
        changes: [{ field: "Rejected by new scoring", compared: "not flagged", current: "flagged", at: lead.scoringRejectedAt.toISOString() }],
      });
      return false;
    }
    const guard = protectionReason(lead, recentlyMessaged);
    if (guard) {
      plan.protectedLeads.push({ kind: "lead", id: lead.id, clinicName: lead.clinicName, reason: `${guard}. New scoring would reject it: ${reason}` });
      return true;
    }
    plan.flag.push({ kind, id: subjectId, leadId: lead.id, clinicName: lead.clinicName, reason });
    return true;
  };

  // The new scorecard onto a comparison subject and, for a candidate, onto
  // the Pipeline lead it became.
  const addRescore = async (
    row: { subjectKind: string; subjectId: string; clinicName: string },
    b: ReturnType<typeof finish> | null,
    group: "unchanged" | "other",
    linkedLeadId?: string | null,
  ) => {
    if (!b) {
      plan.rescoreSkipped++;
      return;
    }
    const entry = { clinicName: row.clinicName, breakdown: serializeBreakdownV2(b), score: b.total, tier: b.tier };
    plan.rescore.push({ kind: row.subjectKind === "lead" ? "lead" : "candidate", id: row.subjectId, ...entry });
    if (row.subjectKind !== "lead") {
      const leadId =
        linkedLeadId !== undefined
          ? linkedLeadId
          : (await prisma.discoveryCandidate.findUnique({ where: { id: row.subjectId }, select: { promotedLeadId: true } }))?.promotedLeadId ?? null;
      if (leadId) plan.rescore.push({ kind: "lead", id: leadId, ...entry });
    }
    if (group === "unchanged") plan.rescoreUnchanged++;
    else plan.rescoreOther++;
  };

  const stale = (kind: "candidate" | "lead", id: string, clinicName: string, changes: StaleChange[]) =>
    plan.stale.push({ kind, id, clinicName, changes, reason: changes.map(describeChange).join("; ") });

  for (const row of rows) {
    // The stored breakdown re-judged under the current verdict rules (no
    // model call — finish() only re-totals and re-decides), so a comparison
    // run before the thin-evidence rule cannot flag a thin-evidence record.
    const stored = parseBreakdownV2(row.breakdown);
    const breakdown = stored ? finish(stored, stored.verdict.threshold) : null;

    // Unchanged: same outcome under both models. Re-scored only, and only
    // while the record still reads as the comparison saw it.
    if (row.outcome === "unchanged") {
      if (await changedSinceComparison(row, run.startedAt)) {
        plan.rescoreSkipped++;
        continue;
      }
      await addRescore(row, breakdown, "unchanged");
      continue;
    }
    if (row.outcome !== "newly_promoted" && row.outcome !== "newly_rejected" && row.outcome !== "newly_failed") continue;

    if (row.outcome === "newly_failed") {
      plan.insufficient.push({
        kind: row.subjectKind === "lead" ? "lead" : "candidate",
        id: row.subjectId,
        clinicName: row.clinicName,
        reason: `${row.oldStatus} today. ${row.flipReason ?? "Not enough evidence to judge."}`,
      });
      if (await changedSinceComparison(row, run.startedAt)) plan.rescoreSkipped++;
      else await addRescore(row, breakdown, "other");
      continue;
    }
    if (row.outcome === "newly_rejected" && breakdown?.verdict.status === "INSUFFICIENT") {
      plan.insufficient.push({
        kind: row.subjectKind === "lead" ? "lead" : "candidate",
        id: row.subjectId,
        clinicName: row.clinicName,
        reason: `${row.oldStatus} today. ${breakdown.verdict.reason}`,
      });
      if (await changedSinceComparison(row, run.startedAt)) plan.rescoreSkipped++;
      else await addRescore(row, breakdown, "other");
      continue;
    }
    if (row.subjectKind === "candidate") {
      const c = await prisma.discoveryCandidate.findUnique({
        where: { id: row.subjectId },
        select: {
          id: true,
          clinicName: true,
          status: true,
          icpTotal: true,
          icpTier: true,
          scoringModel: true,
          disqualifiedReason: true,
          enrichedAt: true,
          updatedAt: true,
          linkedinConflictLeadId: true,
          promotedLead: { select: LEAD_GUARD_SELECT },
        },
      });
      if (!c) {
        stale("candidate", row.subjectId, row.clinicName, [{ field: "record", compared: "present", current: "deleted", at: null }]);
        continue;
      }
      const changes = changesSince(row, run.startedAt, candidateStanding(c), c.enrichedAt, c.updatedAt, c.status);
      if (changes.length > 0) {
        stale("candidate", c.id, c.clinicName, changes);
        continue;
      }
      // Talking on LinkedIn: never promoted, by new scoring or anything else
      // (promoteWithin would refuse it and undo the whole apply).
      if (row.outcome === "newly_promoted" && c.linkedinConflictLeadId) {
        plan.protectedLeads.push({
          kind: "candidate",
          id: c.id,
          clinicName: c.clinicName,
          reason: `${TALKING_ON_LINKEDIN_LABEL} — new scoring would promote it, but it stays a candidate`,
        });
        continue;
      }
      if (row.outcome === "newly_promoted") {
        plan.promote.push({
          kind: "candidate",
          id: c.id,
          clinicName: c.clinicName,
          reason: breakdown?.verdict.reason ?? "Promoted by new scoring.",
          breakdown: row.breakdown,
          score: row.newScore,
          tier: row.newTier,
        });
        continue;
      }
      const reason = verdictReason(row, "Rejected by new scoring.");
      if (c.promotedLead) {
        if (flagOrProtect(c.promotedLead, reason, "candidate", c.id)) {
          await addRescore(row, breakdown, "other", c.promotedLead.id);
        } else {
          plan.rescoreSkipped++;
        }
      } else {
        plan.reject.push({ kind: "candidate", id: c.id, clinicName: c.clinicName, reason, breakdown: row.breakdown, score: row.newScore, tier: row.newTier });
      }
      continue;
    }

    if (row.outcome !== "newly_rejected") continue;
    const lead = await prisma.lead.findUnique({
      where: { id: row.subjectId },
      select: { ...LEAD_GUARD_SELECT, ...LEAD_SCORE_SELECT, enrichedAt: true, updatedAt: true },
    });
    if (!lead) {
      stale("lead", row.subjectId, row.clinicName, [{ field: "record", compared: "present", current: "deleted", at: null }]);
      continue;
    }
    const changes = changesSince(row, run.startedAt, leadStanding(lead), lead.enrichedAt, lead.updatedAt, null);
    if (changes.length > 0) {
      stale("lead", lead.id, lead.clinicName, changes);
      continue;
    }
    if (flagOrProtect(lead, verdictReason(row, "Rejected by new scoring."), "lead", lead.id)) {
      await addRescore(row, breakdown, "other");
    } else {
      plan.rescoreSkipped++;
    }
  }

  const considered = plan.promote.length + plan.reject.length + plan.flag.length + plan.protectedLeads.length + plan.stale.length;
  plan.staleShare = considered === 0 ? 0 : plan.stale.length / considered;
  plan.staleWarning = plan.staleShare > STALE_WARNING_SHARE;
  return { ok: true, plan };
}

// ─── Snapshots ─────────────────────────────────────────────────────────────

const CANDIDATE_FIELDS = [
  "status",
  "icpTotal",
  "icpTier",
  "scoringModel",
  "icpBreakdown",
  "disqualified",
  "disqualifiedReason",
  "promotedLeadId",
  "processedAt",
] as const;

const LEAD_FIELDS = ["stage", "scoringRejectedAt", "scoringRejectedReason", "scoringApplicationId"] as const;

// What a re-score writes, and all a revert of one compares and restores.
const CANDIDATE_SCORE_FIELDS = ["icpTotal", "icpTier", "icpBreakdown", "scoringModel"] as const;
const LEAD_SCORE_FIELDS = ["icpBreakdown", "icpBreakdownAt"] as const;

type Snapshot = Record<string, unknown>;

function pick(row: Record<string, unknown>, fields: readonly string[]): Snapshot {
  const out: Snapshot = {};
  for (const f of fields) {
    const v = row[f];
    out[f] = v instanceof Date ? v.toISOString() : v ?? null;
  }
  return out;
}

// icpTier is left out of the comparison: it is derived from the stored score
// and verdict, and re-banding the tiers (migration 20261024120000) rewrites
// it without anybody editing the record. It is still restored on revert.
function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return Object.keys(a)
    .filter((k) => k !== "icpTier")
    .every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}

function revive(snapshot: Snapshot, dateFields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...snapshot };
  for (const f of dateFields) if (typeof out[f] === "string") out[f] = new Date(out[f] as string);
  return out;
}

// ─── Apply ─────────────────────────────────────────────────────────────────

export type ApplyResult =
  | { ok: true; applicationId: string; promoted: number; rejected: number; flagged: number; protected: number; stale: number }
  | { ok: false; error: string };

export async function activeApplication() {
  return prisma.scoringApplication.findFirst({ where: { revertedAt: null }, orderBy: { appliedAt: "desc" } });
}

export async function applyScoring(now = new Date()): Promise<ApplyResult> {
  if (await activeApplication()) {
    return { ok: false, error: "New scoring is already applied. Revert it first to apply again." };
  }
  const planned = await planApplication();
  if (!planned.ok) return planned;
  const plan = planned.plan;
  const settings = await loadPipelineSettings();

  const id = await prisma.$transaction(
    async (tx) => {
      const app = await tx.scoringApplication.create({
        data: {
          comparisonRunId: plan.runId,
          appliedAt: now,
          previousModel: settings.scoringModel,
          promoted: plan.promote.length,
          rejected: plan.reject.length,
          flagged: plan.flag.length,
          protected: plan.protectedLeads.length,
          stale: plan.stale.length,
          protectedList: JSON.stringify(plan.protectedLeads),
          staleList: JSON.stringify(plan.stale),
        },
      });

      // Re-scores first: the flag written below on some of the same leads
      // is then the last write, which is what its revert checks against.
      for (const r of plan.rescore) {
        if (r.kind === "candidate") {
          const before = await tx.discoveryCandidate.findUniqueOrThrow({ where: { id: r.id } });
          const after = await tx.discoveryCandidate.update({
            where: { id: r.id },
            data: { icpTotal: r.score, icpTier: r.tier, icpBreakdown: r.breakdown, scoringModel: "v2" },
          });
          await tx.scoringApplicationItem.create({
            data: {
              applicationId: app.id,
              subjectKind: "candidate",
              subjectId: r.id,
              clinicName: r.clinicName,
              action: "rescored",
              before: JSON.stringify(pick(before, CANDIDATE_SCORE_FIELDS)),
              after: JSON.stringify(pick(after, CANDIDATE_SCORE_FIELDS)),
              afterUpdatedAt: after.updatedAt,
            },
          });
        } else {
          const before = await tx.lead.findUnique({ where: { id: r.id } });
          if (!before) continue;
          const after = await tx.lead.update({
            where: { id: r.id },
            data: { icpBreakdown: r.breakdown, icpBreakdownAt: now },
          });
          await tx.scoringApplicationItem.create({
            data: {
              applicationId: app.id,
              subjectKind: "lead",
              subjectId: r.id,
              clinicName: r.clinicName,
              action: "rescored",
              before: JSON.stringify(pick(before, LEAD_SCORE_FIELDS)),
              after: JSON.stringify(pick(after, LEAD_SCORE_FIELDS)),
              afterUpdatedAt: after.updatedAt,
            },
          });
        }
      }

      for (const p of plan.promote) {
        const before = await tx.discoveryCandidate.findUniqueOrThrow({ where: { id: p.id } });
        const breakdown = parseBreakdownV2(p.breakdown);
        await tx.discoveryCandidate.update({
          where: { id: p.id },
          data: {
            icpTotal: p.score,
            icpTier: p.tier,
            icpBreakdown: p.breakdown,
            scoringModel: "v2",
            disqualified: false,
            disqualifiedReason: null,
          },
        });
        const leadId = await promoteWithin(tx, p.id, breakdown, now);
        const after = await tx.discoveryCandidate.findUniqueOrThrow({ where: { id: p.id } });
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { updatedAt: true } });
        await tx.scoringApplicationItem.create({
          data: {
            applicationId: app.id,
            subjectKind: "candidate",
            subjectId: p.id,
            clinicName: p.clinicName,
            action: "promoted",
            before: JSON.stringify(pick(before, CANDIDATE_FIELDS)),
            after: JSON.stringify({ ...pick(after, CANDIDATE_FIELDS), leadUpdatedAt: lead.updatedAt.toISOString() }),
            afterUpdatedAt: after.updatedAt,
            createdLeadId: leadId,
          },
        });
      }

      for (const r of plan.reject) {
        const before = await tx.discoveryCandidate.findUniqueOrThrow({ where: { id: r.id } });
        const after = await tx.discoveryCandidate.update({
          where: { id: r.id },
          data: {
            status: "REJECTED",
            icpTotal: r.score,
            icpTier: r.tier,
            icpBreakdown: r.breakdown,
            scoringModel: "v2",
            disqualified: r.tier === "DISQUALIFIED",
            disqualifiedReason: r.reason,
            processedAt: now,
          },
        });
        await tx.scoringApplicationItem.create({
          data: {
            applicationId: app.id,
            subjectKind: "candidate",
            subjectId: r.id,
            clinicName: r.clinicName,
            action: "rejected",
            before: JSON.stringify(pick(before, CANDIDATE_FIELDS)),
            after: JSON.stringify(pick(after, CANDIDATE_FIELDS)),
            afterUpdatedAt: after.updatedAt,
          },
        });
      }

      for (const f of plan.flag) {
        const before = await tx.lead.findUniqueOrThrow({ where: { id: f.leadId } });
        const after = await tx.lead.update({
          where: { id: f.leadId },
          data: { scoringRejectedAt: now, scoringRejectedReason: f.reason, scoringApplicationId: app.id },
        });
        await tx.scoringApplicationItem.create({
          data: {
            applicationId: app.id,
            subjectKind: "lead",
            subjectId: f.leadId,
            clinicName: f.clinicName,
            action: "flagged",
            before: JSON.stringify(pick(before, LEAD_FIELDS)),
            after: JSON.stringify(pick(after, LEAD_FIELDS)),
            afterUpdatedAt: after.updatedAt,
          },
        });
      }
      return app.id;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  await savePipelineSettings({ ...settings, scoringModel: "v2" });
  return {
    ok: true,
    applicationId: id,
    promoted: plan.promote.length,
    rejected: plan.reject.length,
    flagged: plan.flag.length,
    protected: plan.protectedLeads.length,
    stale: plan.stale.length,
  };
}

// ─── Revert ────────────────────────────────────────────────────────────────

export interface KeptEntry {
  clinicName: string;
  kind: "candidate" | "lead";
  id: string;
  reason: string;
}

export type RevertResult =
  | { ok: true; restored: number; deletedLeads: number; kept: KeptEntry[] }
  | { ok: false; error: string };

// Whether anything was done on a lead after the apply: a message written or
// sent, a note, a call, a task, an activity entry.
async function leadWorkedOnSince(tx: Prisma.TransactionClient, leadId: string, since: Date): Promise<string | null> {
  const [messages, notes, calls, tasks, activity] = await Promise.all([
    tx.outreachMessage.count({ where: { leadId, OR: [{ createdAt: { gt: since } }, { sentAt: { gt: since } }] } }),
    tx.leadNote.count({ where: { leadId, createdAt: { gt: since } } }),
    tx.call.count({ where: { leadId, OR: [{ createdAt: { gt: since } }, { updatedAt: { gt: since } }] } }),
    tx.task.count({ where: { leadId, OR: [{ createdAt: { gt: since } }, { completedAt: { gt: since } }] } }),
    tx.activityLog.count({ where: { leadId, createdAt: { gt: since } } }),
  ]);
  if (messages) return "a message was written or sent after the apply";
  if (notes) return "a note was added after the apply";
  if (calls) return "a call was logged after the apply";
  if (tasks) return "a task was added after the apply";
  if (activity) return "there is activity on it after the apply";
  return null;
}

export async function revertScoring(applicationId: string): Promise<RevertResult> {
  const app = await prisma.scoringApplication.findUnique({
    where: { id: applicationId },
    include: { items: true },
  });
  if (!app) return { ok: false, error: "That scoring application no longer exists." };
  if (app.revertedAt) return { ok: false, error: "That scoring application has already been reverted." };

  const kept: KeptEntry[] = [];
  let restored = 0;
  let deletedLeads = 0;

  await prisma.$transaction(
    async (tx) => {
      // Promotions, rejections and flags first; re-scores last, so the
      // score restored on a lead is not mistaken for an edit made after the
      // apply when its flag is checked.
      const ordered = [
        ...app.items.filter((i) => i.action !== "rescored"),
        ...app.items.filter((i) => i.action === "rescored"),
      ];
      for (const item of ordered) {
        const after = JSON.parse(item.after) as Snapshot;
        const before = JSON.parse(item.before) as Snapshot;

        // A re-score is undone on its own fields alone: the old scorecard
        // comes back unless the scorecard itself was changed after the apply
        // (an override, a re-score by hand). Nothing else about the record
        // is touched either way.
        if (item.action === "rescored") {
          const fields = item.subjectKind === "lead" ? LEAD_SCORE_FIELDS : CANDIDATE_SCORE_FIELDS;
          const current =
            item.subjectKind === "lead"
              ? await tx.lead.findUnique({ where: { id: item.subjectId } })
              : await tx.discoveryCandidate.findUnique({ where: { id: item.subjectId } });
          if (!current) continue;
          if (!sameSnapshot(after, pick(current as Record<string, unknown>, fields))) {
            kept.push({
              kind: item.subjectKind === "lead" ? "lead" : "candidate",
              id: item.subjectId,
              clinicName: item.clinicName,
              reason: "its scorecard was changed after the apply, so the new score was left as you left it",
            });
            continue;
          }
          const data = revive(before, ["icpBreakdownAt"]);
          if (item.subjectKind === "lead") await tx.lead.update({ where: { id: item.subjectId }, data });
          else await tx.discoveryCandidate.update({ where: { id: item.subjectId }, data });
          restored++;
          continue;
        }

        if (item.subjectKind === "lead") {
          const lead = await tx.lead.findUnique({ where: { id: item.subjectId } });
          if (!lead) {
            kept.push({ kind: "lead", id: item.subjectId, clinicName: item.clinicName, reason: "deleted after the apply" });
            continue;
          }
          const edited = lead.scoringKeptAt
            ? "you un-flagged it, so it stays as you left it"
            : !sameSnapshot(after, pick(lead, LEAD_FIELDS)) || lead.updatedAt.getTime() !== item.afterUpdatedAt.getTime()
              ? "it was edited after the apply"
              : await leadWorkedOnSince(tx, lead.id, app.appliedAt);
          // The flag is the apply's own change, so it comes off either way —
          // nothing the person did is touched. A lead they worked on is listed.
          await tx.lead.update({
            where: { id: lead.id },
            data: edited
              ? { scoringRejectedAt: null, scoringRejectedReason: null, scoringApplicationId: null }
              : revive(before, ["scoringRejectedAt"]),
          });
          if (edited) kept.push({ kind: "lead", id: lead.id, clinicName: item.clinicName, reason: `flag removed; ${edited}, so the rest was left as you left it` });
          else restored++;
          continue;
        }

        const c = await tx.discoveryCandidate.findUnique({ where: { id: item.subjectId } });
        if (!c) {
          kept.push({ kind: "candidate", id: item.subjectId, clinicName: item.clinicName, reason: "deleted after the apply" });
          continue;
        }
        const candidateChanged =
          !sameSnapshot(
            Object.fromEntries(Object.entries(after).filter(([k]) => k !== "leadUpdatedAt")),
            pick(c, CANDIDATE_FIELDS),
          ) || c.updatedAt.getTime() !== item.afterUpdatedAt.getTime();
        if (candidateChanged) {
          kept.push({ kind: "candidate", id: c.id, clinicName: item.clinicName, reason: "changed after the apply, left as you left it" });
          continue;
        }

        if (item.createdLeadId) {
          const lead = await tx.lead.findUnique({ where: { id: item.createdLeadId } });
          if (lead) {
            const worked =
              lead.updatedAt.toISOString() !== after.leadUpdatedAt
                ? "it was edited after the apply"
                : await leadWorkedOnSince(tx, lead.id, app.appliedAt);
            if (worked) {
              kept.push({ kind: "lead", id: lead.id, clinicName: item.clinicName, reason: `lead created by the apply kept: ${worked}` });
              continue;
            }
            await tx.discoveryCandidate.update({ where: { id: c.id }, data: revive(before, ["processedAt"]) });
            await tx.lead.delete({ where: { id: lead.id } });
            deletedLeads++;
            restored++;
            continue;
          }
        }
        await tx.discoveryCandidate.update({ where: { id: c.id }, data: revive(before, ["processedAt"]) });
        restored++;
      }

      await tx.scoringApplication.update({
        where: { id: app.id },
        data: { revertedAt: new Date(), revertKeptList: JSON.stringify(kept) },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  const settings = await loadPipelineSettings();
  await savePipelineSettings({ ...settings, scoringModel: app.previousModel === "v2" ? "v2" : "v1" });
  return { ok: true, restored, deletedLeads, kept };
}

export async function scoringApplicationHistory(limit = 10) {
  return prisma.scoringApplication.findMany({
    orderBy: { appliedAt: "desc" },
    take: limit,
    select: {
      id: true,
      appliedAt: true,
      revertedAt: true,
      promoted: true,
      rejected: true,
      flagged: true,
      protected: true,
      stale: true,
      protectedList: true,
      staleList: true,
      revertKeptList: true,
    },
  });
}

// "Un-flag (keep this lead)": the flag comes off and the lead is marked kept
// by hand. Every later apply skips it (plan.kept) and a revert leaves it as it
// is. It is a manual override, recorded with its time.
export async function unflagLead(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { scoringRejectedAt: true } });
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (!lead.scoringRejectedAt) return { ok: false, error: "That lead is not flagged." };
  await prisma.lead.update({
    where: { id },
    data: { scoringRejectedAt: null, scoringRejectedReason: null, scoringApplicationId: null, scoringKeptAt: new Date() },
  });
  return { ok: true };
}
