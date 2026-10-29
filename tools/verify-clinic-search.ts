// Clinic-first search against a fake Apify: started-then-checked runs with a
// 15-minute actor timeout, a slow run followed to the end, a run that times
// out with partial results (kept, and counted), one that times out with
// nothing, a real input error, and the search as a job in the shared
// progress panel.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-clinic-search.ts
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

const TAG = "Search verify";

// ─── The fake Apify ────────────────────────────────────────────────────────
//
// Behaviour by search term: "slow" ends after many checks, well past what a
// two-minute single call would have waited for by Apify's own clock;
// "partial" times out with two places collected; "empty" times out with
// none; "bad input" is refused at the start as invalid input.
interface FakeRun {
  id: string;
  polls: number;
  finishAt: number;
  end: "SUCCEEDED" | "TIMED-OUT";
  items: unknown[];
  runTimeSecs: number;
}
const runs = new Map<string, FakeRun>();
const startTimeouts: string[] = [];
const startInputs: Record<string, unknown>[] = [];
let syncCalls = 0;
let nextId = 1;

function places(term: string, n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `${TAG} — ${term} clinic ${i + 1}`,
    website: `https://${term.replace(/\W/g, "")}${i + 1}.test`,
    address: `${i + 1} Main St, Austin, TX`,
    emails: [`info@${term.replace(/\W/g, "")}${i + 1}.test`],
  }));
}

function startRun(input: Record<string, unknown>, timeout: string | null): { status: number; body: unknown } {
  startInputs.push(input);
  startTimeouts.push(timeout ?? "");
  const term = (input.searchStringsArray as string[])[0];
  if (term === "bad input") {
    return {
      status: 400,
      body: { error: { type: "invalid-input", message: "Input is not valid: Field input.maxCrawledPlacesPerSearch must be >= 1" } },
    };
  }
  const id = `run${nextId++}`;
  const run: FakeRun =
    term === "slow"
      ? { id, polls: 0, finishAt: 25, end: "SUCCEEDED", items: places(term, 3), runTimeSecs: 612 }
      : term === "partial"
        ? { id, polls: 0, finishAt: 3, end: "TIMED-OUT", items: places(term, 2), runTimeSecs: 900 }
        : { id, polls: 0, finishAt: 3, end: "TIMED-OUT", items: [], runTimeSecs: 900 };
  runs.set(id, run);
  return { status: 201, body: { data: { id, status: "RUNNING", defaultDatasetId: `ds-${id}` } } };
}

