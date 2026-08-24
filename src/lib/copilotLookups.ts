// Everything the copilot can look up, and the only way it reaches the
// database.
//
// Read this file as the copilot's permissions, because that is what it is.
// The model is never handed Prisma, a query, a table name or a filter it
// composes itself — it is handed the functions below by name, each of which
// runs a query written here, in full, by hand. There is no prisma.*.create,
// .update, .upsert or .delete anywhere in this file and there must never be
// one: the read-only guarantee the copilot is sold on is this file having no
// way to write, not a promise the model is asked to keep.
//
// That rule has one place it is easy to break by accident, so it is worth
// naming: the daily checklist seeds a day's rows the first time that day is
// opened (ensureDay in src/lib/dailyChecklistStore.ts). The lookup here does
// not use it. It reads whatever rows exist and fills the gaps for display, so
// asking the copilot about a day never writes that day into being.
//
// What each function returns is composed for a reader rather than dumped: the
// same labels and computed values the pages show (health status and its
// reason, ICP tier and its action, KPI flags against their bands) so an answer
// about a client says what the client page says. Ids come back too, because
// the summary lookups are how the model finds the id a detail lookup needs.
//
// Scraped text is the one thing handled specially. Website crawls and review
// counts come from third-party pages nobody here wrote, so they are nested
// under UNTRUSTED_CONTENT_KEY with the warning that names them for what they
// are. The system prompt in src/lib/copilot.ts is the other half of that; the
// fence is worth nothing without it and it is worth nothing without the fence.
//
// Server-only: this imports Prisma. It is called from
// src/lib/actions/copilot.ts and from nowhere else.

import { prisma } from "@/lib/prisma";
import {
  OUTREACH_STEP_LABELS,
  OutreachStep,
} from "@/lib/outreachSequence";
import {
  UNTRUSTED_CONTENT_KEY,
  UNTRUSTED_CONTENT_WARNING,
} from "@/lib/copilot";
import {
  CLIENT_STATUS_LABELS,
  ClientStatus,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_LABELS,
  LeadStage,
  LibraryCategory,
  CONTACTED_STAGES,
  OPEN_STAGES,
} from "@/lib/constants";
import {
  DISCOVERY_SOURCE_LABELS,
  DISCOVERY_STATUSES,
  DISCOVERY_STATUS_LABELS,
  DISCOVERY_STATUS_MEANINGS,
  DiscoveryStatus,
  parseBreakdown,
} from "@/lib/discovery";
import {
  HEALTH_ACTIONS,
  HEALTH_LABELS,
  HEALTH_WINDOW_WEEKS,
  computeHealth,
  isHealthScored,
} from "@/lib/health";
import {
  ICP_CATEGORIES,
  ICP_DISQUALIFIERS,
  ICP_GAPS,
  ICP_MAX_SCORE,
  ICP_TIER_ACTIONS,
  ICP_TIER_LABELS,
  ICP_TIER_ORDER,
  IcpTier,
  leadTier,
  scoreIcp,
} from "@/lib/icp";
import { computeMetrics } from "@/lib/kpi";
import { CALL_STATUS_LABELS, CALL_TYPE_LABELS, isCallOverdue } from "@/lib/calls";
import {
  CONTRACT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  ONBOARDING_TOTAL_STEPS,
  invoiceTotals,
  isOnboarding,
  stepMeta,
} from "@/lib/onboarding";
import {
  PIPELINE_STEP_BLURBS,
  PIPELINE_STEP_KEYS,
  PIPELINE_STEP_LABELS,
  costPerCandidate,
  fmtEstimate,
} from "@/lib/pipelineSettings";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import {
  AWARENESS_LEVEL_LABELS,
  AwarenessLevel,
  CONCEPT_STATUSES,
  CONCEPT_STATUS_LABELS,
  CREATIVE_STATUSES,
  CREATIVE_STATUS_LABELS,
  CREATIVE_TYPE_LABELS,
  ConceptStatus,
  CreativeStatus,
  CreativeType,
  RESEARCH_NOTE_TYPE_LABELS,
  ResearchNoteType,
  sophisticationMeta,
} from "@/lib/adhub";
import {
  DAILY_CHECKLIST_CATEGORIES,
  DAILY_CHECKLIST_CATEGORY_LABELS,
  DAILY_CHECKLIST_ITEMS,
  checkedCount,
  dayKey,
  itemsInCategory,
  parseDayKey,
  readDay,
  toChecklistDay,
} from "@/lib/dailyChecklist";
import { readDayRows } from "@/lib/dailyChecklistStore";
import { loadDailyNumbers } from "@/lib/dailyNumbers";
import {
  MESSAGES_WINDOW_DAYS,
  REPLY_RATE_WINDOW_DAYS,
  messagesSent,
  daysAgo,
  discoveryBooked,
  qualifiedLeads,
  replyRate,
} from "@/lib/funnel";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TaskStatus,
  isTaskStatus,
} from "@/lib/tasks";

// ─── Ceilings ──────────────────────────────────────────────────────────────
//
// Every list here is capped. A lookup's result is going back into a model's
// context on every subsequent round of the conversation, so an uncapped list
// is not a big answer — it is a bill that grows with the database. Where a cap
// bites, the result says so, because a truncated list the model thinks is
// complete is worse than no list.

const LEADS_MAX = 60;
const LEAD_NOTES_MAX = 15;
const CALLS_MAX = 15;
// Five steps, three variants on one of them, and regenerating leaves the older
// attempts in place — so the cap is generous enough for a whole sequence with
// a couple of rewrites in it, and no more.
const OUTREACH_MESSAGES_MAX = 20;
const DISCOVERY_RECENT_MAX = 12;
const CLIENTS_MAX = 60;
const REPORT_WEEKS_MAX = 12;
const FOLLOW_UPS_MAX = 30;
const ACTIVITY_MAX = 25;
const TASKS_MAX = 50;
const CANDIDATES_MAX = 60;
const CALL_LOG_MAX = 40;
const PERSONAS_MAX = 20;
const DESIRES_MAX = 30;
const RESEARCH_NOTES_MAX = 20;
const CONCEPTS_MAX = 30;
const CREATIVES_PER_CONCEPT_MAX = 8;
const PERFORMANCE_LOGS_MAX = 12;
const LIBRARY_MAX = 40;

// Long-form bodies — a library template, a research note, a persona's answers.
// Enough to read what it says and act on it; short of pasting whole documents
// into a conversation that then carries them for every later question.
const BODY_MAX_CHARS = 1200;

// How far ahead "coming up" reaches, matching the dashboard's own window.
const UPCOMING_DAYS = 7;

// How much of a website crawl to pass on. The crawler stores up to 20k
// characters across three pages; a question about a clinic is answered by the
// first page of it, and the rest is a blog that would crowd out every other
// lookup in the conversation.
const SCRAPED_NOTES_MAX_CHARS = 1500;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Shared shaping ────────────────────────────────────────────────────────

