// The day's numbers, and the one cached note written from them.
//
// Server-only, and deliberately not a "use server" module, on the same terms as
// src/lib/pipelineSettingsStore.ts: the dashboard reads the cached note while
// it renders, which is a server component calling a function, not the browser
// calling an endpoint. The one thing the browser may ask for — write me a new
// note — is the action in src/lib/actions/dailyDigest.ts, and it comes through
// here too.
//
// countDigestSnapshot is the whole of what the model is told about the agency.
// It is six counts and a few clinic names, and it is a query rather than a
// prompt on purpose: every number in the note is the database's answer, so the
// worst a bad generation can do is weigh them wrongly, never state one wrongly.

import { prisma } from "@/lib/prisma";
import {
  CachedDigest,
  DAILY_DIGEST_ID,
  DIGEST_MAX_NAMED_CLIENTS,
  DIGEST_PROMOTION_DAYS,
  DigestSnapshot,
  parseDigestSnapshot,
  serializeSnapshot,
} from "@/lib/dailyDigest";
import { DISCOVERY_QUEUE_STATUSES } from "@/lib/discovery";
import { HEALTH_WINDOW_WEEKS, computeHealth } from "@/lib/health";
import { OPEN_STAGES } from "@/lib/constants";

export async function loadDigest(): Promise<CachedDigest | null> {
  const row = await prisma.dailyDigest.findUnique({
    where: { id: DAILY_DIGEST_ID },
  });
  if (!row) return null;
  return {
    body: row.body,
    snapshot: parseDigestSnapshot(row.snapshot),
    generatedAt: row.generatedAt,
  };
}

// An upsert on the fixed id, so the first note creates the row and every note
// after it replaces the same one. There is no history: an old note is a
// description of a day that has moved on, and keeping a shelf of them would
// invite reading one.
export async function saveDigest(digest: CachedDigest): Promise<void> {
  const data = {
    body: digest.body,
    snapshot: serializeSnapshot(digest.snapshot),
    generatedAt: digest.generatedAt,
  };
  await prisma.dailyDigest.upsert({
    where: { id: DAILY_DIGEST_ID },
    create: { id: DAILY_DIGEST_ID, ...data },
    update: data,
  });
}

// Everything the note is written from, counted at the moment it is written.
//
// Health is computed rather than read off Client.healthStatus: that column is
// the last status the app *logged*, kept so a change can be detected
// (src/lib/milestones.ts), and it is stale by design between the events that
// write it. The dashboard's own health card computes the same way, so the note
// and the card beside it can never disagree about who is at risk.
export async function countDigestSnapshot(
  now: Date = new Date(),
): Promise<DigestSnapshot> {
  const promotedSince = new Date(
    now.getTime() - DIGEST_PROMOTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const [activeClients, overdueFollowUps, overdueCalls, discoveryQueue, recentPromotions] =
    await Promise.all([
      prisma.client.findMany({
        where: { status: "ACTIVE" },
        select: {
          clinicName: true,
          status: true,
          activeSince: true,
          healthOverride: true,
          reports: {
            orderBy: { weekStart: "desc" },
            take: HEALTH_WINDOW_WEEKS,
            select: { weekStart: true, leads: true, booked: true, shows: true },
          },
        },
      }),
      // Already past, not "due this week" — the KPI card above the note counts
      // the seven-day window, and a follow-up due on Thursday is not something
      // that needs attention on Monday.
      prisma.lead.count({
        where: {
          archived: false,
          stage: { in: [...OPEN_STAGES] },
          nextFollowUp: { lt: now },
        },
      }),
      // The same read Today's focus calls overdue: still marked Scheduled, its
      // time gone, and not hanging off a lead that has been closed out.
      prisma.call.count({
        where: {
          status: "SCHEDULED",
          scheduledAt: { lt: now },
          OR: [{ leadId: null }, { lead: { archived: false } }],
        },
      }),
      prisma.discoveryCandidate.count({
        where: { status: { in: DISCOVERY_QUEUE_STATUSES } },
      }),
      prisma.discoveryCandidate.count({
        where: { status: "PROMOTED", processedAt: { gte: promotedSince } },
      }),
    ]);

  const atRisk = activeClients
    .map((client) => ({
      clinicName: client.clinicName,
      health: computeHealth(client, client.reports),
    }))
    .filter((c) => c.health.status === "AT_RISK");

  return {
    activeClients: activeClients.length,
    atRisk: atRisk.length,
    atRiskNames: atRisk.slice(0, DIGEST_MAX_NAMED_CLIENTS).map((c) => ({
      clinicName: c.clinicName,
      reason: c.health.reason,
    })),
    overdueFollowUps,
    overdueCalls,
    discoveryQueue,
    recentPromotions,
  };
}
