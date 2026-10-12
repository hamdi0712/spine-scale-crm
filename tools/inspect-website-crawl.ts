// What the Website Content Crawler actually returned — the raw items, not the
// summary.
//
// This exists because of a failure mode the run summary could not describe. A
// crawl would succeed, report no error, and the enrichment would come back
// with "ran, but nothing in the result reads as website notes" — and there was
// no way, short of opening the Apify console, to tell which of four different
// things had happened:
//
//   the site sits behind a bot wall and every page came back 403;
//   the URL is stale and every page came back 404;
//   the pages came back 200 and empty, because the copy is built in the
//     browser and the crawler was not running one;
//   the copy was there all along under a field name the reader did not know.
//
// So: point this at a URL, and it prints the raw dataset JSON exactly as Apify
// returned it, then the flattened table the enrichment reads from, then what
// crawledText() makes of it and why. The first tells you what the crawler saw;
// the last tells you whether this app can read it.
//
//   APIFY_API_TOKEN=... npx tsx tools/inspect-website-crawl.ts https://example.com
//
// The token is read the same way a real run reads it — the AppSecrets row
// first, APIFY_API_TOKEN second — so a DATABASE_URL pointing at the app's
// database lets it run with the key already saved on the Settings page:
//
//   DATABASE_URL="file:$PWD/prisma/dev.db" npx tsx tools/inspect-website-crawl.ts https://example.com
//
// It runs the crawl exactly as the app now does — two passes, the home page
// and then up to (pages − 1) links off it, program-looking links first — and
// prints, on top of the above, the links read off the pages, which of them
// were picked to follow, whether menu/footer text came through, and which
// links would count for the chiro "dedicated page" signal.
//
//   APIFY_API_TOKEN=... npx tsx tools/inspect-website-crawl.ts https://example.com [pages]
//
// It spends money: up to [pages] crawled pages (default 6). Nothing is written
// to the database — this reads and prints.

import { crawlDiagnostics, crawledText, linksFromTable, EnrichTable } from "../src/lib/leadEnrich";
import { itemsToTable } from "../src/lib/apify";
import { DEFAULT_ACTOR_IDS } from "../src/lib/pipelineSettings";
import { mergeTables } from "../src/lib/websiteCrawlRun";
import {
  DEFAULT_WEBSITE_CRAWL_PAGES,
  choosePagesToFollow,
  crawlInput,
  dedupeLinks,
  isProgramLink,
  readWebsiteCrawlPages,
} from "../src/lib/websiteCrawl";

const API_BASE = "https://api.apify.com/v2";
const RUN_TIMEOUT_SECONDS = 180;

// Words that only turn up in a site's menu or footer, to tell whether the
// chrome survived the crawl.
const NAV_HINTS = ["home", "about", "contact", "services", "privacy", "copyright", "©", "book", "schedule"];

