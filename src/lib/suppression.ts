// The suppression list: clinics that said they are not interested, or asked
// not to be emailed. Server-only.
//
// One list for every channel. A suppressed lead is never Ready on email and
// is never sent to; its LinkedIn sequence is refused; and Discovery skips a
// clinic matching a suppressed address or website domain, both when it is
// imported and when it would be promoted. Entries are never removed by the
// app — the list is the record of a promise.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUPPRESSION_REASON_LABELS, SuppressionReason, suppressionKeys } from "@/lib/emailWorkflow";

type Db = Prisma.TransactionClient | typeof prisma;

// Puts a lead on the list, by its address and its website domain, and marks
// the lead itself.
export async function suppressLead(
  db: Db,
  lead: { id: string; clinicName: string; email: string | null; websiteUrl: string | null },
  reason: SuppressionReason,
  now: Date,
): Promise<void> {
  const keys = suppressionKeys(lead);
  await db.suppression.create({
    data: { email: keys.email, domain: keys.domain, clinicName: lead.clinicName, leadId: lead.id, reason },
  });
  await db.lead.update({ where: { id: lead.id }, data: { suppressedAt: now, suppressedReason: reason } });
}

// The suppression a record matches, if any: by lead, address, or website
// domain.
export async function findSuppression(
  record: { leadId?: string | null; email?: string | null; websiteUrl?: string | null },
  db: Db = prisma,
): Promise<{ clinicName: string; reason: string } | null> {
  const keys = suppressionKeys({ email: record.email ?? null, websiteUrl: record.websiteUrl ?? null });
  const or: Prisma.SuppressionWhereInput[] = [];
  if (record.leadId) or.push({ leadId: record.leadId });
  if (keys.email) or.push({ email: keys.email });
  if (keys.domain) or.push({ domain: keys.domain });
  if (or.length === 0) return null;
  return db.suppression.findFirst({ where: { OR: or }, select: { clinicName: true, reason: true } });
}

// Every suppressed address and domain, for checking a batch at once.
export async function loadSuppressionIndex(db: Db = prisma): Promise<{
  emails: Set<string>;
  domains: Set<string>;
  matches: (r: { email?: string | null; websiteUrl?: string | null }) => boolean;
}> {
  const rows = await db.suppression.findMany({ select: { email: true, domain: true } });
  const emails = new Set(rows.flatMap((r) => (r.email ? [r.email] : [])));
  const domains = new Set(rows.flatMap((r) => (r.domain ? [r.domain] : [])));
  return {
    emails,
    domains,
    matches: (r) => {
      const keys = suppressionKeys({ email: r.email ?? null, websiteUrl: r.websiteUrl ?? null });
      return (keys.email !== null && emails.has(keys.email)) || (keys.domain !== null && domains.has(keys.domain));
    },
  };
}

export function suppressedMessage(s: { clinicName: string; reason: string }): string {
  const why = SUPPRESSION_REASON_LABELS[s.reason as SuppressionReason] ?? s.reason;
  return `${s.clinicName} is on the suppression list (${why.toLowerCase()}) — it is not contacted on any channel.`;
}
