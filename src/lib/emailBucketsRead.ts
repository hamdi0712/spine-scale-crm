// The Email queue, Contact form list and Call list, read for a page.
// Server-only. Every judgement is made by src/lib/emailBuckets.ts.

import { prisma } from "@/lib/prisma";
import { PIPELINE_DEFAULT_WHERE } from "@/lib/liveLeadWhere";
import { pickContactFormLink } from "@/lib/contactForm";
import { leadTier } from "@/lib/leadScore";
import { emailDetailLine } from "@/lib/emailChannel";
import { CallSection, EmailBucketExtras, callSection, emailBucket, inEmailPipeline, ownerRunWouldDoNothing, queueCanFind, queueReason } from "@/lib/emailBuckets";

export const CALL_KINDS = ["CALL_NO_ANSWER", "CALL_TALKED", "CALL_NOT_INTERESTED"] as const;
export type CallKind = (typeof CALL_KINDS)[number];
export const CALL_KIND_LABELS: Record<CallKind, string> = {
  CALL_NO_ANSWER: "Called – no answer",
  CALL_TALKED: "Talked",
  CALL_NOT_INTERESTED: "Not interested",
};

// The latest of each activity kind, per lead.
async function latestByLead(leadIds: string[], kinds: string[]): Promise<Map<string, { kind: string; at: Date }>> {
  const map = new Map<string, { kind: string; at: Date }>();
  if (leadIds.length === 0) return map;
  const rows = await prisma.activityLog.findMany({
    where: { leadId: { in: leadIds }, kind: { in: kinds } },
    orderBy: { createdAt: "desc" },
    select: { leadId: true, kind: true, createdAt: true },
  });
  for (const r of rows) if (r.leadId && !map.has(r.leadId)) map.set(r.leadId, { kind: r.kind, at: r.createdAt });
  return map;
}

type BucketInput = { id: string; websiteLinks: string | null; websiteUrl: string | null; _count: { emailSends: number } };

export async function bucketExtras<T extends BucketInput>(leads: T[]): Promise<Map<string, EmailBucketExtras>> {
  const sent = await latestByLead(leads.map((l) => l.id), ["CONTACT_FORM_SENT"]);
  return new Map(
    leads.map((l) => [
      l.id,
      {
        sendCount: l._count.emailSends,
        contactFormUrl: pickContactFormLink(l.websiteLinks, l.websiteUrl),
        formSentAt: sent.get(l.id)?.at ?? null,
      },
    ]),
  );
}

// The ids of the email leads the Email pipeline shows (Lost ones included,
// for its Lost tab): those whose bucket is the pipeline, or that are Lost.
export async function emailPipelineIds(): Promise<Set<string>> {
  const leads = await prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, channel: "email" },
    include: { _count: { select: { emailSends: true } } },
  });
  const extras = await bucketExtras(leads);
  return new Set(leads.filter((l) => l.stage === "LOST" || inEmailPipeline(emailBucket(l, extras.get(l.id)!))).map((l) => l.id));
}

// The Email queue: one list, every lead not ready for the Email pipeline yet.
// Contact-form leads are in the pipeline (src/lib/emailBuckets.ts).
export async function loadEmailQueue() {
  const leads = await prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, channel: "email", stage: { not: "LOST" } },
    include: { _count: { select: { emailSends: true } } },
    orderBy: { createdAt: "desc" },
  });
  const extras = await bucketExtras(leads);
  const queue = leads
    .filter((l) => emailBucket(l, extras.get(l.id)!) === "queue")
    .map((l) => ({
      id: l.id,
      clinicName: l.clinicName,
      contactName: l.ownerStatus === "confirmed" ? l.contactName : null,
      location: l.location,
      email: (l.email ?? "").trim() || null,
      emailDetail: emailDetailLine(l),
      icpTier: leadTier(l),
      reason: queueReason(l),
      // The per-lead button: only when Find owners would do something.
      canFind: queueCanFind(l),
    }));
  return { queue };
}

export interface CallRow {
  id: string;
  clinicName: string;
  contactName: string | null;
  phone: string | null;
  section: CallSection;
  why: string;
  lastCall: { label: string; at: string } | null;
}

export async function loadCallList(now = new Date()): Promise<CallRow[]> {
  const leads = await prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, stage: { not: "LOST" }, suppressedAt: null },
    include: { _count: { select: { emailSends: true } }, notes: { select: { body: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const extras = await bucketExtras(leads);
  const calls = await latestByLead(leads.map((l) => l.id), [...CALL_KINDS]);
  const rows: CallRow[] = [];
  for (const l of leads) {
    const s = callSection({ ...l, notes: l.notes.map((n) => n.body) }, extras.get(l.id)!, now);
    if (!s) continue;
    const last = calls.get(l.id);
    rows.push({
      id: l.id,
      clinicName: l.clinicName,
      contactName: l.contactName,
      phone: (l.phone ?? "").trim() || null,
      section: s.section,
      why: s.why,
      lastCall: last ? { label: CALL_KIND_LABELS[last.kind as CallKind] ?? last.kind, at: last.at.toISOString() } : null,
    });
  }
  return rows;
}

// Queue leads nothing would move: the button shown but the run would do
// nothing, or no button and not waiting on a person (an owner to pick, an
// address to check). Should always be empty; tools/list-dead-queue-buttons.ts
// and the verify script read it.
export async function deadQueueLeads(): Promise<{ id: string; clinicName: string; why: string }[]> {
  const leads = await prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, channel: "email", stage: { not: "LOST" } },
    include: { _count: { select: { emailSends: true } } },
  });
  const extras = await bucketExtras(leads);
  return leads.flatMap((l) => {
    if (emailBucket(l, extras.get(l.id)!) !== "queue") return [];
    const canFind = queueCanFind(l);
    if (canFind && ownerRunWouldDoNothing(l)) return [{ id: l.id, clinicName: l.clinicName, why: "button shown, but the run would do nothing" }];
    const waitsOnPerson = l.ownerStatus === "pick" || ((l.email ?? "").trim() !== "" && l.emailStatus === null);
    if (!canFind && !waitsOnPerson) return [{ id: l.id, clinicName: l.clinicName, why: `no button and nothing to do (${queueReason(l)})` }];
    return [];
  });
}
