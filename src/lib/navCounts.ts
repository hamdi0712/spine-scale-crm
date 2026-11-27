// The numbers beside the sidebar items: what is waiting in each place.
//
//   Tasks           open tasks due today or earlier (red when any is overdue)
//   Discovery       candidates queued for Qualify, every channel
//   Pipeline        follow-ups due today or earlier, LinkedIn and email
//   Needs you       the email leads the contact finder could not finish —
//                   exactly the count the Needs you page lists
//
// Read-only, and cheap enough to be polled: one query per figure, plus the
// email leads' sends for the email follow-up rule.

import { prisma } from "@/lib/prisma";
import { DISCOVERY_QUEUE_STATUSES } from "@/lib/discovery";
import { OPEN_TASK_STATUSES } from "@/lib/tasks";
import { PIPELINE_DEFAULT_WHERE } from "@/lib/liveLeadWhere";
import { needsYouCount } from "@/lib/emailBucketsRead";
import { emailLeadState } from "@/lib/emailWorkflowRead";
import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { loadInboxes } from "@/lib/emailInboxes";

export interface NavCount {
  n: number;
  tone: "muted" | "warn" | "bad";
}

export type NavCounts = Record<string, NavCount>;

function utcDay(now: Date, end: boolean): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return end ? new Date(d.getTime() + 86_400_000 - 1) : d;
}

export async function loadNavCounts(now = new Date()): Promise<NavCounts> {
  const dayStart = utcDay(now, false);
  const dayEnd = utcDay(now, true);

  const [tasksDue, tasksOverdue, queued, needsYou, linkedinDue, emailLeads, settings, inboxes] = await Promise.all([
    prisma.task.count({ where: { status: { in: OPEN_TASK_STATUSES }, dueDate: { lte: dayEnd } } }),
    prisma.task.count({ where: { status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: dayStart } } }),
    prisma.discoveryCandidate.count({ where: { status: { in: DISCOVERY_QUEUE_STATUSES } } }),
    needsYouCount(),
    prisma.lead.count({
      where: { ...PIPELINE_DEFAULT_WHERE, channel: { not: "email" }, nextFollowUp: { lte: dayEnd } },
    }),
    prisma.lead.findMany({ where: { ...PIPELINE_DEFAULT_WHERE, channel: "email" }, include: { emailSends: true } }),
    loadEmailSettings(),
    loadInboxes(),
  ]);

  const emailDue = emailLeads.filter((l) => emailLeadState(l, settings, now, inboxes).followUpDueToday).length;

  return {
    "/activities": { n: tasksDue, tone: tasksOverdue > 0 ? "bad" : "warn" },
    "/discovery": { n: queued, tone: "muted" },
    "/pipeline": { n: linkedinDue + emailDue, tone: "warn" },
    // Needs you: the email leads the contact finder could not finish. Hidden at 0.
    "/outreach": { n: needsYou, tone: "warn" },
  };
}