// Dates go to the model as ISO strings. Unambiguous, sorts correctly, and the
// model can do the "three weeks ago" arithmetic against `now`, which every
// result carries.
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function day(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

// The fence around third-party text. Null when a record has none, so a clinic
// that has never been enriched does not arrive carrying an empty warning.
function scraped(record: {
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
}): Record<string, unknown> | null {
  const { websiteNotes, metaAdsSignal, reviewCount } = record;
  if (!websiteNotes && !metaAdsSignal && reviewCount === null) return null;
  const notes = websiteNotes?.slice(0, SCRAPED_NOTES_MAX_CHARS) ?? null;
  return {
    warning: UNTRUSTED_CONTENT_WARNING,
    websiteNotes: notes,
    websiteNotesTruncated:
      websiteNotes !== null && websiteNotes.length > SCRAPED_NOTES_MAX_CHARS,
    metaAdsSignal,
    googleReviewCount: reviewCount,
  };
}

function stageLabel(stage: string): string {
  return LEAD_STAGE_LABELS[stage as LeadStage] ?? stage;
}

// A long body, cut with a marker rather than silently. Text this app's own
// users wrote — a template, a research note — so it is not fenced the way
// scraped copy is; it is only held to a length.
function body(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > BODY_MAX_CHARS
    ? `${text.slice(0, BODY_MAX_CHARS)}… [truncated]`
    : text;
}

function tierLabel(tier: IcpTier | null): string {
  return tier === null ? "Not scored" : ICP_TIER_LABELS[tier];
}

// A list that hit its ceiling says so in the same breath as the count, so the
// model can qualify an answer instead of stating a total it was not given.
function listMeta(returned: number, total: number, cap: number) {
  return {
    returned,
    totalMatching: total,
    truncated: total > cap,
    ...(total > cap
      ? {
          note: `Only the first ${cap} are listed. Say so if the answer depends on the whole list.`,
        }
      : {}),
  };
}

// ─── 1. Pipeline leads ─────────────────────────────────────────────────────

export async function getPipelineLeads(args: {
  tier?: string;
  stage?: string;
}): Promise<unknown> {
  const stage =
    args.stage && (LEAD_STAGES as readonly string[]).includes(args.stage)
      ? (args.stage as LeadStage)
      : null;
  const tier =
    args.tier === "UNSCORED"
      ? "UNSCORED"
      : args.tier && (ICP_TIER_ORDER as string[]).includes(args.tier)
        ? (args.tier as IcpTier)
        : null;

  const leads = await prisma.lead.findMany({
    where: { archived: false, ...(stage ? { stage } : {}) },
    orderBy: { updatedAt: "desc" },
  });

  // Tier is computed from the scorecard rather than stored, so it is filtered
  // here rather than in the query — the same rule the pipeline table follows.
  const matching = leads.filter((lead) => {
    if (tier === null) return true;
    const t = leadTier(lead);
    return tier === "UNSCORED" ? t === null : t === tier;
  });

  return {
    filters: {
      tier: args.tier ?? "any",
      stage: stage ? stageLabel(stage) : "any",
    },
    ...listMeta(Math.min(matching.length, LEADS_MAX), matching.length, LEADS_MAX),
    openPipelineValue: matching.reduce((s, l) => s + (l.estValue ?? 0), 0),
    leads: matching.slice(0, LEADS_MAX).map((lead) => {
      const tierNow = leadTier(lead);
      return {
        id: lead.id,
        clinicName: lead.clinicName,
        contactName: lead.contactName,
        location: lead.location,
        stage: stageLabel(lead.stage),
        estValue: lead.estValue,
        icpTier: tierLabel(tierNow),
        icpScore:
          lead.icpScoredAt === null
            ? null
            : `${scoreIcp(lead).total} of ${ICP_MAX_SCORE}`,
        icpAction: tierNow ? ICP_TIER_ACTIONS[tierNow] : null,
        nextFollowUp: iso(lead.nextFollowUp),
        leadSource: lead.leadSource,
        enriched: lead.enrichedAt !== null,
        connectionRequestSent: lead.connectionRequestSentAt !== null,
        updatedAt: iso(lead.updatedAt),
      };
    }),
  };
}

// ─── 2. One lead ───────────────────────────────────────────────────────────

export async function getLeadDetail(args: { id: string }): Promise<unknown> {
  const lead = await prisma.lead.findUnique({
    where: { id: args.id },
    include: {
      notes: { orderBy: { createdAt: "desc" }, take: LEAD_NOTES_MAX },
      calls: { orderBy: { scheduledAt: "desc" }, take: CALLS_MAX },
      client: { select: { id: true, clinicName: true, status: true } },
      candidate: { select: { id: true, batchLabel: true, source: true } },
      outreach: { orderBy: { createdAt: "desc" }, take: OUTREACH_MESSAGES_MAX },
    },
  });
  if (!lead) {
    return {
      found: false,
      message:
        "No lead with that id. Call getPipelineLeads to find the right one — ids are not guessable.",
    };
  }

  const score = scoreIcp(lead);
  const tier = leadTier(lead);

  return {
    found: true,
    id: lead.id,
    clinicName: lead.clinicName,
    archived: lead.archived,
    stage: stageLabel(lead.stage),
    estValue: lead.estValue,
    nextFollowUp: iso(lead.nextFollowUp),
    createdAt: iso(lead.createdAt),
    contact: {
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      location: lead.location,
      timeZone: lead.timeZone,
      websiteUrl: lead.websiteUrl,
      linkedinUrl: lead.linkedinUrl,
      companyLinkedinUrl: lead.companyLinkedinUrl,
      facebookUrl: lead.facebookUrl,
      leadSource: lead.leadSource,
      connectionRequestSentAt: iso(lead.connectionRequestSentAt),
      connectionAcceptedAt: iso(lead.connectionAcceptedAt),
      repliedAt: iso(lead.repliedAt),
      loomUrl: lead.loomUrl,
    },
    // The outreach sequence, so "where has this one got to" and "what did we
    // already say to them" are answerable. Written by this app from its own
    // evidence, so it is ours rather than third-party text — it sits outside
    // the untrusted fence, exactly as the old outreachHook did.
    outreach: lead.outreach.map((m) => ({
      step: OUTREACH_STEP_LABELS[m.step as OutreachStep] ?? m.step,
      variant: m.variant,
      sentAt: iso(m.sentAt),
      draftedAt: iso(m.createdAt),
      content: m.content,
    })),
    icp: {
      scored: lead.icpScoredAt !== null,
      scoredAt: iso(lead.icpScoredAt),
      tier: tierLabel(tier),
      action: tier ? ICP_TIER_ACTIONS[tier] : null,
      total: lead.icpScoredAt === null ? null : score.total,
      maxScore: ICP_MAX_SCORE,
      disqualified: score.disqualified,
      // Every disqualifier, not only the triggered ones: "nothing disqualifies
      // this lead" is an answer, and it needs the full list to be one.
      disqualifiers: ICP_DISQUALIFIERS.map((d) => ({
        label: d.label,
        triggered: lead[d.key],
      })),
      categories: ICP_CATEGORIES.map((c) => ({
        letter: c.letter,
        title: c.title,
        score: lead[c.key],
        max: c.max,
        // Which band that score is, in the framework's own words, so the model
        // quotes the scorecard rather than paraphrasing a number.
        band:
          c.options.find((o) => o.points === lead[c.key])?.label ??
          "Not scored",
      })),
      // Inverted on purpose — a gap is a point, because a gap is what this
      // agency is hired to fill.
      gaps: ICP_GAPS.map((g) => ({ label: g.label, present: lead[g.key] })),
      notes: lead.icpNotes,
    },
    enrichment: {
      enrichedAt: iso(lead.enrichedAt),
      reviewsCheckedAt: iso(lead.reviewsCheckedAt),
      staffCountRaw: lead.staffCountRaw,
      [UNTRUSTED_CONTENT_KEY]: scraped(lead),
    },
    calls: lead.calls.map((c) => ({
      type: CALL_TYPE_LABELS[c.type as keyof typeof CALL_TYPE_LABELS] ?? c.type,
      status:
        CALL_STATUS_LABELS[c.status as keyof typeof CALL_STATUS_LABELS] ??
        c.status,
      scheduledAt: iso(c.scheduledAt),
      overdue: isCallOverdue(c),
      notes: c.notes,
    })),
    notes: lead.notes.map((n) => ({
      createdAt: iso(n.createdAt),
      body: n.body,
    })),
    convertedToClient: lead.client
      ? {
          id: lead.client.id,
          clinicName: lead.client.clinicName,
          status:
            CLIENT_STATUS_LABELS[lead.client.status as ClientStatus] ??
            lead.client.status,
        }
      : null,
    cameFromDiscovery: lead.candidate
      ? { batchLabel: lead.candidate.batchLabel, source: lead.candidate.source }
      : null,
  };
}

// ─── 3. The discovery queue ────────────────────────────────────────────────

export async function getDiscoveryQueueStatus(): Promise<unknown> {
  const [grouped, recent, settings] = await Promise.all([
    prisma.discoveryCandidate.groupBy({ by: ["status"], _count: true }),
    prisma.discoveryCandidate.findMany({
      orderBy: { updatedAt: "desc" },
      take: DISCOVERY_RECENT_MAX,
    }),
    loadPipelineSettings(),
  ]);

  const counts = Object.fromEntries(
    DISCOVERY_STATUSES.map((status) => [
      DISCOVERY_STATUS_LABELS[status],
      grouped.find((g) => g.status === status)?._count ?? 0,
    ]),
  );

  return {
    promotionThreshold: `A candidate needs ${settings.promotionThreshold} of ${ICP_MAX_SCORE} to be promoted into the pipeline. Anything below that is rejected.`,
    countsByStatus: counts,
    statusMeanings: Object.fromEntries(
      DISCOVERY_STATUSES.map((s) => [
        DISCOVERY_STATUS_LABELS[s],
        DISCOVERY_STATUS_MEANINGS[s],
      ]),
    ),
    unprocessed: grouped
      .filter((g) =>
        (["PENDING", "ENRICHING", "SCORED", "FAILED"] as string[]).includes(
          g.status,
        ),
      )
      .reduce((s, g) => s + g._count, 0),
    recentCandidates: recent.map((c) => {
      const breakdown = parseBreakdown(c.icpBreakdown);
      return {
        id: c.id,
        clinicName: c.clinicName,
        location: c.location,
        status:
          DISCOVERY_STATUS_LABELS[c.status as DiscoveryStatus] ?? c.status,
        batchLabel: c.batchLabel,
        source: c.source,
        icpTotal: c.icpTotal,
        icpTier: c.icpTier,
        disqualifiedReason: c.disqualifiedReason,
        failureReason: c.failureReason,
        // The model's own summary from the scoring run, where there was one.
        // It is this app's text about the candidate, not scraped copy.
        scoringSummary: breakdown?.summary || null,
        flaggedForSecondLook: c.secondLookFlagged,
        secondLookReason: c.secondLookReason,
        processedAt: iso(c.processedAt),
        [UNTRUSTED_CONTENT_KEY]: scraped(c),
      };
    }),
  };
}

// ─── 4. Client health ──────────────────────────────────────────────────────

export async function getClientHealthSummary(): Promise<unknown> {
  const clients = await prisma.client.findMany({
    orderBy: { clinicName: "asc" },
    include: {
      reports: { orderBy: { weekStart: "desc" }, take: HEALTH_WINDOW_WEEKS },
    },
  });

  const scored = clients.filter((c) => isHealthScored(c.status));

  return {
    healthWindowWeeks: HEALTH_WINDOW_WEEKS,
    howHealthWorks:
      "Health is computed from the last few weekly reports, not typed in. Show rate against target is the core metric; cost per lead never drives the status on its own. Too little reported volume comes back as Ramping rather than as good or bad news.",
    countsByStatus: Object.fromEntries(
      (Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map((s) => [
        CLIENT_STATUS_LABELS[s],
        clients.filter((c) => c.status === s).length,
      ]),
    ),
    ...listMeta(
      Math.min(scored.length, CLIENTS_MAX),
      scored.length,
      CLIENTS_MAX,
    ),
    activeClients: scored.slice(0, CLIENTS_MAX).map((client) => {
      const health = computeHealth(client, client.reports);
      return {
        id: client.id,
        clinicName: client.clinicName,
        packageName: client.packageName,
        monthlyFee: client.monthlyFee,
        activeSince: day(client.activeSince),
        health: HEALTH_LABELS[health.status],
        reason: health.reason,
        whatItAsksOfYou: HEALTH_ACTIONS[health.status],
        trend: health.trend,
        manuallyFlagged: health.overridden,
        bookedConsultsInWindow: health.booked,
        weeksJudged: health.weeks.length,
      };
    }),
    // Onboarding, paused and churned clients carry no health status by design.
    // Naming them stops the model reporting an active book of three when there
    // are seven clients on the shelf.
    otherClients: clients
      .filter((c) => !isHealthScored(c.status))
      .slice(0, CLIENTS_MAX)
      .map((c) => ({
        id: c.id,
        clinicName: c.clinicName,
        status: CLIENT_STATUS_LABELS[c.status as ClientStatus] ?? c.status,
        onboardingStep: isOnboarding(c.onboardingStep)
          ? `${c.onboardingStep} of ${ONBOARDING_TOTAL_STEPS} — ${stepMeta(c.onboardingStep).title}`
          : null,
      })),
  };
}

// ─── 5. One client ─────────────────────────────────────────────────────────

export async function getClientDetail(args: { id: string }): Promise<unknown> {
  const client = await prisma.client.findUnique({
    where: { id: args.id },
    include: {
      checklist: { orderBy: { sortOrder: "asc" } },
      reports: { orderBy: { weekStart: "desc" }, take: REPORT_WEEKS_MAX },
      invoices: { orderBy: { issuedOn: "desc" } },
      calls: { orderBy: { scheduledAt: "desc" }, take: CALLS_MAX },
      lead: { select: { id: true, clinicName: true } },
    },
  });
  if (!client) {
    return {
      found: false,
      message:
        "No client with that id. Call getClientHealthSummary to find the right one — ids are not guessable.",
    };
  }

  const health = isHealthScored(client.status)
    ? computeHealth(client, client.reports)
    : null;
  const done = client.checklist.filter((i) => i.status === "DONE");
  const blockingOutstanding = client.checklist.filter(
    (i) => i.blocking && i.status !== "DONE",
  );
  const totals = invoiceTotals(client.invoices);

  return {
    found: true,
    id: client.id,
    clinicName: client.clinicName,
    status: CLIENT_STATUS_LABELS[client.status as ClientStatus] ?? client.status,
    contact: {
      contactName: client.contactName,
      email: client.email,
      phone: client.phone,
      timeZone: client.timeZone,
    },
    commercials: {
      packageName: client.packageName,
      monthlyFee: client.monthlyFee,
      contractStart: day(client.contractStart),
      activeSince: day(client.activeSince),
      contractStatus:
        CONTRACT_STATUS_LABELS[
          client.contractStatus as keyof typeof CONTRACT_STATUS_LABELS
        ] ?? client.contractStatus,
      invoicesBilled: totals.billed,
      invoicesCollected: totals.collected,
      invoicesOutstanding: totals.outstanding,
      unpaidInvoices: client.invoices
        .filter((i) => i.status !== "PAID")
        .map((i) => ({
          issuedOn: day(i.issuedOn),
          dueDate: day(i.dueDate),
          amount: i.amount,
          status:
            INVOICE_STATUS_LABELS[
              i.status as keyof typeof INVOICE_STATUS_LABELS
            ] ?? i.status,
          memo: i.memo,
        })),
    },
    onboarding: {
      inProgress: isOnboarding(client.onboardingStep),
      step: isOnboarding(client.onboardingStep)
        ? `${client.onboardingStep} of ${ONBOARDING_TOTAL_STEPS} — ${stepMeta(client.onboardingStep).title}`
        : "Not running",
      kickoffAt: iso(client.kickoffAt),
      phiApproach: client.phiApproach,
    },
    delivery: {
      checklistDone: done.length,
      checklistTotal: client.checklist.length,
      // Blocking items are the ones that gate going live, so they are called
      // out rather than left to be spotted in the list below.
      blockingOutstanding: blockingOutstanding.map((i) => i.title),
      checklist: client.checklist.map((i) => ({
        title: i.title,
        status: i.status,
        blocking: i.blocking,
        completedAt: day(i.completedAt),
        notes: i.notes,
      })),
    },
    health: health
      ? {
          status: HEALTH_LABELS[health.status],
          reason: health.reason,
          whatItAsksOfYou: HEALTH_ACTIONS[health.status],
          trend: health.trend,
          manuallyFlagged: health.overridden,
        }
      : {
          status: "Not scored",
          reason:
            "Only active clients carry a health status — onboarding, paused and churned ones do not.",
        },
    recentReports: client.reports.map((r) => weekRow(r)),
    calls: client.calls.map((c) => ({
      type: CALL_TYPE_LABELS[c.type as keyof typeof CALL_TYPE_LABELS] ?? c.type,
      status:
        CALL_STATUS_LABELS[c.status as keyof typeof CALL_STATUS_LABELS] ??
        c.status,
      scheduledAt: iso(c.scheduledAt),
      overdue: isCallOverdue(c),
      notes: c.notes,
    })),
    notes: client.notes,
    cameFromLead: client.lead ? { id: client.lead.id } : null,
  };
}

// One week of reporting, with the three metrics computed and flagged the same
// way the reporting page flags them.
function weekRow(r: {
  weekStart: Date;
  spend: number;
  leads: number;
  booked: number;
  shows: number;
  revenue: number;
  notes?: string | null;
}) {
  const m = computeMetrics(r);
  return {
    weekStart: day(r.weekStart),
    spend: r.spend,
    leads: r.leads,
    booked: r.booked,
    shows: r.shows,
    revenue: r.revenue,
    cpl: round(m.cpl),
    cplFlag: m.cplFlag,
    leadToBooked: round(m.leadToBooked),
    leadToBookedFlag: m.leadToBookedFlag,
    showRate: round(m.showRate),
    showRateFlag: m.showRateFlag,
    ...(r.notes === undefined ? {} : { notes: r.notes }),
  };
}

// ─── 6. Reporting trends ───────────────────────────────────────────────────

export async function getReportingTrends(args: {
  clientId?: string;
}): Promise<unknown> {
  const flagKey =
    "green = inside the target band, yellow = just outside it, red = outside, na = nothing to compute it from.";

  if (args.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: args.clientId },
      select: { id: true, clinicName: true },
    });
    if (!client) {
      return {
        found: false,
        message:
          "No client with that id. Call getClientHealthSummary to find the right one, or omit clientId for the whole book.",
      };
    }
    const reports = await prisma.weeklyReport.findMany({
      where: { clientId: client.id },
      orderBy: { weekStart: "desc" },
      take: REPORT_WEEKS_MAX,
    });
    return {
      found: true,
      scope: `${client.clinicName} only`,
      clientId: client.id,
      flagKey,
      weeksReturned: reports.length,
      // Oldest first: a trend reads forwards.
      weeks: [...reports].reverse().map((r) => weekRow(r)),
    };
  }

  // No client named: every client's weeks, totalled per week. Ratios are
  // recomputed from the totals rather than averaged from each client's own —
  // an average of percentages weights a client with four leads the same as one
  // with forty.
  const reports = await prisma.weeklyReport.findMany({
    orderBy: { weekStart: "desc" },
    include: { client: { select: { clinicName: true } } },
    // Enough rows to cover the window across a book of clients.
    take: REPORT_WEEKS_MAX * CLIENTS_MAX,
  });

  const byWeek = new Map<
    string,
    { weekStart: Date; spend: number; leads: number; booked: number; shows: number; revenue: number; clients: Set<string> }
  >();
  for (const r of reports) {
    const key = r.weekStart.toISOString();
    const row =
      byWeek.get(key) ??
      {
        weekStart: r.weekStart,
        spend: 0,
        leads: 0,
        booked: 0,
        shows: 0,
        revenue: 0,
        clients: new Set<string>(),
      };
    row.spend += r.spend;
    row.leads += r.leads;
    row.booked += r.booked;
    row.shows += r.shows;
    row.revenue += r.revenue;
    row.clients.add(r.client.clinicName);
    byWeek.set(key, row);
  }

  const weeks = Array.from(byWeek.values())
    .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
    .slice(0, REPORT_WEEKS_MAX)
    .reverse();

  return {
    found: true,
    scope: "All clients, totalled per week",
    flagKey,
    note: "These are book-wide totals. For one clinic's numbers, call this again with that client's id.",
    weeksReturned: weeks.length,
    weeks: weeks.map((w) => ({
      ...weekRow(w),
      clientsReporting: w.clients.size,
    })),
  };
}

