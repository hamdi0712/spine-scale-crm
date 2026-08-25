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
// It spends money: one crawler run, the same three pages a real enrichment
// asks for. Nothing is written to the database — this reads and prints.

import { ENRICH_ACTORS, crawlDiagnostics, crawledText } from "../src/lib/leadEnrich";
import { itemsToTable } from "../src/lib/apify";
import { DEFAULT_ACTOR_IDS } from "../src/lib/pipelineSettings";

const API_BASE = "https://api.apify.com/v2";
const RUN_TIMEOUT_SECONDS = 120;

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error(
      "Usage: npx tsx tools/inspect-website-crawl.ts <website-url> [actor-id]",
    );
    process.exit(1);
  }
  const actorId = process.argv[3] ?? DEFAULT_ACTOR_IDS.websiteContent;

  const token = await readToken();
  if (!token) {
    console.error(
      "No Apify token. Set APIFY_API_TOKEN, or point DATABASE_URL at the app's database if the key is saved on the Settings page.",
    );
    process.exit(1);
  }

  const actor = ENRICH_ACTORS.find((a) => a.key === "websiteContent");
  if (!actor) throw new Error("The websiteContent step is no longer in ENRICH_ACTORS.");

  // The very input a real run builds, rather than a hand-written one — the
  // point of this tool is to reproduce production, and an input that differs
  // in one field reproduces something else.
  const input = actor.buildInput({
    clinicName: "",
    companyLinkedinUrl: null,
    facebookUrl: null,
    location: null,
    websiteUrl: url,
  } as Parameters<typeof actor.buildInput>[0]);

  console.log("── Input sent ──────────────────────────────────────────────");
  console.log(`actor: ${actorId}`);
  console.log(JSON.stringify(input, null, 2));

  const endpoint =
    `${API_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items` +
    `?timeout=${RUN_TIMEOUT_SECONDS}&maxItems=${actor.maxItems}&limit=${actor.maxItems}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    console.error(`\nApify said HTTP ${response.status}:`);
    console.error(await response.text());
    process.exit(1);
  }

  const items = (await response.json()) as unknown[];

  console.log("\n── Raw dataset items, exactly as returned ──────────────────");
  console.log(JSON.stringify(items, null, 2));

  if (!Array.isArray(items) || items.length === 0) {
    console.log("\nThe run returned no items at all.");
    return;
  }

  // The same flattening the enrichment does, so a field that the reader cannot
  // see here is a field it cannot see in production either.
  const table = itemsToTable(items, actor.maxItems);

  console.log("\n── Flattened headers the reader sees ───────────────────────");
  for (const header of table.headers) {
    const index = table.headers.indexOf(header);
    const lengths = table.rows.map((row) => (row[index] ?? "").length);
    console.log(`  ${header}  (chars per page: ${lengths.join(", ")})`);
  }

  console.log("\n── Diagnosis ───────────────────────────────────────────────");
  console.log(crawlDiagnostics(table));

  const notes = crawledText(table);
  console.log("\n── What would be stored as websiteNotes ────────────────────");
  if (notes === null) {
    console.log(
      "NOTHING — this is the case that reports 'nothing in the result reads as website notes'.",
    );
    console.log(
      "Read the diagnosis above: HTTP 403/404 on every page is the site refusing the crawl, 200s with near-zero characters is a page built in the browser, and a header above that plainly holds the copy is a field this reader needs adding to CRAWLED_TEXT_FIELDS.",
    );
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