async function run(token: string, actorId: string, input: object, maxItems: number, label: string) {
  console.log(`\n── ${label}: input sent ─────────────────────────────────────`);
  console.log(JSON.stringify(input, null, 2));
  const endpoint =
    `${API_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items` +
    `?timeout=${RUN_TIMEOUT_SECONDS}&maxItems=${maxItems}&limit=${maxItems}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    console.error(`\nApify said HTTP ${response.status}:`);
    console.error(await response.text());
    process.exit(1);
  }
  const items = (await response.json()) as unknown[];
  console.log(`\n── ${label}: raw items (text/markdown truncated) ──────────────`);
  console.log(
    JSON.stringify(
      items.map((it) =>
        it && typeof it === "object"
          ? Object.fromEntries(
              Object.entries(it as Record<string, unknown>).map(([k, v]) => [
                k,
                typeof v === "string" && v.length > 1500 ? `${v.slice(0, 1500)}… (${v.length} chars)` : v,
              ]),
            )
          : it,
      ),
      null,
      2,
    ),
  );
  return itemsToTable(Array.isArray(items) ? items : [], maxItems);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx tools/inspect-website-crawl.ts <website-url> [pages] [actor-id]");
    process.exit(1);
  }
  const pages = process.argv[3] ? readWebsiteCrawlPages(process.argv[3]) : DEFAULT_WEBSITE_CRAWL_PAGES;
  const actorId = process.argv[4] ?? DEFAULT_ACTOR_IDS.websiteContent;

  const token = await readToken();
  if (!token) {
    console.error(
      "No Apify token. Set APIFY_API_TOKEN, or point DATABASE_URL at the app's database if the key is saved on the Settings page.",
    );
    process.exit(1);
  }
  console.log(`actor: ${actorId}   page limit: ${pages}`);

  const home = await run(token, actorId, crawlInput([url], 1), 1, "Pass 1 (home page)");
  const homeLinks = linksFromTable(home);
  const follow = choosePagesToFollow(homeLinks, url, pages - 1);

  console.log("\n── Links read off the home page ────────────────────────────");
  console.log(`${homeLinks.length} links`);
  for (const l of homeLinks.slice(0, 80)) console.log(`  [${l.text || "(no text)"}] ${l.url}`);
  if (homeLinks.length > 80) console.log(`  … ${homeLinks.length - 80} more`);

  console.log("\n── Pages picked to follow (priority first) ─────────────────");
  for (const f of follow) console.log(`  ${f}`);
  if (follow.length === 0) console.log("  none — the app would fall back to one crawl from home, depth 1");

  let table: EnrichTable = home;
  if (follow.length > 0) {
    const rest = await run(token, actorId, crawlInput(follow, follow.length), follow.length, "Pass 2 (followed pages)");
    table = mergeTables(home, rest);
  } else if (pages > 1) {
    table = await run(token, actorId, { ...crawlInput([url], pages), maxCrawlDepth: 1 }, pages, "Fallback crawl");
  }

  console.log("\n── Flattened headers the reader sees ───────────────────────");
  for (const header of table.headers) {
    const index = table.headers.indexOf(header);
    const lengths = table.rows.map((row) => (row[index] ?? "").length);
    console.log(`  ${header}  (chars per page: ${lengths.join(", ")})`);
  }

  console.log("\n── Diagnosis ───────────────────────────────────────────────");
  console.log(crawlDiagnostics(table));

  const notes = crawledText(table);
  console.log("\n── Menu / footer text check ────────────────────────────────");
  if (notes) {
    const lower = notes.toLowerCase();
    const found = NAV_HINTS.filter((h) => lower.includes(h));
    console.log(`menu/footer words present: ${found.join(", ") || "NONE — nav and footer look stripped"}`);
  }

  const links = dedupeLinks(linksFromTable(table));
  const program = links.filter((l) => l.text.trim() !== "" && isProgramLink(l));
  console.log("\n── All links stored as websiteLinks ────────────────────────");
  console.log(`${links.length} links${links.length === 0 ? " — NONE: links are not coming through, signal 1 cannot use them" : ""}`);
  console.log("\n── Links that would count for the 'dedicated page' signal ──");
  for (const l of program) console.log(`  [${l.text}] ${l.url}   (on ${l.page})`);
  if (program.length === 0) console.log("  none");

  console.log("\n── What would be stored as websiteNotes ────────────────────");
  if (notes === null) {
    console.log("NOTHING — read the diagnosis above.");
  } else {
    console.log(`${notes.length} characters:\n`);
    console.log(notes.slice(0, 2000));
    if (notes.length > 2000) console.log("\n… (truncated for this printout)");
  }
}

// The app's own token lookup when a database is reachable, the environment
// variable when it is not — so this runs with or without DATABASE_URL set.
async function readToken(): Promise<string | null> {
  try {
    const { getApifyApiToken } = await import("../src/lib/appSecretsStore");
    const stored = await getApifyApiToken();
    if (stored) return stored;
  } catch {
    // No database configured, or no client generated. The environment is the
    // documented fallback and needs no apology.
  }
  return process.env.APIFY_API_TOKEN ?? null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