// ─── 7. What is due ────────────────────────────────────────────────────────

export async function getFollowUpsDue(): Promise<unknown> {
  const now = new Date();
  const horizon = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);

  const [leads, calls, invoices] = await Promise.all([
    prisma.lead.findMany({
      where: {
        archived: false,
        nextFollowUp: { not: null, lte: horizon },
      },
      orderBy: { nextFollowUp: "asc" },
      take: FOLLOW_UPS_MAX,
    }),
    // No lower bound: a call still marked Scheduled after its time has passed
    // is overdue, not gone. Archived leads have been closed out, so theirs
    // stop counting.
    prisma.call.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { lte: horizon },
        OR: [{ leadId: null }, { lead: { archived: false } }],
      },
      orderBy: { scheduledAt: "asc" },
      take: FOLLOW_UPS_MAX,
      include: {
        lead: { select: { id: true, clinicName: true } },
        client: { select: { id: true, clinicName: true } },
      },
    }),
    // Money owed is dated work too — it is the calendar's third kind of event
    // beside calls and follow-ups, so it is answered by the same lookup. Only
    // unpaid ones, and only those with a due date: an invoice nobody put a date
    // on is not due at a time.
    prisma.invoice.findMany({
      where: {
        status: { not: "PAID" },
        dueDate: { not: null, lte: horizon },
      },
      orderBy: { dueDate: "asc" },
      take: FOLLOW_UPS_MAX,
      include: { client: { select: { id: true, clinicName: true } } },
    }),
  ]);

  const followUps = leads.map((l) => ({
    leadId: l.id,
    clinicName: l.clinicName,
    contactName: l.contactName,
    stage: stageLabel(l.stage),
    dueAt: iso(l.nextFollowUp),
    overdue: l.nextFollowUp !== null && l.nextFollowUp < now,
    estValue: l.estValue,
  }));

  const callRows = calls.map((c) => ({
    type: CALL_TYPE_LABELS[c.type as keyof typeof CALL_TYPE_LABELS] ?? c.type,
    with: c.lead?.clinicName ?? c.client?.clinicName ?? "Unattached",
    leadId: c.lead?.id ?? null,
    clientId: c.client?.id ?? null,
    scheduledAt: iso(c.scheduledAt),
    overdue: isCallOverdue(c, now),
    notes: c.notes,
  }));

  const invoiceRows = invoices.map((i) => ({
    clientId: i.client.id,
    clinicName: i.client.clinicName,
    amount: i.amount,
    issuedOn: day(i.issuedOn),
    dueDate: day(i.dueDate),
    overdue: i.dueDate !== null && i.dueDate < now,
    memo: i.memo,
  }));

  return {
    now: iso(now),
    windowDays: UPCOMING_DAYS,
    overdueCount:
      followUps.filter((f) => f.overdue).length +
      callRows.filter((c) => c.overdue).length +
      invoiceRows.filter((i) => i.overdue).length,
    leadFollowUps: followUps,
    calls: callRows,
    invoicesDue: invoiceRows,
    alsoCheck:
      "This is dated work only. The task board is getTasks and the day's routine is getDailyChecklistStatus; neither is included here.",
    reminder:
      "You cannot mark any of these done, reschedule them or send anything. Point the operator at the lead, client or invoice record, where they do it themselves.",
  };
}

