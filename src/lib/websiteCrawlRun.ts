// The website crawl, in two passes — the home page, then the pages most
// likely to hold a program.
//
// Server-only and not a "use server" module, on the same terms as
// src/lib/enrichRun.ts, which calls it for the crawler's turn in the chain;
// the Discovery "Re-crawl website" action calls it on its own. It reaches
// Apify and nothing else, and writes nothing.
//
// Pass 1 reads the home page alone, keeping its menu, header and footer, and
// reads every link off it. Pass 2 reads up to (page limit − 1) of those links
// on the clinic's own site, the ones mentioning decompression, disc, sciatica,
// back pain, spine or avoiding surgery first (choosePagesToFollow in
// src/lib/websiteCrawl.ts). Both are billed per page, so the two passes cost
// what one crawl of the same number of pages would.
//
// A home page with no usable links falls back to a single crawl from the home
// page with the crawler choosing, which is how this step always ran. A second
// pass that fails keeps the home page rather than losing the run.

import { runApifySync } from "@/lib/apify";
import {
  ENRICH_ACTORS,
  EnrichTable,
  crawlDiagnostics,
  linksFromTable,
  sanitizeEnrichUpdate,
} from "@/lib/leadEnrich";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { PipelineSettings } from "@/lib/pipelineSettings";
import { choosePagesToFollow, crawlInput } from "@/lib/websiteCrawl";

export type WebsiteCrawlResult =
  | {
      ok: true;
      table: EnrichTable;
      // What the run did, for the outcome line: the pages read in pass 2 and
      // how many of them were priority picks.
      followed: string[];
      note: string | null;
    }
  | { ok: false; error: string };

export async function runWebsiteCrawl(
  websiteUrl: string,
  settings: Pick<PipelineSettings, "steps" | "websiteCrawlPages">,
): Promise<WebsiteCrawlResult> {
  const actorId = settings.steps.websiteContent.actorId;
  const pages = settings.websiteCrawlPages;

  const home = await runApifySync({
    kind: "actor",
    id: actorId,
    input: JSON.stringify(crawlInput([websiteUrl], 1)),
    maxItems: 1,
  });
  if (!home.ok) return { ok: false, error: home.error };
  const homeTable: EnrichTable = { headers: home.headers, rows: home.rows };
  if (pages <= 1) return { ok: true, table: homeTable, followed: [], note: null };

  const follow = choosePagesToFollow(linksFromTable(homeTable), websiteUrl, pages - 1);

  if (follow.length === 0) {
    // Nothing to choose from — a site whose menu is built entirely by script,
    // or one page with no links. Let the crawler find its own way, as before.
    const whole = await runApifySync({
      kind: "actor",
      id: actorId,
      input: JSON.stringify({ ...crawlInput([websiteUrl], pages), maxCrawlDepth: 1 }),
      maxItems: pages,
    });
    if (!whole.ok) {
      return { ok: true, table: homeTable, followed: [], note: `only the home page was read — the full crawl failed: ${whole.error}` };
    }
    return {
      ok: true,
      table: { headers: whole.headers, rows: whole.rows },
      followed: [],
      note: "no links could be read off the home page, so the crawler chose the pages",
    };
  }

  const rest = await runApifySync({
    kind: "actor",
    id: actorId,
    input: JSON.stringify(crawlInput(follow, follow.length)),
    maxItems: follow.length,
  });
  if (!rest.ok) {
    return { ok: true, table: homeTable, followed: [], note: `only the home page was read — the second pass failed: ${rest.error}` };
  }
  return {
    ok: true,
    table: mergeTables(homeTable, { headers: rest.headers, rows: rest.rows }),
    followed: follow,
    note: null,
  };
}

// Two flattened results as one: the union of their columns, rows realigned.
export function mergeTables(a: EnrichTable, b: EnrichTable): EnrichTable {
  const headers = [...a.headers];
  for (const h of b.headers) if (!headers.includes(h)) headers.push(h);
  const realign = (t: EnrichTable) =>
    t.rows.map((row) => headers.map((h) => {
      const i = t.headers.indexOf(h);
      return i === -1 ? "" : row[i] ?? "";
    }));
  return { headers, rows: [...realign(a), ...realign(b)] };
}

// The re-crawl both "Re-crawl website" actions run — Discovery's for
// candidates and Pipeline's for leads: the crawler alone, under the current
// settings, read the way an enrichment reads it. Writes nothing; the caller
// stores the notes and links on its own record. A crawl that reads nothing is
// an error, so the stored notes are never replaced with nothing.
export type RecrawlRead =
  | { ok: true; websiteNotes: string; websiteLinks: string | null; pages: number; links: number; note: string | null }
  | { ok: false; error: string };

export async function recrawlWebsite(websiteUrl: string): Promise<RecrawlRead> {
  const settings = await loadPipelineSettings();
  if (!settings.steps.websiteContent.enabled) {
    return { ok: false, error: "The Website Content Crawler is turned off in Settings → Pipeline." };
  }
  let crawl: WebsiteCrawlResult;
  try {
    crawl = await runWebsiteCrawl(websiteUrl, settings);
  } catch {
    return { ok: false, error: "The crawl could not be reached." };
  }
  if (!crawl.ok) return { ok: false, error: crawl.error };
  const actor = ENRICH_ACTORS.find((a) => a.key === "websiteContent")!;
  const read = sanitizeEnrichUpdate(actor.read(crawl.table));
  if (read.websiteNotes === undefined) {
    return { ok: false, error: `The crawl ran but read nothing — ${crawlDiagnostics(crawl.table)}. The stored notes were kept.` };
  }
  return {
    ok: true,
    websiteNotes: read.websiteNotes,
    websiteLinks: read.websiteLinks ?? null,
    pages: crawl.table.rows.length,
    links: read.websiteLinks ? (JSON.parse(read.websiteLinks) as unknown[]).length : 0,
    note: crawl.note,
  };
}
