// Search history by channel, end to end — including the migration.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-search-history-channels.ts
//
// Builds its own scratch database (the file DATABASE_URL names is deleted and
// recreated): every migration up to the one before the search log had a
// channel, a seed of logged searches as they stand today, then the migration
// itself. Checks that every existing entry is LinkedIn with its count and
// status intact, that a Clinic-first search logs as email in a row of its
// own, that each side's statuses count only that side's runs — so on Email
// every term starts as New — and that logging by hand lands on the channel
// it was added from.

import { execSync } from "node:child_process";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";

const CACHE_STUB = path.join(__dirname, "next-cache-stub.cjs");
type Resolver = (request: string, ...args: unknown[]) => string;
const resolveFilename = (Module as unknown as { _resolveFilename: Resolver })._resolveFilename;
(Module as unknown as { _resolveFilename: Resolver })._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "next/cache") return CACHE_STUB;
  return resolveFilename.call(this, request, ...args);
};

let failures = 0;
function check(label: string, passed: boolean, detail = ""): void {
  if (!passed) failures++;
  console.log(`  ${passed ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const NEW_MIGRATION = "20261029130000_search_log_channel";
const ROOT = path.join(__dirname, "..");

function migrate(schemaDir: string): void {
  execSync(`npx prisma migrate deploy --schema ${path.join(schemaDir, "schema.prisma")}`, {
    cwd: ROOT,
    stdio: "pipe",
    env: process.env,
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/verify/.test(url) || !url.startsWith("file:")) {
    throw new Error("Refusing to run: DATABASE_URL must be a file: URL with 'verify' in its name — this script deletes it.");
  }
  const file = url.slice("file:".length);
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-journal`, { force: true });

  // ─── The log as it stands before this change ─────────────────────────────
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "verify-search-log-"));
  fs.cpSync(path.join(ROOT, "prisma"), old, { recursive: true });
  fs.rmSync(path.join(old, "migrations", NEW_MIGRATION), { recursive: true, force: true });
  migrate(old);
  fs.rmSync(old, { recursive: true, force: true });

  const { prisma } = await import("../src/lib/prisma");
  const t = Date.now() - 7 * 86_400_000;
  const seed = [
    ["log-1", "CLINIC_KEYWORD", "spinal decompression", 12, null],
    ["log-2", "CLINIC_KEYWORD", "disc center", 3, null],
    ["log-3", "CLINIC_KEYWORD", "drx9000", 0, "WELL_USED"],
    ["log-4", "LINKEDIN_SEARCH", '{"title":"chiropractor"}', 5, null],
  ] as const;
  for (const [id, type, key, runCount, override] of seed) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ApifySearchLog" ("id","type","key","runCount","manualStatusOverride","firstRunAt","lastRunAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      id, type, key, runCount, override, runCount > 0 ? t : null, runCount > 0 ? t : null, t, t,
    );
  }
  await prisma.$disconnect();

  // ─── The migration ───────────────────────────────────────────────────────
  migrate(path.join(ROOT, "prisma"));

  process.env.APIFY_API_TOKEN = "test-token";
  // Nothing listens here: the run fails at once, after the search was logged.
  process.env.APIFY_API_BASE = "http://127.0.0.1:9";
  const { listApifySearchLogs, clinicKeywordStatuses, recordApifySearchRun, addApifySearchLogEntry } = await import("../src/lib/actions/apifySearchLog");
  const { searchStatus } = await import("../src/lib/apifySearchLog");
  const { runClinicSearchTerm } = await import("../src/lib/clinicSearchRun");
  const { DEFAULT_CLINIC_SEARCH_CONFIG } = await import("../src/lib/clinicDiscovery");

  console.log("\nExisting entries");
  const all = await prisma.apifySearchLog.findMany({ orderBy: { id: "asc" } });
  check("none deleted", all.length === 4);
  check("every one is linkedin", all.every((r) => r.channel === "linkedin"));
  check("counts, statuses and dates unchanged",
    JSON.stringify(all.map((r) => [r.id, r.runCount, r.manualStatusOverride, r.lastRunAt?.getTime() ?? null])) ===
      JSON.stringify(seed.map(([id, , , n, o]) => [id, n, o, n > 0 ? t : null])));
  check("the LinkedIn side shows them all", (await listApifySearchLogs("linkedin")).length === 4);
  check("the Email side starts empty", (await listApifySearchLogs("email")).length === 0);
  const pills = await clinicKeywordStatuses(["spinal decompression", "disc center", "DRX9000"]);
  check("on Email every term starts as New (no row, however often it ran for LinkedIn)", Object.keys(pills).length === 0, JSON.stringify(pills));

  console.log("\nA Clinic-first search logs as email");
  const result = await runClinicSearchTerm("Spinal Decompression", DEFAULT_CLINIC_SEARCH_CONFIG, "compass~crawler-google-places");
  check("(the fake run itself fails, after logging)", result.error !== null);
  const emailRow = await prisma.apifySearchLog.findFirst({ where: { channel: "email", key: "spinal decompression" } });
  check("a new email row, counting one run", emailRow?.runCount === 1 && emailRow.type === "CLINIC_KEYWORD");
  check("the LinkedIn row for the same term is untouched",
    (await prisma.apifySearchLog.findUniqueOrThrow({ where: { id: "log-1" } })).runCount === 12);
  const after = await clinicKeywordStatuses(["spinal decompression", "disc center"]);
  check("its pill reads Used from the one email run, not Well used from LinkedIn's 12",
    after["spinal decompression"] !== undefined && searchStatus(after["spinal decompression"]).status === "USED" && after["disc center"] === undefined,
    JSON.stringify(after));
  const linkedin = await listApifySearchLogs("linkedin");
  check("the LinkedIn side's status for it is still Well used",
    searchStatus(linkedin.find((r) => r.key === "spinal decompression")!).status === "WELL_USED");

  console.log("\nThe LinkedIn import still logs as linkedin");
  await recordApifySearchRun({ type: "LINKEDIN_SEARCH", raw: '{ "title": "chiropractor" }', channel: "linkedin" });
  check("same search, same LinkedIn row, one more run",
    (await prisma.apifySearchLog.findUniqueOrThrow({ where: { id: "log-4" } })).runCount === 6 &&
      (await prisma.apifySearchLog.count({ where: { type: "LINKEDIN_SEARCH" } })) === 1);

  console.log("\nLogging by hand");
  await addApifySearchLogEntry({ type: "CLINIC_KEYWORD", raw: "disc center", status: "SATURATING", channel: "email" });
  const handEmail = await prisma.apifySearchLog.findFirst({ where: { channel: "email", key: "disc center" } });
  check("lands on the channel it was added from", handEmail?.manualStatusOverride === "SATURATING" && handEmail.runCount === 0);
  check("and leaves the LinkedIn row alone",
    (await prisma.apifySearchLog.findUniqueOrThrow({ where: { id: "log-2" } })).manualStatusOverride === null);
  check("the Email side now lists exactly its two", (await listApifySearchLogs("email")).length === 2);

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