// ─── 8. Recent activity ────────────────────────────────────────────────────

export async function getRecentActivity(): Promise<unknown> {
  const entries = await prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: ACTIVITY_MAX,
    include: {
      client: { select: { id: true, clinicName: true } },
      lead: { select: { id: true, clinicName: true } },
    },
  });

  return {
    now: iso(new Date()),
    note: "The milestone log. It records six kinds of event — a lead converted, a report generated, a contract signed, an invoice paid, a health status changing, onboarding completing — and nothing else. Routine edits are deliberately not logged, so an absence here does not mean nothing happened.",
    entriesReturned: entries.length,
    entries: entries.map((a) => ({
      kind: a.kind,
      summary: a.summary,
      at: iso(a.createdAt),
      clientId: a.clientId,
      leadId: a.leadId,
      about: a.client?.clinicName ?? a.lead?.clinicName ?? null,
    })),
  };
}

// ─── 9. The task board ─────────────────────────────────────────────────────

export async function getTasks(args: {
  status?: string;
  dueBefore?: string;
}): Promise<unknown> {
  const status = isTaskStatus(args.status) ? (args.status as TaskStatus) : null;

  // A day rather than an instant, read in UTC, matching the column and every
  // other date-only field in this schema. Junk is ignored rather than argued
  // with — the filter simply does not apply, and the result says so.
  const dueBefore =
    typeof args.dueBefore === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(args.dueBefore)
      ? new Date(`${args.dueBefore}T00:00:00.000Z`)
      : null;
  const dueBeforeValid = dueBefore !== null && !Number.isNaN(dueBefore.getTime());

  const tasks = await prisma.task.findMany({
    where: {
      ...(status ? { status } : {}),
      // A dated filter excludes undated tasks by definition: "due before
      // Friday" cannot include something that is not due at all.
      ...(dueBeforeValid ? { dueDate: { not: null, lt: dueBefore } } : {}),
    },
    include: {
      lead: { select: { id: true, clinicName: true } },
      client: { select: { id: true, clinicName: true } },
    },
  });

  // Sorted here rather than in the query: SQLite sorts nulls first on an
  // ascending column, which would open the list with every undated task. Due
  // ones first, soonest first, and the undated ones after them.
  const now = new Date();
  const sorted = [...tasks].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return {
    now: iso(now),
    filters: {
      status: status ? TASK_STATUS_LABELS[status] : "any",
      dueBefore: dueBeforeValid ? args.dueBefore : "any",
      ...(args.dueBefore && !dueBeforeValid
        ? {
            ignored: `"${args.dueBefore}" is not a date in YYYY-MM-DD form, so no date filter was applied.`,
          }
        : {}),
    },
    // Counts across the whole board, unfiltered, so a filtered answer can still
    // say what it is a slice of.
    countsByStatus: Object.fromEntries(
      await Promise.all(
        TASK_STATUSES.map(async (s) => [
          TASK_STATUS_LABELS[s],
          await prisma.task.count({ where: { status: s } }),
        ]),
      ),
    ),
    ...listMeta(Math.min(sorted.length, TASKS_MAX), sorted.length, TASKS_MAX),
    tasks: sorted.slice(0, TASKS_MAX).map((t) => ({
      id: t.id,
      title: t.title,
      description: body(t.description),
      status: TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status,
      dueDate: day(t.dueDate),
      // Only open work can be overdue. A task finished late is finished.
      overdue:
        t.status !== "DONE" && t.dueDate !== null && t.dueDate < now,
      about: t.lead?.clinicName ?? t.client?.clinicName ?? null,
      leadId: t.leadId,
      clientId: t.clientId,
      createdAt: iso(t.createdAt),
      completedAt: iso(t.completedAt),
    })),
  };
}

