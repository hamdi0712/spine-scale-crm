// Writing to the activity feed, and keeping the stored health status in step
// with what the metrics currently say.
//
// Server-side helpers called from the actions in src/lib/actions/*. They are
// deliberately not server actions themselves — nothing outside the server ever
// needs to invoke them, and each one is a consequence of an action rather than
// an action in its own right.

import { prisma } from "@/lib/prisma";
import { ActivityKind } from "@/lib/activity";
import {
  HEALTH_LABELS,
  HEALTH_WINDOW_WEEKS,
  HealthStatus,
  computeHealth,
  isHealthScored,
} from "@/lib/health";

export async function recordMilestone(
  kind: ActivityKind,
  summary: string,
  owner: { clientId?: string; leadId?: string },
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      kind,
      summary,
      clientId: owner.clientId ?? null,
      leadId: owner.leadId ?? null,
    },
  });
}

// A transition worth putting in the feed. Arriving at a neutral or good status
// for the first time is just the client existing — only log it once there is a
// previous status to have moved away from, or when the new status is one that
// asks something of you.
function worthLogging(from: HealthStatus | null, to: HealthStatus): boolean {
  if (from === to) return false;
  if (from !== null) return true;
  return to === "AT_RISK" || to === "NEEDS_ATTENTION";
}

/**
 * Recompute a client's health and, if it moved, store the new status and log
 * the change. Call after anything that feeds the computation: a weekly report
 * written or removed, the manual override set or cleared, the client going
 * active.
 *
 * Health itself is never read from the stored column — it is recomputed on
 * every render from the reports. The column exists only so a *change* can be
 * noticed, which needs a memory of what the status was last time.
 */
export async function syncClientHealth(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      reports: { orderBy: { weekStart: "desc" }, take: HEALTH_WINDOW_WEEKS },
    },
  });
  if (!client) return;

  const stored = client.healthStatus as HealthStatus | null;

  // A client that is not live has no health status. Clear it so that coming
  // back to Active starts from a clean slate rather than replaying an old one.
  if (!isHealthScored(client.status)) {
    if (stored !== null) {
      await prisma.client.update({
        where: { id: clientId },
        data: { healthStatus: null, healthChangedAt: new Date() },
      });
    }
    return;
  }

  const { status } = computeHealth(client, client.reports);
  if (status === stored) return;

  await prisma.client.update({
    where: { id: clientId },
    data: { healthStatus: status, healthChangedAt: new Date() },
  });

  if (worthLogging(stored, status)) {
    await recordMilestone(
      "HEALTH_CHANGED",
      `${client.clinicName} health changed to ${HEALTH_LABELS[status]}${
        stored ? ` (was ${HEALTH_LABELS[stored]})` : ""
      }`,
      { clientId },
    );
  }
}