function poll(id: string): unknown {
  const run = runs.get(id)!;
  run.polls++;
  const done = run.polls >= run.finishAt;
  return {
    data: {
      id,
      status: done ? run.end : "RUNNING",
      defaultDatasetId: `ds-${id}`,
      stats: { runTimeSecs: done ? run.runTimeSecs : 0 },
    },
  };
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
    await sleep(100);
    if (url.pathname.endsWith("/run-sync-get-dataset-items")) {
      // What Apify's one-call endpoint says when the actor hits its own
      // limit inside the call — the message the user was seeing.
      syncCalls++;
      return send(400, {
        error: { type: "run-failed", message: "Actor run did not succeed (run ID: abc123, status: TIMED-OUT)" },
      });
    }
    if (req.method === "POST" && /\/acts\/.+\/runs$/.test(url.pathname)) {
      const r = startRun(JSON.parse(body), url.searchParams.get("timeout"));
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

  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  const { loadPipelineSettings, savePipelineSettings } = await import("../src/lib/pipelineSettingsStore");
  const { startClinicSearchJob } = await import("../src/lib/actions/jobs");
  const { readJob, readJobs, readJobResults } = await import("../src/lib/jobRunner");
  const { combineClinicTermResults } = await import("../src/lib/clinicDiscovery");
  const { importClinicDiscoveryCandidates } = await import("../src/lib/actions/clinicDiscovery");
  const { runApifySync } = await import("../src/lib/apify");
  type ClinicTermResult = import("../src/lib/clinicDiscovery").ClinicTermResult;

  await prisma.jobRunItem.deleteMany({ where: { run: { source: "clinic-search" } } });
  await prisma.jobRun.deleteMany({ where: { source: "clinic-search" } });
  await prisma.discoveryCandidate.deleteMany({ where: { clinicName: { startsWith: TAG } } });
  const before = await loadPipelineSettings();
  await savePipelineSettings({ ...before, clinicDiscovery: { enabled: true, actorId: "compass~crawler-google-places" } });

  console.log("\nThe search as a job: slow, partial timeout, empty timeout, bad input");
  const t0 = Date.now();
  const launched = await startClinicSearchJob({
    config: { terms: ["slow", "partial", "empty", "bad input"], location: "Austin, TX", resultsPerTerm: 20 },
  });
  if (!launched.ok) throw new Error(launched.error);

  // In the shared progress panel while it runs — what the header pill and
  // the page's panel poll.
  await sleep(400);
  const live = (await readJobs()).find((j) => j.id === launched.id);
  check("listed in the shared progress poll while running", live?.status === "running" && live.kind === "clinic-search");
  check("on the slow term, linking back to the search page", live?.current === "slow" && live.href === "/discovery/import/clinic", `${live?.current} ${live?.href}`);

  let job = await readJob(launched.id);
  while (job && job.status === "running") {
    await sleep(150);
    job = await readJob(launched.id);
  }
  console.log(`  ended in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${job?.status}, ${job?.succeeded} ok/warn, ${job?.failed} failed`);
  const items = await prisma.jobRunItem.findMany({ where: { runId: launched.id }, orderBy: { seq: "asc" } });
  for (const i of items) console.log(`    ${i.name.padEnd(10)} ${i.outcome.padEnd(5)} ${i.detail}`);
  const line = (term: string) => items.find((i) => i.name === term);

  check("every run was started then checked — none through the one-call endpoint", syncCalls === 0 && startTimeouts.length === 4);
  check("the actor's own timeout is 15 minutes on every run", startTimeouts.every((t) => t === "900"), startTimeouts.join(","));
  check("contact scraping still on", startInputs.every((i) => i.scrapeContacts === true));

  check("the slow run was followed to the end", line("slow")?.outcome === "ok" && line("slow")?.detail === "3 clinics found", line("slow")?.detail);
  check(
    "a run that timed out kept its partial results and says how many",
    line("partial")?.outcome === "warn" && /Timed out on Apify after 15m 00s — kept the 2 clinics it collected/.test(line("partial")!.detail),
    line("partial")?.detail,
  );
  check(
    "a run that timed out with nothing says it timed out, and for how long",
    line("empty")?.outcome === "error" && /timed out on Apify after 15m 00s/.test(line("empty")!.detail) && !/input/i.test(line("empty")!.detail),
    line("empty")?.detail,
  );
  check(
    "a real input error says Apify rejected the input, with Apify's reason",
    line("bad input")?.outcome === "error" &&
      /Apify rejected the input/.test(line("bad input")!.detail) &&
      /maxCrawledPlacesPerSearch must be >= 1/.test(line("bad input")!.detail),
    line("bad input")?.detail,
  );
  check("the run finished rather than stopping on the failures", job?.status === "finished");

  console.log("\nThe results, read back as the page reads them");
  const results = (await readJobResults(launched.id)).map((r) => r.result as ClinicTermResult);
  const outcome = combineClinicTermResults(results);
  check("five clinics to import: three from the slow run, two kept from the timed-out one", outcome.clinics.length === 5, String(outcome.clinics.length));
  check("each term's line carries its count and whether it timed out",
    JSON.stringify(outcome.perTerm.map((t) => [t.term, t.found, t.timedOut])) ===
      JSON.stringify([["slow", 3, false], ["partial", 2, true], ["empty", 0, true], ["bad input", 0, false]]),
    JSON.stringify(outcome.perTerm));
  check("the actor used rides along for the import", outcome.actorId === "compass~crawler-google-places");
  const imported = await importClinicDiscoveryCandidates({ clinics: JSON.parse(JSON.stringify(outcome.clinics)), actorId: outcome.actorId ?? undefined });
  check("they import like any search's results, emails and all", imported.created === 5 &&
    (await prisma.discoveryCandidate.count({ where: { clinicName: { startsWith: TAG }, emailSource: "maps_contacts" } })) === 5);

  console.log("\nThe error wording on the one-call run");
  const sync = await runApifySync({ kind: "actor", id: "compass~crawler-google-places", input: "{}" });
  check(
    "Apify's 'did not succeed (status: TIMED-OUT)' reads as a timeout, not a rejected input",
    !sync.ok && /timed out/i.test(sync.error) && !/rejected|would not accept/i.test(sync.error),
    sync.ok ? "ok?" : sync.error,
  );

  await prisma.discoveryCandidate.deleteMany({ where: { clinicName: { startsWith: TAG } } });
  await savePipelineSettings(before);
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