// ─── 10. One day of the routine ────────────────────────────────────────────

export async function getDailyChecklistStatus(args: {
  date?: string;
}): Promise<unknown> {
  const now = new Date();
  const requested =
    typeof args.date === "string" ? args.date : undefined;
  const dayDate = parseDayKey(requested, now);
  const key = dayKey(dayDate);
  const isToday = key === dayKey(toChecklistDay(now));

  // readDayRows, never ensureDay: seeding is a write, and a question about a
  // day must not bring that day into existence. Blanks are filled for display
  // by readDay, which is what the page does for past days too.
  const [rows, numbers] = await Promise.all([
    readDayRows(dayDate),
    loadDailyNumbers(dayDate),
  ]);
  const checked = readDay(rows);
  const done = checkedCount(checked);

  return {
    date: key,
    isToday,
    ...(requested && requested !== key
      ? {
          note: `"${requested}" is not a date in YYYY-MM-DD form, so ${key} was read instead.`,
        }
      : {}),
    howItWorks:
      "The routine is fixed in code, not data: the same items every day, ticked by hand. A day nobody opened has nothing ticked, which is not the same as the work not being done — say so if it matters to the answer.",
    ticked: done,
    total: DAILY_CHECKLIST_ITEMS.length,
    untickedItems: DAILY_CHECKLIST_ITEMS.filter((i) => !checked.get(i.key)).map(
      (i) => i.label,
    ),
    categories: DAILY_CHECKLIST_CATEGORIES.map((category) => ({
      category: DAILY_CHECKLIST_CATEGORY_LABELS[category],
      items: itemsInCategory(category).map((i) => ({
        label: i.label,
        checked: checked.get(i.key) ?? false,
      })),
    })),
    // The other half of the panel: what actually landed, counted off the
    // records rather than ticked. The two can disagree, and that disagreement
    // is usually the interesting thing on the page.
    liveNumbers: numbers.map((n) => ({
      label: n.label,
      value: n.value,
      countedFrom: n.source,
    })),
  };
}

// ─── 11. The outreach funnel ───────────────────────────────────────────────

export async function getOutreachFunnel(): Promise<unknown> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [openLeads, outreachLeads, contactedLeads, discoveryCalls] = await Promise.all([
    prisma.lead.findMany({
      where: { archived: false, stage: { in: [...OPEN_STAGES] } },
    }),
    // Archived leads included on purpose: a request that went out three weeks
    // ago went out whatever happened to the lead since, and leaving them out
    // would make a week look quieter than it was.
    prisma.lead.findMany({
      where: {
        connectionRequestSentAt: { gte: daysAgo(now, REPLY_RATE_WINDOW_DAYS) },
      },
      select: { connectionRequestSentAt: true, repliedAt: true },
    }),
    // Messages sent: leads standing at Contacted or past it, which is what the
    // pipeline records an approach as (src/lib/funnel.ts).
    prisma.lead.findMany({
      where: {
        stage: { in: [...CONTACTED_STAGES] },
        updatedAt: { gte: daysAgo(now, MESSAGES_WINDOW_DAYS * 2) },
      },
      select: { updatedAt: true },
    }),
    // Counted off the call log rather than off a lead's stage, for the reason
    // the dashboard counts them that way: a cancelled or deleted booking should
    // stop being reported, and a stage cannot be un-set.
    prisma.call.findMany({
      where: {
        type: "DISCOVERY",
        status: { not: "CANCELLED" },
        scheduledAt: { gte: monthStart, lt: nextMonthStart },
      },
      select: { status: true },
    }),
  ]);

  const qualified = qualifiedLeads(openLeads);
  const messages = messagesSent(contactedLeads, now);
  const replies = replyRate(outreachLeads, now);
  const discovery = discoveryBooked(discoveryCalls);

  return {
    now: iso(now),
    note: "These are the four numbers on the dashboard, computed the same way. They describe the shape of the funnel, not any one record.",
    qualifiedLeads: {
      total: qualified.total,
      notApproachedYet: qualified.untouched,
      approachedAndInPlay: qualified.contacted,
      meaning:
        "Open leads scored A or B. C-tier and unscored leads are deliberately not counted.",
    },
    messagesSent: {
      windowDays: MESSAGES_WINDOW_DAYS,
      thisWeek: messages.thisWeek,
      lastWeek: messages.lastWeek,
      meaning:
        "Leads that have reached the Contacted stage, counted by when the lead was last touched. Lost leads are excluded — nothing on the record says whether they were ever written to.",
    },
    replyRate: {
      windowDays: REPLY_RATE_WINDOW_DAYS,
      contacted: replies.contacted,
      replied: replies.replied,
      // Null rather than 0 when nobody was approached: a 0% off no attempts
      // reads as "nobody replies to you", which the data has not claimed.
      percent: replies.percent,
      meaning: `Of the leads approached in the last ${REPLY_RATE_WINDOW_DAYS} days, how many wrote back.`,
    },
    discoveryCallsThisMonth: {
      total: discovery.total,
      upcoming: discovery.upcoming,
      held: discovery.held,
      meaning:
        "Discovery calls on this month's calendar. Cancelled calls are excluded; no-shows are counted, because the slot was booked.",
    },
  };
}

