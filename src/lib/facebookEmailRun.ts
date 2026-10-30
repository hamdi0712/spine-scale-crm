// The backup email finder, for an email lead that still has no address after
// Google Maps: the website first, then the clinic's Facebook page.
//
//   The website step is free — it reads the copy and links the crawler
//   already stored (pickSiteCrawlEmails) — and runs whenever the lead has
//   none. Promotion runs the same step on the way in (promotedEmailFields).
//   The Facebook step runs the page scraper set in Settings → Pipeline on the
//   lead's Facebook URL, and reads the address the page lists in its About
//   and contact info (pickFacebookEmails). It runs once per lead
//   (facebookEmailAt), found or not, and only while it is switched on.
//
// Either way an address is cleaned and labelled by the helpers in
// src/lib/emailFind.ts, lands unchecked, and never replaces an email the lead
// already has — the write only happens while the lead's email is still empty.
// The Instantly check is the caller's to start (autoCheckEmails), once.
//
// Server-only, and not a "use server" module: the queue, the lead page and
// the bulk job call it; the browser never does.

import { prisma } from "@/lib/prisma";
import { runApifySync } from "@/lib/apify";
import { PIPELINE_DEFAULT_WHERE } from "@/lib/liveLeadWhere";
import { backupEmailFields, pickFacebookEmails, pickSiteCrawlEmails } from "@/lib/emailFind";
import { PipelineSettings } from "@/lib/pipelineSettings";

export type BackupEmailOutcome =
  | { kind: "found"; email: string; source: "site_crawl" | "facebook_page"; detail: string }
  | { kind: "none"; detail: string }
  // quiet: nothing for this lead to do here (not an email lead, or it has
  // an email) — not worth a line in a run's report.
  | { kind: "skipped"; detail: string; quiet?: boolean }
  | { kind: "failed"; detail: string };

const LEAD_SELECT = {
  id: true,
  channel: true,
  email: true,
  emailAlternates: true,
  websiteUrl: true,
  websiteNotes: true,
  websiteLinks: true,
  facebookUrl: true,
  facebookEmailAt: true,
  contactName: true,
  icpBreakdown: true,
} as const;

// Lead where its email is still empty — what makes "never overwrite" hold
// even when somebody types one in while the page is being read.
function noEmailYet(id: string) {
  return { id, OR: [{ email: null }, { email: "" }] };
}

export function hasFacebookUrl(url: string | null): boolean {
  return (url ?? "").trim() !== "";
}

export async function findBackupEmail(leadId: string, settings: PipelineSettings): Promise<BackupEmailOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: LEAD_SELECT });
  if (!lead) return { kind: "skipped", detail: "No longer here." };
  if (lead.channel !== "email") return { kind: "skipped", detail: "Not an email lead.", quiet: true };
  if ((lead.email ?? "").trim() !== "") return { kind: "skipped", detail: "Already has an email.", quiet: true };

  // ─── The website, free ───────────────────────────────────────────────────
  const site = backupEmailFields(pickSiteCrawlEmails(lead), lead.emailAlternates);
  if (site) {
    const { count } = await prisma.lead.updateMany({ where: noEmailYet(leadId), data: site });
    if (count === 0) return { kind: "skipped", detail: "An email was added meanwhile — left alone." };
    return { kind: "found", email: site.email, source: "site_crawl", detail: `${site.email} — from the website` };
  }

  // ─── The Facebook page ───────────────────────────────────────────────────
  if (!settings.facebookEmails.enabled) {
    return { kind: "skipped", detail: "Nothing on the website, and Facebook page emails is off in Settings → Pipeline." };
  }
  if (!hasFacebookUrl(lead.facebookUrl)) return { kind: "none", detail: "Nothing on the website, and no Facebook page to read." };
  if (lead.facebookEmailAt) return { kind: "skipped", detail: "Its Facebook page was already read." };

  let result;
  try {
    result = await runApifySync({
      kind: "actor",
      id: settings.facebookEmails.actorId,
      input: JSON.stringify({ startUrls: [{ url: (lead.facebookUrl ?? "").trim() }] }),
      maxItems: 1,
    });
  } catch {
    return { kind: "failed", detail: "The Facebook page run could not be reached. Check the server's network connection and try again." };
  }
  // A failed run leaves facebookEmailAt empty, so it can be tried again.
  if (!result.ok) return { kind: "failed", detail: result.error };

  const now = new Date();
  const fields = backupEmailFields(pickFacebookEmails(result, lead), lead.emailAlternates);
  if (!fields) {
    await prisma.lead.update({ where: { id: leadId }, data: { facebookEmailAt: now } });
    return {
      kind: "none",
      detail: result.rows.length === 0 ? "The Facebook page came back empty." : "The Facebook page lists no usable email.",
    };
  }
  const { count } = await prisma.lead.updateMany({ where: noEmailYet(leadId), data: { ...fields, facebookEmailAt: now } });
  if (count === 0) {
    await prisma.lead.update({ where: { id: leadId }, data: { facebookEmailAt: now } });
    return { kind: "skipped", detail: "An email was added meanwhile — left alone." };
  }
  return { kind: "found", email: fields.email, source: "facebook_page", detail: `${fields.email} — from the Facebook page` };
}

// Email leads the bulk action would read: no email, a Facebook page, and that
// page not read yet.
export async function facebookEmailLeads(): Promise<{ id: string; clinicName: string }[]> {
  return prisma.lead.findMany({
    where: {
      ...PIPELINE_DEFAULT_WHERE,
      channel: "email",
      suppressedAt: null,
      facebookEmailAt: null,
      AND: [{ OR: [{ email: null }, { email: "" }] }, { facebookUrl: { not: null } }, { NOT: { facebookUrl: "" } }],
    },
    select: { id: true, clinicName: true },
    orderBy: { updatedAt: "asc" },
  });
}
