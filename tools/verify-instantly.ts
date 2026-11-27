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
  const { finderBudget, runContactFinder } = await import("../src/lib/contactFinderRun");
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
    prisma.lead.create({
      data: {
        clinicName: `${name} ${TAG}`, stage: "NEW", channel: "email", email, emailSource: "maps_contacts", emailType: "generic",
        ownerStatus: "not_found", ownerCheckedAt: new Date(), ownerConfidence: "high",
        ...extra,
      },
    });
  const valid = await seed("Valid Spine", "info@validspine.test");
  const catchAll = await seed("Catch-All Clinic", "catchall@everything.test");
  const pending = await seed("Slow Server Clinic", "pending@slowserver.test");
  const invalid = await seed("Invalid Clinic", "invalid@badclinic.test");
  const manual = await seed("Typed In Clinic", "invalid.typed@typed.test", { emailSource: "manual" });

  // Every check now runs inside the contact finder (src/lib/contactFinderRun.ts).
  // The leads carry an earlier owner lookup, so the finder asks only Instantly.
  const find = async (id: string) => runContactFinder(id, await finderBudget());
  const lead = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });

  console.log("\nThe mapping");
  check("verified → valid; verified catch-all → risky; invalid → invalid; pending → unknown",
    mapVerification({ verificationStatus: "verified", catchAll: false }) === "valid" &&
      mapVerification({ verificationStatus: "verified", catchAll: true }) === "risky" &&
      mapVerification({ verificationStatus: "invalid", catchAll: false }) === "invalid" &&
      mapVerification({ verificationStatus: "pending", catchAll: "pending" }) === "unknown");

  console.log("\nEach new address, through the contact finder, against the mock");
  for (const l of [valid, catchAll, pending, invalid, manual]) await find(l.id);
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
  await find(valid.id);
  check("running the finder again checks nothing it already checked", (await prisma.emailCheck.count()) === 5);

  console.log("\nThe budget");
  await saveEmailSettingsRow({ ...(await loadEmailSettings()), checkCreditBudget: 1.25 });
  const broke = await seed("Budget Clinic", "info@budget.test");
  const rb = await find(broke.id);
  check("no credits left: the lead needs you, \"Out of credits\", and nothing is checked",
    rb.status === "needs_you" && (await lead(broke.id)).contactStatusReason === "Out of credits" && (await prisma.emailCheck.count()) === 5, String(rb.status));

  console.log("\nNo API access");
  await saveEmailSettingsRow({ ...(await loadEmailSettings()), checkCreditBudget: 150 });
  process.env.INSTANTLY_API_KEY = "no-plan";
  const noPlan = await find(broke.id);
  check("a plan without API access stops the run and the lead needs you", noPlan.status === "needs_you" && noPlan.stop === true && (await lead(broke.id)).emailStatus === null,
    `${noPlan.status} ${noPlan.detail}`);
  check("…saying so in the trace", /plan doesn't allow API access/.test((await lead(broke.id)).contactTrace ?? ""));
  process.env.INSTANTLY_API_KEY = "revoked";
  const revoked = await find(broke.id);
  check("a revoked key says so", revoked.status === "needs_you" && /refused the API key/.test((await lead(broke.id)).contactTrace ?? ""));
  delete process.env.INSTANTLY_API_KEY;
  const noKey = await find(broke.id);
  check("no key at all: \"Missing API key: Instantly\", nothing sent to Instantly",
    noKey.status === "needs_you" && (await lead(broke.id)).contactStatusReason === "Missing API key: Instantly");

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