// ─── 12. Discovery candidates ──────────────────────────────────────────────

export async function getDiscoveryCandidates(args: {
  status?: string;
  tier?: string;
}): Promise<unknown> {
  const status =
    args.status && (DISCOVERY_STATUSES as readonly string[]).includes(args.status)
      ? (args.status as DiscoveryStatus)
      : null;
  const tier =
    args.tier === "UNSCORED"
      ? "UNSCORED"
      : args.tier && (ICP_TIER_ORDER as string[]).includes(args.tier)
        ? args.tier
        : null;

  // Tier is stored on a candidate rather than computed from a scorecard — the
  // breakdown is the transcript of one run, not a live score — so unlike the
  // pipeline's tier filter this one is a query.
  const where = {
    ...(status ? { status } : {}),
    ...(tier === "UNSCORED" ? { icpTier: null } : tier ? { icpTier: tier } : {}),
  };

  const [total, candidates] = await Promise.all([
    prisma.discoveryCandidate.count({ where }),
    prisma.discoveryCandidate.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: CANDIDATES_MAX,
    }),
  ]);

  return {
    filters: {
      status: status ? DISCOVERY_STATUS_LABELS[status] : "any",
      tier: args.tier ?? "any",
    },
    ...listMeta(candidates.length, total, CANDIDATES_MAX),
    candidates: candidates.map((c) => ({
      id: c.id,
      clinicName: c.clinicName,
      location: c.location,
      status: DISCOVERY_STATUS_LABELS[c.status as DiscoveryStatus] ?? c.status,
      icpTotal: c.icpTotal,
      icpTier: c.icpTier,
      disqualified: c.disqualified,
      disqualifiedReason: c.disqualifiedReason,
      failureReason: c.failureReason,
      flaggedForSecondLook: c.secondLookFlagged,
      batchLabel: c.batchLabel,
      source: c.source,
      promotedLeadId: c.promotedLeadId,
      processedAt: iso(c.processedAt),
      createdAt: iso(c.createdAt),
    })),
  };
}

// ─── 13. One discovery candidate ───────────────────────────────────────────

export async function getDiscoveryCandidateDetail(args: {
  id: string;
}): Promise<unknown> {
  const candidate = await prisma.discoveryCandidate.findUnique({
    where: { id: args.id },
    include: { promotedLead: { select: { id: true, clinicName: true, stage: true } } },
  });
  if (!candidate) {
    return {
      found: false,
      message:
        "No discovery candidate with that id. Call getDiscoveryCandidates to find the right one — ids are not guessable.",
    };
  }

  const breakdown = parseBreakdown(candidate.icpBreakdown);

  return {
    found: true,
    id: candidate.id,
    clinicName: candidate.clinicName,
    status:
      DISCOVERY_STATUS_LABELS[candidate.status as DiscoveryStatus] ??
      candidate.status,
    statusMeaning:
      DISCOVERY_STATUS_MEANINGS[candidate.status as DiscoveryStatus] ?? null,
    contact: {
      contactName: candidate.contactName,
      email: candidate.email,
      phone: candidate.phone,
      location: candidate.location,
      timeZone: candidate.timeZone,
      websiteUrl: candidate.websiteUrl,
      linkedinUrl: candidate.linkedinUrl,
      companyLinkedinUrl: candidate.companyLinkedinUrl,
      facebookUrl: candidate.facebookUrl,
      source: candidate.source,
      batchLabel: candidate.batchLabel,
      staffCountRaw: candidate.staffCountRaw,
      estValue: candidate.estValue,
    },
    outcome: {
      icpTotal: candidate.icpTotal,
      icpTier: candidate.icpTier,
      maxScore: ICP_MAX_SCORE,
      disqualified: candidate.disqualified,
      disqualifiedReason: candidate.disqualifiedReason,
      failureReason: candidate.failureReason,
      processedAt: iso(candidate.processedAt),
    },
    // The transcript of the run that scored it, exactly as it was stored. It is
    // deliberately not recomputed: re-tuning the framework must not rewrite the
    // reason a clinic was rejected last month.
    scoring: breakdown
      ? {
          scoredAt: breakdown.scoredAt,
          total: breakdown.total,
          tier: breakdown.tier,
          summary: breakdown.summary || null,
          evidenceItHad: breakdown.evidence,
          runNotes: breakdown.notes,
          disqualifiers: breakdown.disqualifiers.map((d) => ({
            label: d.label,
            triggered: d.triggered,
            reason: d.reason,
          })),
          categories: breakdown.categories.map((c) => ({
            label: c.label,
            points: c.points,
            max: c.max,
            reason: c.reason,
            // Computed here, answered by a model, or left unanswered — worth
            // carrying, because "DeepSeek read the website and said this" and
            // "arithmetic on a headcount" are different kinds of claim.
            source: DISCOVERY_SOURCE_LABELS[c.source] ?? c.source,
          })),
          gaps: breakdown.gaps.map((g) => ({
            label: g.label,
            points: g.points,
            max: g.max,
            reason: g.reason,
            source: DISCOVERY_SOURCE_LABELS[g.source] ?? g.source,
          })),
        }
      : null,
    secondLook: candidate.secondLookFlagged
      ? {
          flagged: true,
          reason: candidate.secondLookReason,
          source: candidate.secondLookSource,
          at: iso(candidate.secondLookAt),
        }
      : { flagged: false },
    enrichment: {
      enrichedAt: iso(candidate.enrichedAt),
      [UNTRUSTED_CONTENT_KEY]: scraped(candidate),
    },
    promotedTo: candidate.promotedLead
      ? {
          leadId: candidate.promotedLead.id,
          clinicName: candidate.promotedLead.clinicName,
          stage: stageLabel(candidate.promotedLead.stage),
        }
      : null,
  };
}

// ─── 14. The call log ──────────────────────────────────────────────────────

export async function getCalls(args: {
  status?: string;
  type?: string;
}): Promise<unknown> {
  const status =
    args.status && args.status in CALL_STATUS_LABELS ? args.status : null;
  const type = args.type && args.type in CALL_TYPE_LABELS ? args.type : null;
  const where = {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  };

  const [total, calls] = await Promise.all([
    prisma.call.count({ where }),
    prisma.call.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      take: CALL_LOG_MAX,
      include: {
        lead: { select: { id: true, clinicName: true } },
        client: { select: { id: true, clinicName: true } },
      },
    }),
  ]);

  const now = new Date();
  return {
    now: iso(now),
    filters: {
      status: status
        ? CALL_STATUS_LABELS[status as keyof typeof CALL_STATUS_LABELS]
        : "any",
      type: type ? CALL_TYPE_LABELS[type as keyof typeof CALL_TYPE_LABELS] : "any",
    },
    ...listMeta(calls.length, total, CALL_LOG_MAX),
    calls: calls.map((c) => ({
      type: CALL_TYPE_LABELS[c.type as keyof typeof CALL_TYPE_LABELS] ?? c.type,
      status:
        CALL_STATUS_LABELS[c.status as keyof typeof CALL_STATUS_LABELS] ??
        c.status,
      with: c.lead?.clinicName ?? c.client?.clinicName ?? "Unattached",
      leadId: c.lead?.id ?? null,
      clientId: c.client?.id ?? null,
      scheduledAt: iso(c.scheduledAt),
      overdue: isCallOverdue(c, now),
      notes: body(c.notes),
    })),
  };
}

