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

import { ApifyErrorCode, runApifyActor, runApifySync } from "@/lib/apify";
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
  | { ok: false; error: string; code?: ApifyErrorCode | null };

// How a pass reaches Apify. "sync" is the one-call run Process Queue has
// always used. "started" starts the run and checks on it until it ends (the
// bulk re-crawls), and retries a pass once on a real timeout that read
// nothing.
export type CrawlCallMode = "sync" | "started";

// The actor's own time limit for a started re-crawl pass. The page waits
// RECRAWL_WAIT_MS for an answer; a pass still going after that keeps running
// to this limit and its result is still collected (see recrawlWebsite).
export const RECRAWL_RUN_TIMEOUT_SECONDS = 600;

type PassResult =
  | { ok: true; headers: string[]; rows: string[][]; note: string | null }
  | { ok: false; error: string; code: ApifyErrorCode | null };

async function pass(
  mode: CrawlCallMode,
  args: { id: string; input: string; maxItems: number },
): Promise<PassResult> {
  if (mode === "sync") {
    const r = await runApifySync({ kind: "actor", ...args });
    return r.ok ? { ok: true, headers: r.headers, rows: r.rows, note: null } : { ok: false, error: r.error, code: null };
  }
  const once = () => runApifyActor({ kind: "actor", ...args, runTimeoutSeconds: RECRAWL_RUN_TIMEOUT_SECONDS });
  let r = await once();
  let retried = false;
  if (!r.ok && r.code === "timeout") {
    retried = true;
    r = await once();
  }
  if (!r.ok) {
    return { ok: false, error: retried ? `${r.error} (timed out twice — retried once)` : r.error, code: r.code };
  }
  const notes = [
    retried ? "timed out once and was retried" : null,
    r.timedOut ? "hit the time limit — kept the pages it read" : null,
  ].filter((n): n is string => n !== null);
  return { ok: true, headers: r.headers, rows: r.rows, note: notes.length ? notes.join("; ") : null };
}

export async function runWebsiteCrawl(
  websiteUrl: string,
  settings: Pick<PipelineSettings, "steps" | "websiteCrawlPages">,
  mode: CrawlCallMode = "sync",
): Promise<WebsiteCrawlResult> {
  const actorId = settings.steps.websiteContent.actorId;
  const pages = settings.websiteCrawlPages;
  const notes: string[] = [];

  const home = await pass(mode, {
    id: actorId,
    input: JSON.stringify(crawlInput([websiteUrl], 1)),
    maxItems: 1,
  });
  if (!home.ok) return { ok: false, error: home.error, code: home.code };
  if (home.note) notes.push(`home page ${home.note}`);
  const homeTable: EnrichTable = { headers: home.headers, rows: home.rows };
  const noted = (extra: string | null) => [...notes, ...(extra ? [extra] : [])].join("; ") || null;
  if (pages <= 1) return { ok: true, table: homeTable, followed: [], note: noted(null) };

  const follow = choosePagesToFollow(linksFromTable(homeTable), websiteUrl, pages - 1);

  if (follow.length === 0) {
    // Nothing to choose from — a site whose menu is built entirely by script,
    // or one page with no links. Let the crawler find its own way, as before.
    const whole = await pass(mode, {
      id: actorId,
      input: JSON.stringify({ ...crawlInput([websiteUrl], pages), maxCrawlDepth: 1 }),
      maxItems: pages,
    });
    if (!whole.ok) {
      return { ok: true, table: homeTable, followed: [], note: noted(`only the home page was read — the full crawl failed: ${whole.error}`) };
    }
    return {
      ok: true,
      table: { headers: whole.headers, rows: whole.rows },
      followed: [],
      note: noted(`no links could be read off the home page, so the crawler chose the pages${whole.note ? `; ${whole.note}` : ""}`),
    };
  }

  const rest = await pass(mode, {
    id: actorId,
    input: JSON.stringify(crawlInput(follow, follow.length)),
    maxItems: follow.length,
  });
  if (!rest.ok) {
    return { ok: true, table: homeTable, followed: [], note: noted(`only the home page was read — the second pass failed: ${rest.error}`) };
  }
  return {
    ok: true,
    table: mergeTables(homeTable, { headers: rest.headers, rows: rest.rows }),
    followed: follow,
    note: noted(rest.note ? `followed pages ${rest.note}` : null),
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
  | {
      ok: false;
      error: string;
      // The account's concurrency or memory limit: worth trying again in a
      // moment with fewer at once, not a failure of this clinic.
      capacity?: boolean;
      // Still running on Apify when the wait ran out. The run is not thrown
      // away: later resolves with its read once it ends, for the caller to
      // store.
      later?: Promise<RecrawlRead>;
    };

// How long a re-crawl waits for its answer before handing the run to the
// background to finish and be saved.
export const RECRAWL_WAIT_MS = 6 * 60 * 1000;

export async function recrawlWebsite(
  websiteUrl: string,
  // RECRAWL_WAIT_MS in the environment is for tools/verify-recrawl.ts.
  waitMs = Number(process.env.RECRAWL_WAIT_MS) || RECRAWL_WAIT_MS,
): Promise<RecrawlRead> {
  const settings = await loadPipelineSettings();
  if (!settings.steps.websiteContent.enabled) {
    return { ok: false, error: "The Website Content Crawler is turned off in Settings → Pipeline." };
  }
  const full = readCrawl(websiteUrl, settings);
  const pending = Symbol("pending");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    full,
    new Promise<typeof pending>((res) => {
      timer = setTimeout(() => res(pending), waitMs);
    }),
  ]);
  clearTimeout(timer);
  if (winner !== pending) return winner;
  return {
    ok: false,
    error: `Still running on Apify after ${waitMs >= 60_000 ? `${Math.round(waitMs / 60_000)} minutes` : `${Math.round(waitMs / 1000)} seconds`}. It was not cancelled — its pages will be saved to this record when it finishes.`,
    later: full,
  };
}

async function readCrawl(
  websiteUrl: string,
  settings: Awaited<ReturnType<typeof loadPipelineSettings>>,
): Promise<RecrawlRead> {
  let crawl: WebsiteCrawlResult;
  try {
    crawl = await runWebsiteCrawl(websiteUrl, settings, "started");
  } catch {
    return { ok: false, error: "The crawl could not be reached." };
  }
  if (!crawl.ok) return { ok: false, error: crawl.error, capacity: crawl.code === "capacity" };
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

// What a caller does with a re-crawl read: store it now if it is in, or —
// for a run still going when the wait ran out — store it whenever it lands.
// A late read that fails leaves the stored notes as they were.
export function whenRecrawlLands(
  read: RecrawlRead,
  store: (read: Extract<RecrawlRead, { ok: true }>) => Promise<void>,
): Promise<void> | null {
  if (read.ok) return store(read);
  if (read.later) {
    void read.later
      .then((late) => (late.ok ? store(late) : undefined))
      .catch(() => {});
  }
  return null;
}
