// Email checks through Instantly, against a local mock of its API built from
// Instantly's published spec (tools/fixtures/instantly-email-verification.openapi.json).
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-instantly.ts
//
// The mock serves only the two email-verification paths the spec has, checks
// every request body against the spec's request schema and every answer
// against its EmailVerification schema, and records any other call — so the
// test can show nothing else in Instantly is ever touched. It answers by
// address: verified, catch-all, pending then verified, invalid; and by key:
// a workspace with no paid plan (402) and a revoked key (401).

import fs from "node:fs";
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

// ─── The mock, from the spec ───────────────────────────────────────────────

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; enum?: unknown[] };
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/instantly-email-verification.openapi.json"), "utf8"));
const POST_PATH = "/api/v2/email-verification";
const GET_PATH = "/api/v2/email-verification/{email}";
const requestSchema: Schema = spec.paths[POST_PATH].post.requestBody.content["application/json"].schema;
const verificationSchema: Schema = spec.components.schemas.EmailVerification;
const errorSchema = (status: number): Schema => spec.paths[POST_PATH].post.responses[String(status)].content["application/json"].schema;

// Enough of JSON Schema for these schemas: types, required, enum, no extras.
function conforms(value: unknown, schema: Schema, where: string, problems: string[]): void {
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const t = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (types.length > 0 && !types.includes(t)) problems.push(`${where}: ${t} is not ${types.join("|")}`);
  if (schema.enum && value !== null && !schema.enum.includes(value)) problems.push(`${where}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if (t === "object" && schema.properties) {
    const o = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in o)) problems.push(`${where}: missing ${k}`);
    for (const [k, v] of Object.entries(o)) {
      if (schema.properties[k]) conforms(v, schema.properties[k], `${where}.${k}`, problems);
      else if (schema.additionalProperties === false) problems.push(`${where}: ${k} is not in the spec`);
    }
  }
}

const problems: string[] = [];
const outOfSpec: string[] = [];
const calls: string[] = [];
const polls: Record<string, number> = {};

function verification(email: string, status: "pending" | "verified" | "invalid", catchAll: boolean | "pending", creditsUsed: number | null) {
  return { status: "success", email, verification_status: status, catch_all: catchAll, credits: 99, credits_used: creditsUsed };
}

function answerFor(email: string, polling: boolean) {
  const local = email.split("@")[0];
  if (local.startsWith("pending")) {
    // Pending on the POST and the first poll, then verified.
    polls[email] = (polls[email] ?? 0) + (polling ? 1 : 0);
    return polls[email] < 2 ? verification(email, "pending", "pending", polling ? null : 0.25) : verification(email, "verified", false, null);
  }
  if (local.startsWith("invalid")) return verification(email, "invalid", false, 0.25);
  if (local.startsWith("catchall")) return verification(email, "verified", true, 0.25);
  return verification(email, "verified", false, 0.25);
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://x");
    const send = (status: number, payload: unknown, schema: Schema) => {
      conforms(payload, schema, `${req.method} ${url.pathname} → ${status}`, problems);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const isPost = req.method === "POST" && url.pathname === POST_PATH;
    const getMatch = req.method === "GET" ? url.pathname.match(/^\/api\/v2\/email-verification\/([^/]+)$/) : null;
    if (!isPost && !getMatch) {
      outOfSpec.push(`${req.method} ${url.pathname}`);
      return send(404, { statusCode: 404, error: "Not Found", message: "Resource not found" }, errorSchema(404));
    }
    calls.push(`${req.method} ${url.pathname}`);
    const auth = req.headers.authorization ?? "";
    if (auth === "Bearer revoked") return send(401, { statusCode: 401, error: "Unauthorized", message: "Invalid API key" }, errorSchema(401));
    if (auth === "Bearer no-plan") return send(402, { statusCode: 402, error: "Payment Required", message: "Workspace does not have an active paid plan" }, errorSchema(402));
    if (isPost) {
      const parsed = JSON.parse(body || "{}");
      conforms(parsed, requestSchema, "POST body", problems);
      return send(200, answerFor(parsed.email, false), verificationSchema);
    }
    return send(200, answerFor(decodeURIComponent(getMatch![1]), true), verificationSchema);
  });
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.INSTANTLY_API_BASE = `http://127.0.0.1:${port}`;
  process.env.INSTANTLY_POLL_MS = "50";
  process.env.INSTANTLY_API_KEY = "test-key";

  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  const { startEmailCheckJob, autoCheckEmails } = await import("../src/lib/actions/jobs");
  const { readJob, readJobResults } = await import("../src/lib/jobRunner");
  const { creditsUsedThisMonth } = await import("../src/lib/emailCheckRun");
  const { loadEmailSettings, saveEmailSettingsRow } = await import("../src/lib/emailSettingsStore");
  const { mapVerification } = await import("../src/lib/emailCheck");
  const { parseAlternates } = await import("../src/lib/emailFind");

  const TAG = "(instantly verify)";
  await prisma.jobRunItem.deleteMany({ where: { run: { source: "email-check" } } });
  await prisma.jobRun.deleteMany({ where: { source: "email-check" } });
  await prisma.emailCheck.deleteMany();
  await prisma.appSecrets.deleteMany();
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: TAG } } });
  await prisma.lead.updateMany({ where: { channel: "email" }, data: { channel: "linkedin" } }); // only this script's leads on email
  await saveEmailSettingsRow({ ...(await loadEmailSettings()), checkCreditBudget: 150, creditsPerCheck: 1 });

  const seed = (name: string, email: string, extra: Record<string, unknown> = {}) =>
    prisma.lead.create({ data: { clinicName: `${name} ${TAG}`, stage: "NEW", channel: "email", email, emailSource: "maps_contacts", emailType: "generic", ...extra } });
  const valid = await seed("Valid Spine", "info@validspine.test");
  const catchAll = await seed("Catch-All Clinic", "catchall@everything.test");
  const pending = await seed("Slow Server Clinic", "pending@slowserver.test");
  const invalid = await seed("Invalid Clinic", "invalid@badclinic.test");
  const manual = await seed("Typed In Clinic", "invalid.typed@typed.test", { emailSource: "manual" });

  const runJob = async (args: Parameters<typeof startEmailCheckJob>[0]) => {
    const started = await startEmailCheckJob(args);
    if (!started.ok) return { started, job: null, items: [] as { name: string; result: unknown }[] };
    let job = await readJob(started.id);
    while (job && job.status === "running") {
      await sleep(50);
      job = await readJob(started.id);
    }
    return { started, job, items: await readJobResults(started.id) };
  };
  const lead = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });

  console.log("\nThe mapping");
  check("verified → valid; verified catch-all → risky; invalid → invalid; pending → unknown",
    mapVerification({ verificationStatus: "verified", catchAll: false }) === "valid" &&
      mapVerification({ verificationStatus: "verified", catchAll: true }) === "risky" &&
      mapVerification({ verificationStatus: "invalid", catchAll: false }) === "invalid" &&
      mapVerification({ verificationStatus: "pending", catchAll: "pending" }) === "unknown");

  console.log("\nCheck all unchecked, against the mock");
  const first = await runJob({});
  check("the job ran in the shared runner and finished", first.started.ok && first.job?.status === "finished" && first.job.kind === "email-check" && first.job.done === 5,
    JSON.stringify(first.started));
  check("verified → valid", (await lead(valid.id)).emailStatus === "valid" && (await lead(valid.id)).emailCheckedAt !== null);
  check("catch-all → risky", (await lead(catchAll.id)).emailStatus === "risky");
  check("pending was polled until it finished, then valid", (await lead(pending.id)).emailStatus === "valid" &&
    calls.filter((c) => c.startsWith("GET /api/v2/email-verification/pending")).length >= 2, `${calls.filter((c) => c.startsWith("GET")).length} polls`);
  const inv = await lead(invalid.id);
  check("invalid → moved to alternates, back to No email", inv.email === null && parseAlternates(inv.emailAlternates).some((a) => a.address === "invalid@badclinic.test" && a.status === "invalid"));
  const man = await lead(manual.id);
  check("an invalid address typed in by hand is marked invalid but never moved or replaced", man.email === "invalid.typed@typed.test" && man.emailStatus === "invalid");

  console.log("\nCredits");
  const settings = await loadEmailSettings();
  check("credits per check corrected from credits_used (1 → 0.25)", settings.creditsPerCheck === 0.25, String(settings.creditsPerCheck));
  check("credits used this month: 5 checks × 0.25 = 1.25", (await creditsUsedThisMonth()) === 1.25, String(await creditsUsedThisMonth()));
  check("every check is logged with what Instantly said", (await prisma.emailCheck.count()) === 5 &&
    (await prisma.emailCheck.findFirstOrThrow({ where: { email: "catchall@everything.test" } })).catchAll === "true");

  console.log("\nEach address once");
  const again = await runJob({});
  check("a second Check all checks nothing", !again.started.ok && /Nothing to check/.test(again.started.ok ? "" : again.started.error) && (await prisma.emailCheck.count()) === 5);
  const notForced = await runJob({ leadIds: [valid.id] });
  check("nor does Check email on a checked lead", !notForced.started.ok);
  const forced = await runJob({ leadIds: [valid.id], force: true });
  check("Check again re-checks it", forced.job?.status === "finished" && (await prisma.emailCheck.count({ where: { email: "info@validspine.test" } })) === 2);

  console.log("\nThe budget");
  await saveEmailSettingsRow({ ...(await loadEmailSettings()), checkCreditBudget: 2 });
  const extra = await Promise.all([1, 2, 3, 4].map((i) => seed(`Budget Clinic ${i}`, `info@budget${i}.test`)));
  // 1.5 used of 2: 0.5 left = 2 checks at 0.25; 4 unchecked need 1.
  const refused = await runJob({});
  check("a job that would go over the budget is refused, saying how many fit",
    !refused.started.ok && /needs 1 credits and 0\.5 are left of this month's 2 — 2 checks would fit/.test(refused.started.ok ? "" : refused.started.error),
    refused.started.ok ? "started?" : refused.started.error);
  check("and checked nothing", (await prisma.emailCheck.count()) === 6);
  await autoCheckEmails();
  let auto = await prisma.jobRun.findFirst({ where: { source: "email-check" }, orderBy: { startedAt: "desc" } });
  while (auto?.status === "running") {
    await sleep(50);
    auto = await prisma.jobRun.findFirst({ where: { source: "email-check" }, orderBy: { startedAt: "desc" } });
  }
  const checkedExtra = (await prisma.lead.findMany({ where: { id: { in: extra.map((e) => e.id) } } })).filter((l) => l.emailStatus !== null).length;
  check("the automatic check takes as many as fit (2), and leaves the rest", checkedExtra === 2 && (await creditsUsedThisMonth()) === 2, `${checkedExtra} checked`);
  await autoCheckEmails();
  check("with the budget used up it does not start", (await prisma.emailCheck.count()) === 8);

  console.log("\nNo API access");
  await saveEmailSettingsRow({ ...(await loadEmailSettings()), checkCreditBudget: 150 });
  process.env.INSTANTLY_API_KEY = "no-plan";
  const noPlan = await runJob({});
  const noPlanItem = noPlan.items[0];
  check("a plan without API access says so, and the run stops",
    noPlan.job?.status === "stopped" && /plan doesn't allow API access/.test(noPlan.job.note ?? "") && noPlan.job.done === 1, noPlan.job?.note ?? JSON.stringify(noPlanItem));
  check("and nothing on the lead changes", (await prisma.lead.count({ where: { id: { in: extra.map((e) => e.id) }, emailStatus: null } })) === 2);
  process.env.INSTANTLY_API_KEY = "revoked";
  const revoked = await runJob({});
  check("a revoked key says so", revoked.job?.status === "stopped" && /refused the API key/.test(revoked.job.note ?? ""));
  delete process.env.INSTANTLY_API_KEY;
  const noKey = await runJob({});
  check("no key at all: refused before anything runs", !noKey.started.ok && /No Instantly API key/.test(noKey.started.ok ? "" : noKey.started.error));

  console.log("\nNothing but email verification");
  check("every call was to the spec's email-verification paths", outOfSpec.length === 0, outOfSpec.join(", "));
  check("every request and answer matched Instantly's spec", problems.length === 0, problems.slice(0, 3).join("; "));
  const client = fs.readFileSync(path.join(__dirname, "../src/lib/instantly.ts"), "utf8");
  check("the client has no campaign, lead or send endpoint in it", !/\/api\/v2\/(campaigns?|leads?|lead-lists|emails|accounts)/.test(client));

  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: TAG } } });
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
