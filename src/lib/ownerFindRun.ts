// What is left of owner-finding's run, now that the contact finder
// (src/lib/contactFinderRun.ts) does the looking: this month's Hunter credits,
// putting a confirmed owner onto the lead (Settings → Email's re-clean), and
// rebuilding an unsent draft when its contact or address changed.
// Server-only. The owner rules themselves are src/lib/ownerFind.ts.

import { prisma } from "@/lib/prisma";
import { syncLeadInbox, releaseInboxIfUnsent } from "@/lib/emailInboxes";
import { monthStart } from "@/lib/emailCheck";
import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { defaultEmailVersion, renderEmail } from "@/lib/emailWorkflow";

export async function hunterCreditsUsedThisMonth(now = new Date()): Promise<number> {
  const r = await prisma.hunterCall.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { creditsUsed: true } });
  return r._sum.creditsUsed ?? 0;
}

// The confirmed owner becomes the lead's contact — the person the owner email
// greets and the front-desk email asks to be passed to — and the contact
// check is settled. An unsent drafted email is rebuilt around them, and a
// lead already in sequence keeps the contact it was sent to.
export async function setOwnerAsContact(leadId: string, name: string, title: string | null): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { emailSends: { select: { id: true } } } });
  if (!lead || lead.emailSends.length > 0) return;
  const updated = { ...lead, contactName: name, contactTitle: title ?? lead.contactTitle };
  const settings = lead.emailOpener ? await loadEmailSettings() : null;
  const email = settings && lead.emailOpener ? renderEmail(settings, updated, defaultEmailVersion(lead), lead.emailOpener) : null;
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      contactName: name,
      ...(title ? { contactTitle: title } : {}),
      contactConfirmedAt: new Date(),
      ...(email && (email.subject !== lead.emailSubject || email.body !== lead.emailBody)
        ? { emailSubject: email.subject, emailBody: email.body, emailApprovedAt: null }
        : {}),
    },
  });
  // A settled contact can make the lead Ready; a rebuilt draft takes it out.
  await syncLeadInbox(leadId);
}

// The owner's address is the main email now: an unsent draft written for the
// front desk is rebuilt as the owner-direct version.
export async function rebuildDraft(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { emailSends: { select: { id: true } } } });
  if (!lead || !lead.emailOpener || lead.emailSends.length > 0) return;
  const settings = await loadEmailSettings();
  const email = renderEmail(settings, lead, defaultEmailVersion(lead), lead.emailOpener);
  // Unchanged copy keeps its approval.
  if (email.subject === lead.emailSubject && email.body === lead.emailBody) return;
  await prisma.lead.update({ where: { id: leadId }, data: { emailSubject: email.subject, emailBody: email.body, emailApprovedAt: null } });
  await releaseInboxIfUnsent(leadId);
}
