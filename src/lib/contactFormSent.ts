// When each lead's contact form was last marked sent (CONTACT_FORM_SENT in the
// activity feed). Server-only.

import { prisma } from "@/lib/prisma";

export async function formSentAtByLead(leadIds: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (leadIds.length === 0) return map;
  const rows = await prisma.activityLog.findMany({
    where: { leadId: { in: leadIds }, kind: "CONTACT_FORM_SENT" },
    orderBy: { createdAt: "desc" },
    select: { leadId: true, createdAt: true },
  });
  for (const r of rows) if (r.leadId && !map.has(r.leadId)) map.set(r.leadId, r.createdAt);
  return map;
}
