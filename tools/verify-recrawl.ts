// Bulk re-crawl against a fake Apify, end to end: started-then-checked runs,
// the retry on a real timeout, a run still going when the wait runs out (and
// its result saved when it lands), a concurrency/memory-limit refusal backed
// off and retried, and the job runner running several at once.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-recrawl.ts
//
// Spends nothing: APIFY_API_BASE points the app at a server this script runs.

import http from "node:http";
import Module from "node:module";
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── The fake Apify ────────────────────────────────────────────────────────
//
// Sites by host: fast (finishes after a few polls), timeout (every first run
// of a pass times out with nothing; the retry succeeds), cap (the first start
// is refused for the memory limit), slow (runs past the page's wait), twice
// (times out on the retry too).
interface FakeRun {
  id: string;
  host: string;
  urls: string[];
  polls: number;
  finishAt: number; // polls until it ends
  end: "SUCCEEDED" | "TIMED-OUT";
  items: unknown[];
}
const runs = new Map<string, FakeRun>();
const starts: Record<string, number> = {};
let capRefused = 0;
let running = 0;
let maxRunning = 0;
let nextId = 1;

function pageItems(urls: string[], host: string): unknown[] {
  return urls.map((url) => ({
    url,
    text: `${host} page ${url}. We offer spinal decompression and a free consultation for new patients.`,
    markdown:
      url.endsWith("/") && !url.includes("/spinal")
        ? `[Home](https://${host}/) [Spinal Decompression](https://${host}/spinal-decompression/) [About](https://${host}/about/)\nWelcome to ${host}.`
        : `Page ${url}`,
  }));
}

function startRun(input: { startUrls: { url: string }[] }): { status: number; body: unknown } {
  const urls = input.startUrls.map((u) => u.url);
  const host = new URL(urls[0]).hostname;
  const key = `${host}|${urls.length === 1 && urls[0].endsWith(".test/") ? "home" : "rest"}`;
  starts[key] = (starts[key] ?? 0) + 1;
  if (host === "cap.test" && capRefused === 0) {
    capRefused++;
    return { status: 402, body: { error: { type: "actor-memory-limit-exceeded", message: "By launching this job you will exceed the memory limit of 8192MB." } } };
  }
  const id = `run${nextId++}`;
  const firstTry = starts[key] === 1;
  const end: FakeRun["end"] =
    (host === "timeout.test" && firstTry) || host === "twice.test" ? "TIMED-OUT" : "SUCCEEDED";
  const run: FakeRun = {
    id,
    host,
    urls,
    polls: 0,
    finishAt: host === "slow.test" ? 70 : 3,
    end,
    items: end === "TIMED-OUT" ? [] : pageItems(urls, host),
  };
  runs.set(id, run);
  running++;
  maxRunning = Math.max(maxRunning, running);
  return { status: 201, body: { data: { id, status: "RUNNING", defaultDatasetId: `ds-${id}` } } };
}

