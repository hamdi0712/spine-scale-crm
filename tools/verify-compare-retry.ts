// Compare scoring's two fixes for a dropped connection:
//
//   1. The DeepSeek call retries a request that got no answer — it could not
//      connect, or it timed out — twice more, a few seconds apart, and only
//      that. Checked against a local fake DeepSeek.
//   2. "Retry failed records" re-scores just the records a comparison could
//      not score, into the same run; once none is left in error the run counts
//      as finished. Checked with the scripted model stub.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-compare-retry.ts

import http from "node:http";
import Module from "node:module";
import path from "node:path";

const CACHE_STUB = path.join(__dirname, "next-cache-stub.cjs");
const DEEPSEEK_STUB = path.join(__dirname, "deepseek-json-stub.cjs");
type Resolver = (request: string, ...args: unknown[]) => string;
const resolveFilename = (Module as unknown as { _resolveFilename: Resolver })._resolveFilename;
(Module as unknown as { _resolveFilename: Resolver })._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "next/cache") return CACHE_STUB;
  // The app's scoring path gets the scripted model; this script imports the
  // real client by its relative path to test the retry itself.
  if (request === "@/lib/deepseek") return DEEPSEEK_STUB;
  return resolveFilename.call(this, request, ...args);
};

let failures = 0;
function check(label: string, passed: boolean, detail = ""): void {
  if (!passed) failures++;
  console.log(`  ${passed ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── A fake DeepSeek ───────────────────────────────────────────────────────
// mode "drop N": the first N requests have their connection cut; then an
// answer. "error": answers 500 every time.
let mode: { kind: "drop"; n: number } | { kind: "error" } = { kind: "drop", n: 0 };
let calls = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    if (mode.kind === "drop" && calls <= mode.n) {
      req.socket.destroy();
      return;
    }
    if (mode.kind === "error") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream broke" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }));
  });
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.DEEPSEEK_API_URL = `http://127.0.0.1:${port}/chat/completions`;
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_RETRY_MS = "50";
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }

  // The real client, by path — not the stub.
  const { deepSeekJson } = await import("../src/lib/deepseek");
  const ask = (networkRetries: number) => deepSeekJson({ system: "json", user: "json", networkRetries });

  console.log("\nAuto-retry on a request that got no answer");
  mode = { kind: "drop", n: 2 };
  calls = 0;
  let r = await ask(2);
  check("two dropped connections, then an answer: succeeds on the third try", r.ok && calls === 3, `${calls} calls`);

  mode = { kind: "drop", n: 5 };
  calls = 0;
  r = await ask(2);
  check("three dropped connections: fails after 3 tries, and says so", !r.ok && calls === 3 && /tried 3 times/.test(r.ok ? "" : r.error), r.ok ? "" : r.error);

  mode = { kind: "error" };
  calls = 0;
  r = await ask(2);
  check("an answer that is an error is not retried", !r.ok && calls === 1, `${calls} call(s)`);

  mode = { kind: "drop", n: 1 };
  calls = 0;
  r = await ask(0);
  check("callers that do not ask for retries are unchanged (one try)", !r.ok && calls === 1);

  const fs = await import("node:fs");
  const runSrc = fs.readFileSync(path.join(__dirname, "../src/lib/icpScoringRun.ts"), "utf8");
  check("the scoring call asks for 2 retries", /networkRetries: 2/.test(runSrc));

  // ─── Retry failed records ────────────────────────────────────────────────
  console.log("\nRetry failed records into the same comparison");
  const { prisma } = await import("../src/lib/prisma");
  const stub = require(DEEPSEEK_STUB) as { setReplies: (m: Record<string, unknown>) => void };
  const { loadActiveIcp } = await import("../src/lib/icpDefinitionStore");
  const { compareOneSubject, finishScoringComparison } = await import("../src/lib/actions/scoringComparison");
  const { startComparisonRetryJob } = await import("../src/lib/actions/jobs");
  const { readJob } = await import("../src/lib/jobRunner");

  await prisma.jobRunItem.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.scoringComparisonRun.deleteMany();
  await prisma.discoveryCandidate.deleteMany();
  const icp = (await loadActiveIcp())!;
  const names = ["Alpha Spine", "Beta Chiro", "Gamma Disc Center"];
  const cands = await Promise.all(
    names.map((clinicName) =>
      prisma.discoveryCandidate.create({
        data: { clinicName, status: "REJECTED", websiteUrl: "https://x.test/", websiteNotes: `https://x.test/\nWelcome to ${clinicName}.`, icpTotal: 3, icpTier: "C", scoringModel: "v1" },
      }),
    ),
  );
  const run = await prisma.scoringComparisonRun.create({
    data: { icpDefinitionId: icp.id, icpName: icp.name, threshold: 60, subjects: 3, estimatedUsd: 0.003 },
  });
  // Two score; the third "loses its connection" (the stub has no reply for it).
  stub.setReplies({ "Alpha Spine": { summary: "" }, "Beta Chiro": { summary: "" } });
  for (const c of cands) await compareOneSubject(run.id, "candidate", c.id);
  const first = await finishScoringComparison(run.id);
  const firstRows = await prisma.scoringComparison.findMany({ where: { runId: run.id } });
  check("one record failed and the run is not finished (Apply stays locked)", !first.complete && first.errors === 1, JSON.stringify(first));
  const keptIds = firstRows.filter((r) => r.outcome !== "error").map((r) => r.id).sort();

  // Now the model answers for it too.
  stub.setReplies({ "Alpha Spine": { summary: "" }, "Beta Chiro": { summary: "" }, "Gamma Disc Center": { summary: "" } });
  const launched = await startComparisonRetryJob(run.id);
  if (!launched.ok) throw new Error(launched.error);
  let job = await readJob(launched.id);
  while (job && job.status === "running") {
    await sleep(100);
    job = await readJob(launched.id);
  }
  check("the retry job ran only the failed record", job?.total === 1 && job.succeeded === 1, `${job?.done} of ${job?.total}`);
  const after = await prisma.scoringComparison.findMany({ where: { runId: run.id } });
  const fresh = await prisma.scoringComparisonRun.findUniqueOrThrow({ where: { id: run.id } });
  check("its error row is replaced by a scored row in the same run", after.length === 3 && after.every((r) => r.outcome !== "error"));
  check("the other records were not re-scored", JSON.stringify(after.filter((r) => keptIds.includes(r.id)).map((r) => r.id).sort()) === JSON.stringify(keptIds));
  check("the comparison now counts as finished, so Apply unlocks", fresh.completedAt !== null);
  check("the job's closing note says so", /finished and Apply is unlocked/.test(job?.note ?? ""), job?.note ?? "");
  const again = await startComparisonRetryJob(run.id);
  check("retrying a finished comparison is refused", !again.ok);

  // A retry that fails again leaves the run locked and says so.
  const run2 = await prisma.scoringComparisonRun.create({
    data: { icpDefinitionId: icp.id, icpName: icp.name, threshold: 60, subjects: 1, estimatedUsd: 0 },
  });
  stub.setReplies({});
  await compareOneSubject(run2.id, "candidate", cands[0].id);
  const l2 = await startComparisonRetryJob(run2.id);
  if (!l2.ok) throw new Error(l2.error);
  let j2 = await readJob(l2.id);
  while (j2 && j2.status === "running") {
    await sleep(100);
    j2 = await readJob(l2.id);
  }
  const r2 = await prisma.scoringComparisonRun.findUniqueOrThrow({ where: { id: run2.id } });
  check("a record that fails again stays one error row, and the run stays locked",
    r2.completedAt === null && (await prisma.scoringComparison.count({ where: { runId: run2.id, outcome: "error" } })) === 1,
    j2?.note ?? "");

  await prisma.$disconnect();
  server.close();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