// ─── 15. Ad Hub research ───────────────────────────────────────────────────

export async function getAdHubResearch(): Promise<unknown> {
  const [personas, desires, notes] = await Promise.all([
    prisma.persona.findMany({
      orderBy: { createdAt: "desc" },
      take: PERSONAS_MAX,
      include: { _count: { select: { concepts: true } } },
    }),
    prisma.desire.findMany({
      orderBy: { createdAt: "desc" },
      take: DESIRES_MAX,
      include: {
        benefits: true,
        _count: { select: { concepts: true } },
      },
    }),
    prisma.researchNote.findMany({
      orderBy: { updatedAt: "desc" },
      take: RESEARCH_NOTES_MAX,
    }),
  ]);

  return {
    note: "The research layer of Ad Hub — who the advertising is aimed at and what it is built on. Concepts and creatives are getAdHubConcepts.",
    personas: personas.map((p) => ({
      id: p.id,
      name: p.name,
      demographics: body(p.demographics),
      wantsToBeSeenAs: body(p.wantsToBeSeenAs),
      believesAboutSelf: body(p.believesAboutSelf),
      wantsToAchieve: body(p.wantsToAchieve),
      triedAndFailed: body(p.triedAndFailed),
      reasonForFailure: body(p.reasonForFailure),
      conceptsUsingThisPersona: p._count.concepts,
    })),
    desires: desires.map((d) => ({
      id: d.id,
      statement: d.statement,
      notes: body(d.notes),
      conceptsOnThisDesire: d._count.concepts,
      benefits: d.benefits.map((b) => ({
        productName: b.productName,
        feature: b.feature,
        benefit: b.benefit,
      })),
    })),
    researchNotes: notes.map((n) => ({
      type: RESEARCH_NOTE_TYPE_LABELS[n.type as ResearchNoteType] ?? n.type,
      title: n.title,
      body: body(n.body),
      updatedAt: iso(n.updatedAt),
    })),
  };
}

// ─── 16. Ad Hub concepts ───────────────────────────────────────────────────

export async function getAdHubConcepts(args: {
  status?: string;
  creativeStatus?: string;
}): Promise<unknown> {
  const status =
    args.status && (CONCEPT_STATUSES as readonly string[]).includes(args.status)
      ? (args.status as ConceptStatus)
      : null;
  const creativeStatus =
    args.creativeStatus &&
    (CREATIVE_STATUSES as readonly string[]).includes(args.creativeStatus)
      ? (args.creativeStatus as CreativeStatus)
      : null;

  const where = {
    ...(status ? { status } : {}),
    ...(creativeStatus ? { creatives: { some: { status: creativeStatus } } } : {}),
  };

  const [total, concepts] = await Promise.all([
    prisma.concept.count({ where }),
    prisma.concept.findMany({
      where,
      orderBy: [{ batchNumber: "desc" }, { createdAt: "desc" }],
      take: CONCEPTS_MAX,
      include: {
        persona: { select: { id: true, name: true } },
        desire: { select: { id: true, statement: true } },
        benefit: { select: { feature: true, benefit: true } },
        creatives: {
          where: creativeStatus ? { status: creativeStatus } : {},
          orderBy: { creativeNumber: "asc" },
          take: CREATIVES_PER_CONCEPT_MAX,
        },
      },
    }),
  ]);

  return {
    filters: {
      status: status ? CONCEPT_STATUS_LABELS[status] : "any",
      creativeStatus: creativeStatus
        ? CREATIVE_STATUS_LABELS[creativeStatus]
        : "any",
    },
    ...listMeta(concepts.length, total, CONCEPTS_MAX),
    concepts: concepts.map((c) => ({
      id: c.id,
      name: c.name,
      batchNumber: c.batchNumber,
      status: CONCEPT_STATUS_LABELS[c.status as ConceptStatus] ?? c.status,
      persona: c.persona.name,
      desire: c.desire.statement,
      benefit: `${c.benefit.feature} — ${c.benefit.benefit}`,
      awarenessLevel:
        AWARENESS_LEVEL_LABELS[c.awarenessLevel as AwarenessLevel] ??
        c.awarenessLevel,
      // The stage's own name, not just its number: "Stage 3" says nothing
      // without the market it describes.
      sophistication: sophisticationMeta(c.sophisticationStage).label,
      notes: body(c.notes),
      creativesListed: c.creatives.length,
      creatives: c.creatives.map((cr) => ({
        id: cr.id,
        creativeNumber: cr.creativeNumber,
        type: CREATIVE_TYPE_LABELS[cr.creativeType as CreativeType] ?? cr.creativeType,
        status:
          CREATIVE_STATUS_LABELS[cr.status as CreativeStatus] ?? cr.status,
        conceptHeadline: cr.conceptHeadline,
        adHeadline: cr.adHeadline,
        isVariationOf: cr.parentCreativeId,
      })),
    })),
  };
}

// ─── 17. One creative ──────────────────────────────────────────────────────

export async function getCreativeDetail(args: { id: string }): Promise<unknown> {
  const creative = await prisma.creative.findUnique({
    where: { id: args.id },
    include: {
      concept: {
        include: {
          persona: { select: { name: true } },
          desire: { select: { statement: true } },
        },
      },
      compliance: { orderBy: { sortOrder: "asc" } },
      performance: { orderBy: { loggedOn: "desc" }, take: PERFORMANCE_LOGS_MAX },
      parent: { select: { id: true, creativeNumber: true } },
      variations: { select: { id: true, creativeNumber: true, status: true } },
    },
  });
  if (!creative) {
    return {
      found: false,
      message:
        "No creative with that id. Call getAdHubConcepts to find the right one — ids are not guessable.",
    };
  }

  const outstanding = creative.compliance.filter((i) => !i.checked);

  return {
    found: true,
    id: creative.id,
    creativeNumber: creative.creativeNumber,
    type:
      CREATIVE_TYPE_LABELS[creative.creativeType as CreativeType] ??
      creative.creativeType,
    status:
      CREATIVE_STATUS_LABELS[creative.status as CreativeStatus] ??
      creative.status,
    concept: {
      id: creative.conceptId,
      name: creative.concept.name,
      status:
        CONCEPT_STATUS_LABELS[creative.concept.status as ConceptStatus] ??
        creative.concept.status,
      persona: creative.concept.persona.name,
      desire: creative.concept.desire.statement,
    },
    copy: {
      conceptHeadline: creative.conceptHeadline,
      adHeadline: creative.adHeadline,
      adCopy: body(creative.adCopy),
      cta: creative.cta,
    },
    compliance: {
      checked: creative.compliance.length - outstanding.length,
      total: creative.compliance.length,
      // Every item, not only the failures: "this passes on all five" is an
      // answer, and it needs the whole list to be one.
      items: creative.compliance.map((i) => ({
        item: i.item,
        checked: i.checked,
        checkedAt: iso(i.checkedAt),
      })),
      blocksGoingReady: outstanding.length > 0,
    },
    performance: creative.performance.map((p) => ({
      loggedOn: day(p.loggedOn),
      spend: p.spend,
      impressions: p.impressions,
      ctrPercent: p.ctr,
      cpl: p.cpl,
      conversions: p.conversions,
      notes: body(p.notes),
    })),
    lineage: {
      isVariationOf: creative.parent
        ? { id: creative.parent.id, creativeNumber: creative.parent.creativeNumber }
        : null,
      variations: creative.variations.map((v) => ({
        id: v.id,
        creativeNumber: v.creativeNumber,
        status: CREATIVE_STATUS_LABELS[v.status as CreativeStatus] ?? v.status,
      })),
    },
  };
}