function poll(id: string): unknown {
  const run = runs.get(id)!;
  run.polls++;
  const done = run.polls >= run.finishAt;
  if (done && run.polls === run.finishAt) running--;
  return { data: { id, status: done ? run.end : "RUNNING", defaultDatasetId: `ds-${id}` } };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const url = new URL(req.url!, "http://x");
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    await sleep(120);
    if (req.method === "POST" && /\/acts\/.+\/runs$/.test(url.pathname)) {
      const r = startRun(JSON.parse(body));
      return send(r.status, r.body);
    }
    const m = url.pathname.match(/\/actor-runs\/(run\d+)$/);
    if (m) return send(200, poll(m[1]));
    const d = url.pathname.match(/\/datasets\/ds-(run\d+)\/items$/);
    if (d) return send(200, runs.get(d[1])?.items ?? []);
    send(404, { error: { type: "not-found" } });
  });
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.APIFY_API_BASE = `http://127.0.0.1:${port}`;
  process.env.APIFY_API_TOKEN = "test-token";
  process.env.RECRAWL_WAIT_MS = "6000";
  process.env.JOB_BACKOFF_MS = "300";

  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  const { loadPipelineSettings, savePipelineSettings } = await import("../src/lib/pipelineSettingsStore");
  const { startCandidateRecrawl } = await import("../src/lib/actions/jobs");
  const { readJob, launchJob } = await import("../src/lib/jobRunner");
  const { runWebsiteCrawl } = await import("../src/lib/websiteCrawlRun");

  await prisma.jobRunItem.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.discoveryCandidate.deleteMany();
  await savePipelineSettings({ ...(await loadPipelineSettings()), recrawlConcurrency: 4, websiteCrawlPages: 3 });
  check("Re-crawls at once defaults to 4", (await loadPipelineSettings()).recrawlConcurrency === 4);

  const sites = ["fast", "timeout", "cap", "slow", "twice", "fast2", "fast3", "fast4"];
  const ids: Record<string, string> = {};
  for (const s of sites) {
    const c = await prisma.discoveryCandidate.create({
      data: { clinicName: `${s} clinic`, status: "REJECTED", websiteUrl: `https://${s}.test/`, websiteNotes: "old notes" },
    });
    ids[s] = c.id;
  }

  console.log("\nBulk re-crawl of 8 clinics, 4 at once, against the fake Apify");
  const t0 = Date.now();
  const launched = await startCandidateRecrawl(sites.map((s) => ids[s]));
  if (!launched.ok) throw new Error(launched.error);
  let job = await readJob(launched.id);
  let sawParallel = 0;
  while (job && job.status === "running") {
    await sleep(200);
    job = await readJob(launched.id);
    if (job?.current?.includes("more")) sawParallel++;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  finished in ${secs}s: ${job?.succeeded} succeeded, ${job?.failed} failed`);
  const items = await prisma.jobRunItem.findMany({ where: { runId: launched.id }, orderBy: { seq: "asc" } });
  for (const i of items) console.log(`    ${i.name.padEnd(16)} ${i.outcome.padEnd(5)} ${i.detail}`);
  const by = (s: string) => items.find((i) => i.subjectId === ids[s]);

  check("several ran at once (Apify saw more than one run at a time)", maxRunning > 1 && maxRunning <= 8, `peak ${maxRunning} runs`);
  check("the panel showed more than one clinic in flight", sawParallel > 0);
  check("every clinic is recorded exactly once", items.length === 8 && new Set(items.map((i) => i.subjectId)).size === 8);
  check("a pass that timed out with nothing read was retried once and succeeded",
    by("timeout")?.outcome === "warn" && /retried/.test(by("timeout")!.detail), by("timeout")?.detail);
  check("a crawl that timed out twice is marked failed, saying it was retried",
    by("twice")?.outcome === "error" && /twice/.test(by("twice")!.detail), by("twice")?.detail);
  check("a memory-limit refusal was backed off and retried, not failed",
    capRefused === 1 && by("cap")?.outcome === "ok", by("cap")?.detail);
  check("a crawl still running after the wait is reported, not failed",
    by("slow")?.outcome === "warn" && /Still running on Apify/.test(by("slow")!.detail), by("slow")?.detail);
  const fresh = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: ids.fast } });
  check("a finished crawl replaced the stored notes and links", fresh.websiteNotes !== "old notes" && fresh.websiteLinks !== null);
  check("same estimated cost as one at a time (pages × clinics)", Math.abs((job?.estimatedUsd ?? 0) - 8 * 0.003) < 1e-9, `$${job?.estimatedUsd}`);

  console.log("\nThe slow crawl, after the page gave up on it");
  let slow = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: ids.slow } });
  for (let i = 0; i < 120 && slow.websiteNotes === "old notes"; i++) {
    await sleep(250);
    slow = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: ids.slow } });
  }
  check("its result was collected and saved when the Apify run finished", slow.websiteNotes !== "old notes" && /slow\.test/.test(slow.websiteNotes ?? ""));
  check("and it was not started again", (starts["slow.test|home"] ?? 0) === 1);

  console.log("\nStop with clinics in flight");
  const many = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      prisma.discoveryCandidate.create({ data: { clinicName: `stop ${i}`, status: "REJECTED", websiteUrl: `https://fast.test/` } }),
    ),
  );
  let started = 0;
  const stopRun = await launchJob({
    kind: "recrawl-candidates",
    source: "verify-stop",
    verb: "Re-crawling",
    href: "/discovery",
    concurrency: 3,
    items: many.map((c) => ({ id: c.id, name: c.clinicName })),
    work: async () => {
      started++;
      await sleep(600);
      return { outcome: "ok", detail: "done" };
    },
  });
  if (!stopRun.ok) throw new Error(stopRun.error);
  await sleep(200);
  const { requestJobStop } = await import("../src/lib/jobRunner");
  await requestJobStop(stopRun.id);
  let s = await readJob(stopRun.id);
  while (s && s.status === "running") {
    await sleep(100);
    s = await readJob(stopRun.id);
  }
  check("Stop finishes the items already in flight and starts no more", s?.status === "stopped" && s.done === started && started === 3, `${s?.done} done of ${started} started`);

  console.log("\nProcess Queue and Compare scoring are unchanged");
  const fs = await import("node:fs");
  const enrich = fs.readFileSync(path.join(__dirname, "../src/lib/enrichRun.ts"), "utf8");
  check("Process Queue's crawl still calls the one-call run (no mode passed)", /runWebsiteCrawl\(required, settings\)/.test(enrich));
  const jobs = fs.readFileSync(path.join(__dirname, "../src/lib/actions/jobs.ts"), "utf8");
  check("only the two re-crawl jobs set concurrency", (jobs.match(/concurrency:/g) ?? []).length === 2);

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
