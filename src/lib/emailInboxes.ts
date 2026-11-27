// The sending inboxes: loading them, giving a lead one, and counting what
// each has sent today. Server-only; the rules are in src/lib/emailWorkflow.ts.

import { EmailSend, Lead } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SendingInboxView, emailWorkflowStatus, pickInbox } from "@/lib/emailWorkflow";
import { leadTier } from "@/lib/leadScore";

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
    // Only onto a lead still without one, so two writes at once cannot give
    // it two.
    const r = await prisma.lead.updateMany({ where: { id, sendingInboxId: null }, data: { sendingInboxId: inbox.id } });
    if (r.count === 1) {
      out[id] = inbox.id;
      counts[inbox.id] = (counts[inbox.id] ?? 0) + 1;
    }
  }
  return out;
}

// ─── One rule for a lead's inbox ───────────────────────────────────────────
//
// A lead holds an inbox exactly while it is Ready and nothing has been sent:
// it is given one the moment it becomes Ready, by whatever made it so, and
// gives it back the moment it stops being Ready with nothing sent. Once
// Email 1 has gone, the inbox is fixed — the follow-ups stay in its thread.
// Pages only read; these are called from the writes that change a lead.

const LEAD_WITH_SENDS = { emailSends: { orderBy: { step: "asc" as const } } };

type LeadForInbox = Lead & { emailSends: EmailSend[] };

function isReady(lead: LeadForInbox): boolean {
  return emailWorkflowStatus(lead, leadTier(lead), lead.emailSends) === "ready";
}

// What should happen to this lead's inbox, if anything.
function inboxMove(lead: LeadForInbox): "assign" | "release" | null {
  if (lead.emailSends.length > 0) return null;
  const ready = isReady(lead);
  if (ready && lead.sendingInboxId === null) return "assign";
  if (!ready && lead.sendingInboxId !== null) return "release";
  return null;
}

async function loadForInbox(leadId: string): Promise<LeadForInbox | null> {
  return prisma.lead.findUnique({ where: { id: leadId }, include: LEAD_WITH_SENDS });
}

// Only while still unsent and still holding it, so a send or another
// assignment in between is never undone.
async function release(leadId: string): Promise<void> {
  await prisma.lead.updateMany({ where: { id: leadId, sendingInboxId: { not: null }, emailSends: { none: {} } }, data: { sendingInboxId: null } });
}

// Gives the lead an inbox if it is Ready and has none. Returns the inbox it
// now has (given here or already held), or null.
export async function assignInboxIfReady(leadId: string): Promise<string | null> {
  const lead = await loadForInbox(leadId);
  if (!lead) return null;
  if (inboxMove(lead) === "assign") {
    const given = await assignInboxes([leadId]);
    return given[leadId] ?? (await prisma.lead.findUnique({ where: { id: leadId }, select: { sendingInboxId: true } }))?.sendingInboxId ?? null;
  }
  return lead.sendingInboxId;
}

// Takes the inbox back from a lead that is no longer Ready, if nothing has
// been sent. Called from every write that drops the approval.
export async function releaseInboxIfUnsent(leadId: string): Promise<void> {
  const lead = await loadForInbox(leadId);
  if (lead && inboxMove(lead) === "release") await release(leadId);
}

// Either way, for a write that may have made the lead Ready or stopped it
// being so (a contact, tier, address or verdict change).
export async function syncLeadInbox(leadId: string): Promise<void> {
  const lead = await loadForInbox(leadId);
  if (!lead) return;
  const move = inboxMove(lead);
  if (move === "assign") await assignInboxes([leadId]);
  else if (move === "release") await release(leadId);
}

// Every unsent email lead at once, for the end of a job that may have
// changed many (checks, owners, scoring, the queue). Returns what moved.
export async function syncReadyInboxes(): Promise<{ assigned: number; released: number }> {
  const leads = await prisma.lead.findMany({
    where: { channel: "email", emailSends: { none: {} } },
    include: LEAD_WITH_SENDS,
    orderBy: { updatedAt: "asc" },
  });
  const toAssign: string[] = [];
  let released = 0;
  for (const l of leads) {
    const move = inboxMove(l);
    if (move === "assign") toAssign.push(l.id);
    else if (move === "release") {
      await release(l.id);
      released++;
    }
  }
  const given = await assignInboxes(toAssign);
  return { assigned: Object.keys(given).length, released };
}

// Emails each inbox has marked sent today.
export async function sentTodayByInbox(now = new Date(), opts: { risky?: boolean } = {}): Promise<Record<string, number>> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const rows = await prisma.emailSend.groupBy({
    by: ["inboxId"],
    where: { sentAt: { gte: start }, inboxId: { not: null }, ...(opts.risky ? { risky: true } : {}) },
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
