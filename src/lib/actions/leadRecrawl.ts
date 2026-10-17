"use server";

// "Re-crawl website" for Pipeline leads: the selected ones, or every lead
// last crawled before a date (the ones still on the old 3-page crawl). The
// Website Content Crawler alone, under the current settings — six pages,
// program pages first, links kept — replacing the stored notes and links.
// No other actor, no rescoring, no stage change.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recrawlWebsite, whenRecrawlLands } from "@/lib/websiteCrawlRun";

export type LeadRecrawlResult =
  | { ok: true; clinicName: string; pages: number; links: number; note: string | null }
  | { ok: false; clinicName: string; error: string; pending?: boolean; capacity?: boolean };

export async function recrawlLeadWebsite(id: string): Promise<LeadRecrawlResult> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { clinicName: true, websiteUrl: true } });
  if (!lead) return { ok: false, clinicName: "That lead", error: "No longer here." };
  const url = (lead.websiteUrl ?? "").trim();
  if (url === "") return { ok: false, clinicName: lead.clinicName, error: "No website URL on this lead." };
  const read = await recrawlWebsite(url);
  const stored = whenRecrawlLands(read, async (r) => {
    await prisma.lead.update({
      where: { id },
      data: { websiteNotes: r.websiteNotes, websiteLinks: r.websiteLinks, enrichedAt: new Date() },
    });
  });
  if (!read.ok) {
    return { ok: false, clinicName: lead.clinicName, error: read.error, pending: read.later !== undefined, capacity: read.capacity };
  }
  await stored;
  revalidatePath(`/pipeline/${id}`);
  return { ok: true, clinicName: lead.clinicName, pages: read.pages, links: read.links, note: read.note };
}

export interface CrawlTarget {
  id: string;
  clinicName: string;
}

// Open leads with a website whose last crawl was before the date, or that
// were never crawled. Archived leads are left out.
export async function leadsCrawledBefore(isoDate: string): Promise<{ ok: true; leads: CrawlTarget[] } | { ok: false; error: string }> {
  const before = new Date(isoDate);
  if (Number.isNaN(before.getTime())) return { ok: false, error: "That is not a date." };
  const leads = await prisma.lead.findMany({
    where: {
      archived: false,
      websiteUrl: { not: null },
      NOT: { websiteUrl: "" },
      OR: [{ enrichedAt: null }, { enrichedAt: { lt: before } }],
    },
    orderBy: { enrichedAt: "asc" },
    select: { id: true, clinicName: true },
  });
  return { ok: true, leads };
}