// ─── 18. The library ───────────────────────────────────────────────────────

export async function getLibraryEntries(args: {
  category?: string;
}): Promise<unknown> {
  const category =
    args.category && (LIBRARY_CATEGORIES as readonly string[]).includes(args.category)
      ? (args.category as LibraryCategory)
      : null;
  const where = category ? { category } : {};

  const [total, entries] = await Promise.all([
    prisma.libraryEntry.count({ where }),
    prisma.libraryEntry.findMany({
      where,
      orderBy: [{ category: "asc" }, { title: "asc" }],
      take: LIBRARY_MAX,
    }),
  ]);

  return {
    filters: { category: category ? LIBRARY_CATEGORY_LABELS[category] : "any" },
    ...listMeta(entries.length, total, LIBRARY_MAX),
    entries: entries.map((e) => ({
      category:
        LIBRARY_CATEGORY_LABELS[e.category as LibraryCategory] ?? e.category,
      title: e.title,
      body: body(e.body),
      updatedAt: iso(e.updatedAt),
    })),
  };
}

// ─── 19. The enrichment chain's configuration ──────────────────────────────

export async function getPipelineSettings(): Promise<unknown> {
  const settings = await loadPipelineSettings();

  return {
    note: "How the enrichment chain is configured right now. A step that is switched off simply does not run, which is the usual reason a lead has no website notes or no ads signal.",
    promotionThreshold: settings.promotionThreshold,
    promotionRule: `A discovery candidate needs ${settings.promotionThreshold} of ${ICP_MAX_SCORE} to be promoted into the pipeline; below that it is rejected.`,
    estimatedCostPerCandidate: fmtEstimate(costPerCandidate(settings)),
    steps: PIPELINE_STEP_KEYS.map((key) => ({
      step: PIPELINE_STEP_LABELS[key],
      enabled: settings.steps[key].enabled,
      actorId: settings.steps[key].actorId,
      whatItDoes: PIPELINE_STEP_BLURBS[key],
    })),
  };
}

// ─── The dispatcher ────────────────────────────────────────────────────────
//
// The allow-list, and the only place a tool name becomes a call. A name that
// is not a key of this object runs nothing — there is no dynamic lookup, no
// string concatenation into a query, and no path by which a model can reach a
// function that is not one of these.

const LOOKUPS = {
  getPipelineLeads,
  getLeadDetail,
  getDiscoveryQueueStatus,
  getClientHealthSummary,
  getClientDetail,
  getReportingTrends,
  getFollowUpsDue,
  getRecentActivity,
  getTasks,
  getDailyChecklistStatus,
  getOutreachFunnel,
  getDiscoveryCandidates,
  getDiscoveryCandidateDetail,
  getCalls,
  getAdHubResearch,
  getAdHubConcepts,
  getCreativeDetail,
  getLibraryEntries,
  getPipelineSettings,
} as const;

export type CopilotToolName = keyof typeof LOOKUPS;

export type CopilotToolOutcome =
  | { ok: true; data: unknown }
  // The model's mistake — an unknown name, arguments that are not JSON, a
  // required id missing. Recoverable: this text goes back as the tool result
  // so the model can correct itself, rather than ending the conversation.
  | { ok: false; message: string };

export async function runCopilotTool(
  name: string,
  argumentsJson: string,
): Promise<CopilotToolOutcome> {
  if (!Object.prototype.hasOwnProperty.call(LOOKUPS, name)) {
    return {
      ok: false,
      message: `There is no lookup called "${name}". The lookups that exist are: ${Object.keys(LOOKUPS).join(", ")}. Use one of those, or tell the operator this is not something you can see.`,
    };
  }

  // An empty string is what an argument-less call arrives as; anything that is
  // not an object is a model that has written something else entirely.
  let args: Record<string, unknown> = {};
  if (argumentsJson.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argumentsJson);
    } catch {
      return {
        ok: false,
        message: `The arguments for ${name} were not valid JSON, so nothing was run. Call it again with a JSON object.`,
      };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        message: `The arguments for ${name} were not a JSON object, so nothing was run.`,
      };
    }
    args = parsed as Record<string, unknown>;
  }

  const id = typeof args.id === "string" ? args.id : undefined;
  const clientId = typeof args.clientId === "string" ? args.clientId : undefined;

  switch (name as CopilotToolName) {
    case "getPipelineLeads":
      return {
        ok: true,
        data: await getPipelineLeads({
          tier: typeof args.tier === "string" ? args.tier : undefined,
          stage: typeof args.stage === "string" ? args.stage : undefined,
        }),
      };
    case "getLeadDetail":
      if (!id) {
        return {
          ok: false,
          message:
            "getLeadDetail needs the lead's id. Call getPipelineLeads first and read the id off the lead you want.",
        };
      }
      return { ok: true, data: await getLeadDetail({ id }) };
    case "getDiscoveryQueueStatus":
      return { ok: true, data: await getDiscoveryQueueStatus() };
    case "getClientHealthSummary":
      return { ok: true, data: await getClientHealthSummary() };
    case "getClientDetail":
      if (!id) {
        return {
          ok: false,
          message:
            "getClientDetail needs the client's id. Call getClientHealthSummary first and read the id off the client you want.",
        };
      }
      return { ok: true, data: await getClientDetail({ id }) };
    case "getReportingTrends":
      return { ok: true, data: await getReportingTrends({ clientId }) };
    case "getFollowUpsDue":
      return { ok: true, data: await getFollowUpsDue() };
    case "getRecentActivity":
      return { ok: true, data: await getRecentActivity() };
    case "getTasks":
      return {
        ok: true,
        data: await getTasks({
          status: str(args.status),
          dueBefore: str(args.dueBefore),
        }),
      };
    case "getDailyChecklistStatus":
      return {
        ok: true,
        data: await getDailyChecklistStatus({ date: str(args.date) }),
      };
    case "getOutreachFunnel":
      return { ok: true, data: await getOutreachFunnel() };
    case "getDiscoveryCandidates":
      return {
        ok: true,
        data: await getDiscoveryCandidates({
          status: str(args.status),
          tier: str(args.tier),
        }),
      };
    case "getDiscoveryCandidateDetail":
      if (!id) {
        return {
          ok: false,
          message:
            "getDiscoveryCandidateDetail needs the candidate's id. Call getDiscoveryCandidates first and read the id off the one you want.",
        };
      }
      return { ok: true, data: await getDiscoveryCandidateDetail({ id }) };
    case "getCalls":
      return {
        ok: true,
        data: await getCalls({ status: str(args.status), type: str(args.type) }),
      };
    case "getAdHubResearch":
      return { ok: true, data: await getAdHubResearch() };
    case "getAdHubConcepts":
      return {
        ok: true,
        data: await getAdHubConcepts({
          status: str(args.status),
          creativeStatus: str(args.creativeStatus),
        }),
      };
    case "getCreativeDetail":
      if (!id) {
        return {
          ok: false,
          message:
            "getCreativeDetail needs the creative's id. Call getAdHubConcepts first and read the id off the creative you want.",
        };
      }
      return { ok: true, data: await getCreativeDetail({ id }) };
    case "getLibraryEntries":
      return {
        ok: true,
        data: await getLibraryEntries({ category: str(args.category) }),
      };
    case "getPipelineSettings":
      return { ok: true, data: await getPipelineSettings() };
  }
}

// One argument, if it is a string at all. Every filter below is optional and
// every lookup ignores a value it does not recognise, so a model that invents
// a status narrows nothing rather than failing — and the result says which
// filters were actually applied.
function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
