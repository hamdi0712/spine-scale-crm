// The sending inboxes: loading them, giving a lead one, and counting what
// each has sent today. Server-only; the rules are in src/lib/emailWorkflow.ts.

import { prisma } from "@/lib/prisma";
import { SendingInboxView, pickInbox } from "@/lib/emailWorkflow";

export async function loadInboxes(): Promise<SendingInboxView[]> {
  return prisma.sendingInbox.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, address: true, displayName: true, dailyLimit: true },
  });
}

// How many leads each inbox already has, the measure the next one is
// balanced on.
async function assignedCounts(): Promise<Record<string, number>> {
  const rows = await prisma.lead.groupBy({
    by: ["sendingInboxId"],
    where: { sendingInboxId: { not: null } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.sendingInboxId as string, r._count._all]));
}

// Gives each of these leads — the ones that have just become Ready with no
// inbox yet — the inbox with the fewest leads, one at a time, so a batch of
// them alternates. Returns the inbox each was given.
export async function assignInboxes(leadIds: string[], inboxes?: SendingInboxView[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (leadIds.length === 0) return out;
  const list = inboxes ?? (await loadInboxes());
  if (list.length === 0) return out;
  const counts = await assignedCounts();
  for (const id of leadIds) {
    const inbox = pickInbox(list, counts);
    if (!inbox) break;
    // Only onto a lead still without one, so two pages loading at once
    // cannot give it two.
    const r = await prisma.lead.updateMany({ where: { id, sendingInboxId: null }, data: { sendingInboxId: inbox.id } });
    if (r.count === 1) {
      out[id] = inbox.id;
      counts[inbox.id] = (counts[inbox.id] ?? 0) + 1;
    }
  }
  return out;
}

// Emails each inbox has marked sent today.
export async function sentTodayByInbox(now = new Date()): Promise<Record<string, number>> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const rows = await prisma.emailSend.groupBy({
    by: ["inboxId"],
    where: { sentAt: { gte: start }, inboxId: { not: null } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.inboxId as string, r._count._all]));
}

// The inbox a lead's email goes from: the one Email 1 went from once it has
// been sent — so the follow-ups stay in that thread — and the lead's
// assigned inbox before that.
export function inboxForLead(
  lead: { sendingInboxId: string | null; emailSends: { step: number; inboxId: string | null }[] },
  inboxes: SendingInboxView[],
): SendingInboxView | null {
  const firstFrom = lead.emailSends.find((s) => s.step === 0)?.inboxId ?? null;
  const id = firstFrom ?? lead.sendingInboxId;
  return inboxes.find((i) => i.id === id) ?? null;
}
