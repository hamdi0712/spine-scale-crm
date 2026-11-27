// The contact finder, end to end, against local stand-ins for every API it
// calls — the NPI Registry, Hunter, Instantly and DeepSeek. Nothing is spent
// and nothing leaves this process.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-contact-finder.ts
//
// Covers: one doctor; several doctors picked by AI (high, low, a quote not
// in the evidence, DeepSeek down); no doctor with a front desk; Hunter's
// owner address; risky found (accepted) and inferred (not); unknown retried
// then risky; contact form; call; out of credits and cleared; a step failing
// once then twice; hand-set data never overwritten; Look up again asking
// first; the low-confidence greeting; the lock after sending; no upgrade once
// approved; the risky send limit and a bounce with auto-accepted addresses;
// LinkedIn leads untouched; the timer starting once; and the one-time
// migration keeping every lead in place (and refusing when one would move).

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

// ─── The stand-ins ─────────────────────────────────────────────────────────

interface NpiOrg { name: string; phone: string; city: string; state: string; prefix: string; first: string; last: string; title: string }
const npiOrgs: NpiOrg[] = [];
// Hunter's Email Finder by domain: an address and its provenance, "fail" for a 500, absent for none.
const hunterFinds = new Map<string, { email: string; provenance: "found" | "inferred" } | "fail">();
const hunterCalls: string[] = [];
// DeepSeek's next answers, in order: an object (the reply) or "fail" (HTTP 500).
const aiReplies: (Record<string, unknown> | "fail")[] = [];
let aiCalls = 0;
const instantlyCalls: string[] = [];

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://x");
    // NPI Registry: organisations whose name starts with the query.
    if (url.pathname === "/api/") {
      const q = (url.searchParams.get("organization_name") ?? "").replace(/\*$/, "").toUpperCase();
      const results = npiOrgs
        .filter((o) => o.name.toUpperCase().startsWith(q))
        .map((o, i) => ({
          number: String(1000000000 + i),
          basic: {
            organization_name: o.name,
            authorized_official_name_prefix: o.prefix,
            authorized_official_first_name: o.first,
            authorized_official_last_name: o.last,
            authorized_official_title_or_position: o.title,
          },
          addresses: [{ address_purpose: "LOCATION", city: o.city, state: o.state, telephone_number: o.phone }],
        }));
      return json(res, 200, { result_count: results.length, results });
    }
    // Hunter.
    if (url.pathname === "/v2/email-finder") {
      const domain = url.searchParams.get("domain") ?? "";
      hunterCalls.push(domain);
      const f = hunterFinds.get(domain);
      if (f === "fail") return json(res, 500, { errors: [{ details: "stand-in failure" }] });
      if (!f) return json(res, 200, { data: { email: null } }, { "x-credits-used": "0" });
      return json(res, 200, { data: { email: f.email, score: 90, provenance: f.provenance, verification: { status: "valid" } } }, { "x-credits-used": "1" });
    }
    if (url.pathname === "/v2/domain-search") return json(res, 200, { data: { pattern: null, emails: [] } }, { "x-credits-used": "1" });
    // Instantly: by the address's local part.
    if (url.pathname.startsWith("/api/v2/email-verification")) {
      const email = req.method === "POST" ? (JSON.parse(body || "{}").email as string) : decodeURIComponent(url.pathname.split("/").pop() ?? "");
      instantlyCalls.push(email);
      const local = email.split("@")[0];
      const answer = (status: string, catchAll: boolean | string) =>
        json(res, 200, { status: "success", email, verification_status: status, catch_all: catchAll, credits: 99, credits_used: req.method === "POST" ? 1 : null });
      if (local.startsWith("slow")) return answer("pending", "pending");
      if (local.startsWith("bad")) return answer("invalid", false);
      if (local.startsWith("risky")) return answer("verified", true);
      return answer("verified", false);
    }
    // DeepSeek.
    if (url.pathname === "/chat/completions") {
      aiCalls++;
      const next = aiReplies.shift();
      if (next === undefined || next === "fail") return json(res, 500, { error: { message: "stand-in failure" } });
      return json(res, 200, { choices: [{ message: { content: JSON.stringify(next) }, finish_reason: "stop" }] });
    }
    json(res, 404, {});
  });
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  Object.assign(process.env, {
    NPI_API_BASE: base,
    HUNTER_API_BASE: base,
    HUNTER_API_KEY: "hunter-test-key",
    INSTANTLY_API_BASE: base,
    INSTANTLY_API_KEY: "instantly-test-key",
    INSTANTLY_POLL_MS: "20",
    INSTANTLY_MAX_WAIT_MS: "100",
    DEEPSEEK_API_URL: `${base}/chat/completions`,
    DEEPSEEK_API_KEY: "deepseek-test-key",
    DEEPSEEK_RETRY_MS: "10",
  });
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }

  const { prisma } = await import("../src/lib/prisma");
  const wf = await import("../src/lib/emailWorkflow");
  const cf = await import("../src/lib/contactFinder");
  const run = await import("../src/lib/contactFinderRun");
  const jobs = await import("../src/lib/actions/jobs");
  const act = await import("../src/lib/actions/emailWorkflow");
  const { loadEmailSettings, saveEmailSettingsRow } = await import("../src/lib/emailSettingsStore");
  const { loadActiveIcp } = await import("../src/lib/icpDefinitionStore");
  const { buildBreakdownV2, finish } = await import("../src/lib/icpScoring");
  const { emailBucket, legacyEmailBucket } = await import("../src/lib/emailBuckets");
  const { bucketExtras, loadEmailQueue } = await import("../src/lib/emailBucketsRead");
  const { emailPanelProps } = await import("../src/lib/emailWorkflowRead");
  const { sentTodayByInbox } = await import("../src/lib/emailInboxes");
  const { parseAlternates } = await import("../src/lib/emailFind");
  const { migrateContactStatus, CONTACT_STATUS_MIGRATION, sqliteFile } = await import("../src/lib/dataMigrations");
  const { startContactFinderTimer, contactFinderTimerRunning } = await import("../src/lib/contactFinderTimer");

  const TAG = "(finder verify)";
  await prisma.jobRunItem.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.emailCheck.deleteMany();
  await prisma.hunterCall.deleteMany();
  await prisma.emailSend.deleteMany();
  await prisma.appSecrets.deleteMany();
  await prisma.dataMigration.deleteMany();
  await prisma.lead.updateMany({ data: { sendingInboxId: null } });
  await prisma.sendingInbox.deleteMany();
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: TAG } } });
  // Only this script's leads on email.
  await prisma.lead.updateMany({ where: { channel: "email" }, data: { channel: "linkedin" } });
  await prisma.emailSettings.deleteMany();
  await prisma.emailSettings.create({ data: { id: wf.EMAIL_SETTINGS_ID, ...wf.emailSettingsRow({ ...wf.DEFAULT_EMAIL_SETTINGS, senderName: "Hamdi" }) } });
  const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261107120000_email_playbook/migration.sql"), "utf8");
  await prisma.$executeRawUnsafe(sql.slice(sql.indexOf("UPDATE")));
  const setBudgets = async (instantly: number, hunter: number) =>
    saveEmailSettingsRow({ ...(await loadEmailSettings()), checkCreditBudget: instantly, hunterCreditBudget: hunter, creditsPerCheck: 1, guessOwnerPatterns: false });
  await setBudgets(1000, 1000);
  await prisma.sendingInbox.create({ data: { address: "hamdi@spinescale.co", displayName: "Hamdi", dailyLimit: 20, position: 0 } });

  const icp = (await loadActiveIcp())!;
  const card = (clinic: string) => {
    const b = buildBreakdownV2({
      icp,
      evidence: { clinicName: clinic, websiteNotes: "Spinal decompression.", websiteUrl: null, metaAdsSignal: null, reviewCount: 40 } as never,
      reply: null, precheck: null, threshold: 60, evidenceLabels: [], notes: [], now: new Date(),
    });
    const cite = [{ quote: "We offer spinal decompression on the DRX9000.", source: "Clinic website" }];
    return JSON.stringify(finish({ ...b, fit: b.fit.map((e) => ({ ...e, points: e.max, citations: cite, source: "assist" as const, shortfall: null, ...(e.key === "title" ? { reason: "Nobody named.", points: 0 } : {}) })), signals: b.signals.map((e) => ({ ...e, points: e.max, shortfall: null })) }, 60));
  };
  let phoneN = 100;
  const seed = async (name: string, data: Record<string, unknown> = {}) => {
    const slug = name.toLowerCase().replace(/[^a-z]/g, "");
    const clinicName = `${name} ${TAG}`;
    return prisma.lead.create({
      data: {
        clinicName, stage: "NEW", channel: "email", contactStatus: "finding", reviewCount: 40,
        location: "Charleston, SC", phone: `(843) 555-0${phoneN++}`, websiteUrl: `https://${slug}.test`,
        websiteNotes: "We offer spinal decompression on the DRX9000. Call to book.", icpBreakdown: card(clinicName),
        ...data,
      },
    });
  };
  const lead = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id }, include: { emailSends: true } });
  const budget = () => run.finderBudget();
  const go = async (id: string, opts: { mode?: "apply" | "propose"; now?: Date } = {}) => run.runContactFinder(id, await budget(), opts);
  const trace = async (id: string) => cf.parseTrace((await lead(id)).contactTrace);
  const line = async (id: string) => {
    const l = await lead(id);
    return cf.traceLine(cf.parseTrace(l.contactTrace), cf.readContactStatus(l.contactStatus), l.contactStatusReason) ?? "";
  };
  const waitForFinder = async () => {
    for (let i = 0; i < 400; i++) {
      await sleep(50);
      if ((await prisma.jobRun.count({ where: { source: "contact-finder", status: "running" } })) === 0) {
        await sleep(150);
        if ((await prisma.jobRun.count({ where: { source: "contact-finder", status: "running" } })) === 0) return;
      }
    }
    throw new Error("The contact finder never finished.");
  };

  // ─── The owner ───────────────────────────────────────────────────────────
  console.log("\nOne doctor");
  const one = await seed("Lee Spine Center", {
    websiteNotes: "Meet Dr. Ann Lee, our chiropractor. We offer spinal decompression.",
    email: "drlee@leespinecenter.test", emailType: "owner", emailSource: "maps_contacts",
  });
  const aiBefore = aiCalls;
  const r1 = await go(one.id);
  const l1 = await lead(one.id);
  check("the only doctor is the owner, high confidence", l1.contactName === "Dr. Ann Lee" && l1.ownerConfidence === "high", `${l1.contactName} ${l1.ownerConfidence}`);
  check("no DeepSeek call for one candidate", aiCalls === aiBefore);
  check("the owner address checks valid → Owner email", r1.status === "owner_email" && l1.contactStatus === "owner_email" && l1.emailStatus === "valid", String(r1.status));
  check("Hunter is not asked when an owner address is on file", !hunterCalls.includes("leespinecenter.test"));
  check("the trace reads as one line", /Maps: drlee@leespinecenter\.test/.test(await line(one.id)) && /Instantly: drlee@leespinecenter\.test valid → Owner email$/.test(await line(one.id)), await line(one.id));

  console.log("\nSeveral doctors: the AI picks");
  const several = (name: string, notes: string) => {
    npiOrgs.push({ name: `${name} LLC`, phone: `84355501${phoneN}`, city: "Charleston", state: "SC", prefix: "Dr.", first: "Mark", last: "Stone", title: "Owner" });
    return seed(name, { websiteNotes: notes, phone: `(843) 555-01${phoneN}` });
  };
  const multiNotes = "Our team: Dr. Ann Lee founded the clinic in 2004. Dr. Bob Park joined in 2015. We offer spinal decompression.";
  const high = await several("Harbor Back Clinic", multiNotes);
  aiReplies.push({ pick: "Dr. Ann Lee", confidence: "high", reason: "Rule 2: founder wording next to her name.", quote: "Dr. Ann Lee founded the clinic in 2004" });
  const aiH = aiCalls;
  await go(high.id);
  const lh = await lead(high.id);
  const pickEntry = (await trace(high.id)).find((e) => / \(AI, /.test(e.result));
  check("NPI and the site disagree: DeepSeek is asked once", aiCalls === aiH + 1, `${aiCalls - aiH} calls`);
  check("its pick, high confidence, becomes the contact", lh.contactName === "Dr. Ann Lee" && lh.ownerConfidence === "high", `${lh.contactName} ${lh.ownerConfidence}`);
  check("the trace keeps DeepSeek's quote and reason", pickEntry?.quote === "Dr. Ann Lee founded the clinic in 2004" && /founder/.test(pickEntry?.reason ?? ""), JSON.stringify(pickEntry));
  check("and its cost", /DeepSeek/.test(pickEntry?.cost ?? ""));

  const low = await several("Bay Chiropractic Group", multiNotes);
  aiReplies.push({ pick: "Dr. Bob Park", confidence: "low", reason: "Rule 4: nothing better.", quote: "Dr. Bob Park joined in 2015" });
  const hunterBeforeLow = hunterCalls.length;
  await go(low.id);
  const ll = await lead(low.id);
  check("a low-confidence pick: the lead still moves on", ll.contactName === "Dr. Bob Park" && ll.ownerConfidence === "low" && ll.contactStatus !== "finding", `${ll.contactStatus}`);
  check("and Hunter is not asked for an owner nobody is sure of", hunterCalls.length === hunterBeforeLow);

  const madeUp = await several("Cove Spine Care", multiNotes);
  aiReplies.push({ pick: "Dr. Bob Park", confidence: "high", reason: "Rule 2.", quote: "Dr. Bob Park is the owner and founder" });
  await go(madeUp.id);
  check("a quote that is not in the evidence: downgraded to low", (await lead(madeUp.id)).ownerConfidence === "low");

  const down = await several("Dune Wellness Spine", multiNotes);
  aiReplies.push("fail", "fail", "fail", "fail");
  await go(down.id);
  const ld = await lead(down.id);
  check("DeepSeek down twice: the same priorities by code, low", ld.contactName === "Dr. Ann Lee" && ld.ownerConfidence === "low", `${ld.contactName} ${ld.ownerConfidence}`);
  check("…and the trace says why", (await trace(down.id)).some((e) => /rule, low — AI failed twice/.test(e.result)));
  aiReplies.length = 0;

  // ─── Addresses and routes ────────────────────────────────────────────────
  console.log("\nRoutes");
  const desk = await seed("Front Desk Spine", { email: "info@frontdeskspine.test", emailType: "generic", emailSource: "maps_contacts" });
  const rd = await go(desk.id);
  check("no doctor + a valid front-desk address → Front desk", rd.status === "front_desk" && (await lead(desk.id)).ownerStatus === "not_found", String(rd.status));

  const hunted = await seed("Ross Chiropractic", {
    websiteNotes: "Dr. Kate Ross treats every patient herself. Spinal decompression.",
    email: "info@rosschiropractic.test", emailType: "generic", emailSource: "maps_contacts",
  });
  hunterFinds.set("rosschiropractic.test", { email: "kate@rosschiropractic.test", provenance: "found" });
  const rh = await go(hunted.id);
  const lhu = await lead(hunted.id);
  check("Hunter finds the owner's own address → Owner email", rh.status === "owner_email" && lhu.email === "kate@rosschiropractic.test" && lhu.emailType === "owner", `${rh.status} ${lhu.email}`);
  check("the front desk is kept as an alternate", parseAlternates(lhu.emailAlternates).some((a) => a.address === "info@rosschiropractic.test"));
  check("Hunter's credit is in the trace", (await trace(hunted.id)).some((e) => e.step === "Hunter" && /Hunter credit/.test(e.cost ?? "")));

  const riskyFound = await seed("Catchall Spine", { websiteUrl: "https://catchallspine.test", email: "riskyinfo@catchallspine.test", emailType: "generic", emailSource: "maps_contacts" });
  const rrf = await go(riskyFound.id);
  const lrf = await lead(riskyFound.id);
  check("risky, found on the clinic's own domain → accepted automatically → Front desk", rrf.status === "front_desk" && lrf.emailRiskyAcceptedAt !== null && lrf.emailRiskyAcceptedEmail === "riskyinfo@catchallspine.test", String(rrf.status));
  check("…logged as auto-accepted", (await prisma.activityLog.count({ where: { leadId: riskyFound.id, kind: "EMAIL_RISKY_ACCEPTED", summary: { startsWith: "Auto-accepted" } } })) === 1);

  const riskyElsewhere = await seed("Elsewhere Spine", { email: "riskydesk@webdesigner.test", emailType: "generic", emailSource: "maps_contacts" });
  const rre = await go(riskyElsewhere.id);
  check("risky on somebody else's domain is not accepted", rre.status === "call" && (await lead(riskyElsewhere.id)).emailRiskyAcceptedAt === null, String(rre.status));

  const inferred = await seed("Moss Spine", { websiteNotes: "Dr. Tom Moss, chiropractor. Spinal decompression." });
  hunterFinds.set("mossspine.test", { email: "riskytom@mossspine.test", provenance: "inferred" });
  const rin = await go(inferred.id);
  const lin = await lead(inferred.id);
  check("risky, Hunter-inferred: never accepted", lin.emailRiskyAcceptedAt === null && rin.status === "call", `${rin.status}`);
  check("…kept as an alternate, not made the lead's email", lin.email === null && parseAlternates(lin.emailAlternates).some((a) => a.address === "riskytom@mossspine.test" && a.status === "risky"));

  console.log("\nUnknown: retried once, then risky");
  const slow = await seed("Slow Server Spine", { email: "slowdesk@slowserverspine.test", emailType: "generic", emailSource: "maps_contacts" });
  const t0 = new Date();
  const rs1 = await go(slow.id, { now: t0 });
  const ls1 = await lead(slow.id);
  check("unknown, and nothing else to route on: waits (finding), retry booked in 24h",
    rs1.status === "finding" && ls1.emailStatus === "unknown" && ls1.contactRetryAt !== null && Math.abs(ls1.contactRetryAt.getTime() - t0.getTime() - cf.UNKNOWN_RETRY_MS) < 2000, `${rs1.status}`);
  check("not due an hour later", !(await run.finderDueLeads(new Date(t0.getTime() + 3_600_000))).some((l) => l.id === slow.id));
  check("due a day later", (await run.finderDueLeads(new Date(t0.getTime() + cf.UNKNOWN_RETRY_MS + 60_000))).some((l) => l.id === slow.id));
  const rs2 = await go(slow.id, { now: new Date(t0.getTime() + cf.UNKNOWN_RETRY_MS + 60_000) });
  const ls2 = await lead(slow.id);
  check("unknown again: treated as risky — found on its own domain, so accepted → Front desk",
    rs2.status === "front_desk" && ls2.emailStatus === "risky" && ls2.emailRiskyAcceptedAt !== null && ls2.contactRetryAt === null, `${rs2.status} ${ls2.emailStatus}`);
  check("the address went to Instantly again on the retry", instantlyCalls.filter((e) => e === "slowdesk@slowserverspine.test").length >= 2);

  const form = await seed("Form Only Spine", {
    websiteLinks: JSON.stringify([{ text: "Contact Us", url: "https://formonlyspine.test/contact", page: "https://formonlyspine.test/" }]),
  });
  check("nothing found, the clinic has a form → Contact form", (await go(form.id)).status === "contact_form");
  check("nothing at all → Call list", (await go((await seed("Nothing Spine")).id)).status === "call");

  // ─── Needs you ───────────────────────────────────────────────────────────
  console.log("\nOut of credits, then cleared");
  const used = (await prisma.emailCheck.aggregate({ _sum: { creditsUsed: true } }))._sum.creditsUsed ?? 0;
  await setBudgets(used, 1000);
  const broke = await seed("Broke Spine", { email: "hello@brokespine.test", emailType: "generic", emailSource: "maps_contacts" });
  const rb = await go(broke.id);
  check("no Instantly credits left → Needs you, \"Out of credits\"", rb.status === "needs_you" && (await lead(broke.id)).contactStatusReason === cf.OUT_OF_CREDITS, String(rb.status));
  check("nothing was spent past the budget", !instantlyCalls.includes("hello@brokespine.test"));
  check("the Email queue lists it", (await loadEmailQueue()).queue.some((q) => q.id === broke.id && q.reason === cf.OUT_OF_CREDITS));
  check("not due while there is still no room", !(await run.finderDueLeads()).some((l) => l.id === broke.id));
  await setBudgets(1000, 1000);
  check("budget raised: it is due again", (await run.finderDueLeads()).some((l) => l.id === broke.id));
  await jobs.kickContactFinder();
  await waitForFinder();
  check("…and the automatic run clears it → Front desk", (await lead(broke.id)).contactStatus === "front_desk", String((await lead(broke.id)).contactStatus));
  await setBudgets(1000, (await prisma.hunterCall.aggregate({ _sum: { creditsUsed: true } }))._sum.creditsUsed ?? 0);
  const noHunter = await seed("Vale Spine", { websiteNotes: "Dr. Iris Vale, chiropractor. Spinal decompression." });
  check("no Hunter credits left, an owner to look up → Out of credits", (await go(noHunter.id)).status === "needs_you" && (await lead(noHunter.id)).contactStatusReason === cf.OUT_OF_CREDITS);
  await setBudgets(1000, 1000);

  console.log("\nA step failing: once, then twice; reset on success");
  const flaky = await seed("Flaky Spine", { websiteNotes: "Dr. Nina Flak, chiropractor. Spinal decompression." });
  hunterFinds.set("flakyspine.test", "fail");
  const rf1 = await go(flaky.id);
  const lf1 = await lead(flaky.id);
  check("Hunter fails once: still finding, tried again in 15 minutes", rf1.status === "finding" && cf.parseFailures(lf1.contactFailures).Hunter === 1 && lf1.contactRetryAt !== null, `${rf1.status} ${lf1.contactFailures}`);
  hunterFinds.set("flakyspine.test", { email: "nina@flakyspine.test", provenance: "found" });
  const rf2 = await go(flaky.id, { now: new Date(Date.now() + cf.FAILED_STEP_RETRY_MS + 1000) });
  check("then succeeds: routed, and the failure count for Hunter is reset", rf2.status === "owner_email" && cf.parseFailures((await lead(flaky.id)).contactFailures).Hunter === undefined, `${rf2.status} ${(await lead(flaky.id)).contactFailures}`);
  const broken = await seed("Broken Spine", { websiteNotes: "Dr. Omar Brok, chiropractor. Spinal decompression." });
  hunterFinds.set("brokenspine.test", "fail");
  await go(broken.id);
  const rbr = await go(broken.id);
  check("fails twice → Needs you, \"Step failed: Hunter\"", rbr.status === "needs_you" && (await lead(broken.id)).contactStatusReason === "Step failed: Hunter");
  hunterFinds.set("brokenspine.test", { email: "omar@brokenspine.test", provenance: "found" });
  const retried = await jobs.retryContactFinder(broken.id);
  await waitForFinder();
  check("Retry runs it again and it leaves the queue", retried.ok && (await lead(broken.id)).contactStatus === "owner_email", String((await lead(broken.id)).contactStatus));

  // ─── Hand-set data wins ──────────────────────────────────────────────────
  console.log("\nHand-set data is never overwritten");
  const hand = await seed("Hand Set Spine", {
    websiteNotes: "Dr. Ann Lee, our chiropractor. Spinal decompression.",
    contactName: "Dr. Jo Hand", contactNameByHand: true,
    email: "typed@handsetspine.test", emailType: "generic", emailSource: "manual",
    emailAlternates: JSON.stringify([{ address: "drlee@handsetspine.test", type: "owner", status: null, source: "maps_contacts" }]),
  });
  const rhand = await go(hand.id);
  const lhand = await lead(hand.id);
  check("a contact set by hand stays", lhand.contactName === "Dr. Jo Hand", String(lhand.contactName));
  check("an email typed by hand stays the email, even with a valid owner alternate", lhand.email === "typed@handsetspine.test", String(lhand.email));
  check("…and the lead routes on it", rhand.status === "front_desk", String(rhand.status));
  const machine = await seed("Machine Set Spine", { websiteNotes: "Dr. Ann Lee, our chiropractor.", contactName: "Dr. Zed Old" });
  await go(machine.id);
  check("a machine-set contact is replaced by a high-confidence owner", (await lead(machine.id)).contactName === "Dr. Ann Lee");

  console.log("\nLook up again asks first");
  await prisma.lead.update({ where: { id: machine.id }, data: { websiteNotes: "Dr. Bea Newman runs the clinic now. Spinal decompression." } });
  const before = await lead(machine.id);
  await go(machine.id, { mode: "propose" });
  const after = await lead(machine.id);
  const proposal = cf.parseProposal(after.contactProposal);
  check("a different owner: nothing replaced, a proposal stored", after.contactName === before.contactName && after.contactStatus === before.contactStatus && proposal?.owner?.found === "Dr. Bea Newman", JSON.stringify(proposal));
  check("…both shown side by side", proposal?.owner?.current === "Dr. Ann Lee");
  check("Replace puts it on the lead, as set by hand", (await run.applyProposal(machine.id)).ok && (await lead(machine.id)).contactName === "Dr. Bea Newman" && (await lead(machine.id)).contactNameByHand);
  await prisma.lead.update({ where: { id: machine.id }, data: { websiteNotes: "Dr. Cal Third, chiropractor." } });
  await go(machine.id, { mode: "propose" });
  await run.keepCurrent(machine.id);
  check("Keep leaves it as it was", (await lead(machine.id)).contactName === "Dr. Bea Newman" && (await lead(machine.id)).contactProposal === null);
  const same = await seed("Same Again Spine", { websiteNotes: "Dr. Ann Lee, our chiropractor." });
  await go(same.id);
  await go(same.id, { mode: "propose" });
  check("the same result: no proposal", (await lead(same.id)).contactProposal === null && (await trace(same.id)).some((e) => e.result === "same as on file"));

  // ─── The greeting ────────────────────────────────────────────────────────
  console.log("\nConfidence decides the greeting");
  const settings = await loadEmailSettings();
  const OPENER = "Your booking page only takes requests by form. Anyone ready to start waits to hear back.";
  const lowLead = await lead(low.id);
  const ownerLow = wf.renderEmail(settings, lowLead, "owner", OPENER);
  const deskLow = wf.renderEmail(settings, lowLead, "front_desk", OPENER);
  check("low confidence, owner email: \"Hi there,\"", ownerLow.body.startsWith("Hi there,"), ownerLow.body.split("\n")[0]);
  check("low confidence, front-desk email: \"probably for the doctor\"", /probably for the doctor/.test(deskLow.body), deskLow.body.match(/probably for [^.]*/)?.[0] ?? "");
  check("…and neither names the doctor anywhere", !/Park/.test(ownerLow.body + deskLow.body + ownerLow.subject + deskLow.subject));
  check("…nor asks you to check the contact", wf.contactValidation(lowLead).issues.length === 0 && wf.contactCheck(lowLead).state === "confirmed");
  const highLead = await lead(high.id);
  check("high confidence: \"Hi Dr. Lee,\" and \"probably for Dr. Lee\"",
    wf.renderEmail(settings, highLead, "owner", OPENER).body.startsWith("Hi Dr. Lee,") && /probably for Dr\. Lee/.test(wf.renderEmail(settings, highLead, "front_desk", OPENER).body));

  // ─── Sending: limits, bounce, the lock ───────────────────────────────────
  console.log("\nAuto-accepted risky addresses count toward the send limits");
  check("the risky limit is still 3 per inbox per day", settings.riskyDailyLimit === 3, String(settings.riskyDailyLimit));
  const twin = await seed("Catchall Spine Two", { websiteUrl: "https://catchallspine.test", email: "riskydesk@catchallspine.test", emailType: "generic", emailSource: "maps_contacts" });
  await go(twin.id);
  check("a second lead on the same catch-all domain is auto-accepted too", (await lead(twin.id)).emailRiskyAcceptedAt !== null);
  const opened = await act.saveManualOpener(riskyFound.id, OPENER);
  const approved = await act.approveEmail(riskyFound.id);
  const p = await emailPanelProps(await lead(riskyFound.id));
  check("the auto-accepted lead can be approved and is Ready, marked risky", opened.ok && approved.ok && p.status === "ready" && p.toSend?.risky === true, approved.ok ? p.status : approved.error);
  const riskyBefore = (await sentTodayByInbox(new Date(), { risky: true }))[p.toSend!.inboxId] ?? 0;
  const sent = await act.markEmailSent(riskyFound.id, { step: 0, subject: p.toSend!.subject, body: p.toSend!.body, inboxId: p.toSend!.inboxId });
  const riskyAfter = (await sentTodayByInbox(new Date(), { risky: true }))[p.toSend!.inboxId] ?? 0;
  check("its send is recorded as risky and counts toward the inbox's risky limit", sent.ok && riskyAfter === riskyBefore + 1 && (await emailPanelProps(await lead(riskyFound.id))).inboxRiskySentToday === riskyAfter);
  await act.markEmailBounced(riskyFound.id);
  check("a bounce flags the domain: the other auto-accepted lead is flagged for review", (await lead(twin.id)).emailRiskyFlaggedAt !== null);

  console.log("\nLocked once sent");
  const sentLead = await lead(riskyFound.id);
  const rl = await go(riskyFound.id);
  const ll2 = await lead(riskyFound.id);
  check("the finder changes nothing on a sent lead", rl.status === null && ll2.contactStatus === sentLead.contactStatus && ll2.email === sentLead.email && ll2.contactName === sentLead.contactName);
  check("…not even the status a bounce would have moved", ll2.contactStatus === "front_desk");
  await prisma.lead.update({ where: { id: riskyFound.id }, data: { websiteNotes: "Dr. Sam Catch owns the practice." } });
  await go(riskyFound.id, { mode: "propose" });
  const ll3 = await lead(riskyFound.id);
  check("Look up again on it only proposes", ll3.contactName === sentLead.contactName && cf.parseProposal(ll3.contactProposal)?.owner?.found === "Dr. Sam Catch");
  check("markForFinder leaves it alone", (await run.markForFinder([riskyFound.id])).length === 0);

  console.log("\nNo upgrade once approved");
  const mk = async (name: string) =>
    seed(name, {
      contactStatus: "front_desk",
      email: "desk@" + name.toLowerCase().replace(/[^a-z]/g, "") + ".test",
      emailType: "generic", emailStatus: "valid", emailSource: "maps_contacts",
      emailAlternates: JSON.stringify([{ address: "slowowner@" + name.toLowerCase().replace(/[^a-z]/g, "") + ".test", type: "owner", status: "unknown", source: "maps_contacts" }]),
      contactRetryAt: new Date(Date.now() - 60_000),
      ownerStatus: "not_found", ownerCheckedAt: new Date(), ownerConfidence: "high",
    });
  const approvedLead = await mk("Approved Spine");
  await act.saveManualOpener(approvedLead.id, OPENER);
  await prisma.lead.update({ where: { id: approvedLead.id }, data: { emailApprovedAt: new Date() } });
  const ra = await go(approvedLead.id);
  const la = await lead(approvedLead.id);
  check("approved: the owner address now usable, but the lead stays Front desk with its email", ra.status === "front_desk" && la.email === "desk@approvedspine.test", `${ra.status} ${la.email}`);
  check("…the result only in the trace", (await trace(approvedLead.id)).some((e) => /left as is \(approved\)/.test(e.result)));
  const freeLead = await mk("Unapproved Spine");
  const rfree = await go(freeLead.id);
  check("not approved: moved up to Owner email", rfree.status === "owner_email" && (await lead(freeLead.id)).email === "slowowner@unapprovedspine.test", `${rfree.status}`);

  // ─── Email leads only ────────────────────────────────────────────────────
  console.log("\nLinkedIn leads are never touched");
  const li = await prisma.lead.create({ data: { clinicName: `LinkedIn Clinic ${TAG}`, channel: "linkedin", email: "hi@linkedin.test", websiteNotes: "Dr. Ann Lee" } });
  const rli = await go(li.id);
  const lli = await lead(li.id);
  check("the finder refuses a LinkedIn lead and writes nothing", rli.status === null && lli.contactStatus === null && lli.contactTrace === null && lli.emailStatus === null);
  check("markForFinder skips it", (await run.markForFinder([li.id])).length === 0);
  check("it is never due", !(await run.finderDueLeads()).some((l) => l.id === li.id));

  console.log("\nThe hourly timer");
  process.env.NEXT_PHASE = "phase-production-build";
  check("never during next build", startContactFinderTimer() === false && !contactFinderTimerRunning());
  delete process.env.NEXT_PHASE;
  check("starts once", startContactFinderTimer() === true && contactFinderTimerRunning());
  check("…and a second start (a hot reload) does nothing", startContactFinderTimer() === false);

  // ─── The one-time migration ──────────────────────────────────────────────
  console.log("\nThe migration keeps every existing lead in place");
  const legacy = async (name: string, data: Record<string, unknown>) =>
    prisma.lead.create({ data: { clinicName: `${name} ${TAG}`, stage: "NEW", channel: "email", websiteUrl: `https://${name.toLowerCase().replace(/[^a-z]/g, "")}.test`, ...data } });
  const contactLinks = (d: string) => JSON.stringify([{ text: "Contact", url: `https://${d}.test/contact`, page: `https://${d}.test/` }]);
  const old = {
    ownerPipe: await legacy("Old Owner", { email: "drold@oldowner.test", emailType: "owner", emailStatus: "valid", ownerStatus: "confirmed", contactName: "Dr. Old" }),
    deskPipe: await legacy("Old Desk", { email: "info@olddesk.test", emailType: "generic", emailStatus: "valid", contactNameByHand: true, contactName: "Dr. Desk" }),
    form: await legacy("Old Form", { ownerStatus: "not_found", websiteLinks: contactLinks("oldform") }),
    formSent: await legacy("Old Form Sent", { ownerStatus: "not_found", websiteLinks: contactLinks("oldformsent") }),
    call: await legacy("Old Call", { ownerStatus: "not_found" }),
    queue: await legacy("Old Pick", { email: "info@oldpick.test", emailType: "generic", emailStatus: "valid", ownerStatus: "pick" }),
    sent: await legacy("Old Sent", { email: "x@oldsent.test", emailType: "generic", emailStatus: "valid" }),
    lost: await legacy("Old Lost", { stage: "LOST", ownerStatus: "not_found" }),
  };
  await prisma.activityLog.create({ data: { kind: "CONTACT_FORM_SENT", summary: "Contact form sent", leadId: old.formSent.id } });
  await prisma.emailSend.create({ data: { leadId: old.sent.id, step: 0, toEmail: "x@oldsent.test", subject: "s", body: "b", sentAt: new Date() } });
  const liOld = await prisma.lead.create({ data: { clinicName: `Old LinkedIn ${TAG}`, channel: "linkedin" } });
  const ids = Object.values(old).map((l) => l.id);
  const legacyBuckets = async () => {
    const rows = await prisma.lead.findMany({ where: { id: { in: ids } }, include: { _count: { select: { emailSends: true } } } });
    const x = await bucketExtras(rows);
    return new Map(rows.map((l) => [l.id, { legacy: legacyEmailBucket(l, x.get(l.id)!), now: emailBucket(l, x.get(l.id)!), status: l.contactStatus, reason: l.contactStatusReason }]));
  };
  const beforeM = await legacyBuckets();
  check("the seeded leads cover every old place",
    ["pipeline", "contact_form", "form_sent", "call", "queue", "hidden"].every((b) => Array.from(beforeM.values()).some((v) => v.legacy === b)), Array.from(beforeM.values()).map((v) => v.legacy).join(","));
  const dbFile = sqliteFile();
  const logs: string[] = [];
  const bad = await migrateContactStatus({ log: (l) => logs.push(l), remap: (s, id) => (id === old.deskPipe.id ? { status: "call", reason: null } : s) });
  check("a lead that would move: aborted, nothing written, no marker",
    !bad.ok && bad.mismatches.length === 1 && (await lead(old.deskPipe.id)).contactStatus === null && (await prisma.dataMigration.count()) === 0, bad.mismatches.join("; "));
  check("…and the mismatch is logged", logs.some((l) => /ABORTED/.test(l)) && logs.some((l) => /Old Desk/.test(l)));
  check("a backup was taken first", bad.backup !== null && fs.existsSync(bad.backup!), String(bad.backup));
  const okRun = await migrateContactStatus({ log: (l) => logs.push(l) });
  const afterM = await legacyBuckets();
  check("a clean run writes the statuses and the marker", okRun.ok && okRun.ran && (await prisma.dataMigration.count({ where: { id: CONTACT_STATUS_MIGRATION } })) === 1);
  check("every lead outside the queue is exactly where it was", ids.filter((id) => beforeM.get(id)!.legacy !== "queue").every((id) => afterM.get(id)!.now === beforeM.get(id)!.legacy),
    ids.map((id) => `${beforeM.get(id)!.legacy}→${afterM.get(id)!.now}`).join(", "));
  check("pipeline → owner_email / front_desk by the address", (await lead(old.ownerPipe.id)).contactStatus === "owner_email" && (await lead(old.deskPipe.id)).contactStatus === "front_desk");
  check("contact form and form sent → contact_form; call → call", (await lead(old.form.id)).contactStatus === "contact_form" && (await lead(old.formSent.id)).contactStatus === "contact_form" && (await lead(old.call.id)).contactStatus === "call");
  check("the queue → needs_you, \"Not run yet\" (not \"Pick the owner\")", afterM.get(old.queue.id)!.status === "needs_you" && afterM.get(old.queue.id)!.reason === cf.NOT_RUN_YET && afterM.get(old.queue.id)!.now === "queue");
  check("leads the finder had already placed are left alone", (await lead(one.id)).contactStatus === "owner_email");
  check("LinkedIn leads get no status", (await lead(liOld.id)).contactStatus === null);
  check("a summary line with counts per place is logged", logs.some((l) => /done — \d+ email leads?: .*pipeline \d+/.test(l)), logs[logs.length - 1]);
  check("run again: nothing to do", !(await migrateContactStatus({ log: () => {} })).ran);
  check("the Retry on a \"Not run yet\" lead runs the finder for it", (await jobs.retryContactFinder(old.queue.id)).ok);
  await waitForFinder();
  check("…which routes it (a valid front desk, no owner) → Front desk", (await lead(old.queue.id)).contactStatus === "front_desk", String((await lead(old.queue.id)).contactStatus));
  for (const f of fs.readdirSync(path.dirname(dbFile!))) {
    if (f.startsWith(`${path.basename(dbFile!)}.backup-`)) fs.unlinkSync(path.join(path.dirname(dbFile!), f));
  }

  // ═══ PR 3: front-desk words, the contact-form panel, missing keys, the
  // badge, duplicates, hand-set contacts, revoked addresses, the relabel ═══
  const { classifyAddress, hasFrontDeskWord, readDecisionMakerName } = await import("../src/lib/emailFind");
  const { showsContactFormPanel } = await import("../src/lib/emailBuckets");
  const { duplicateIndex } = await import("../src/lib/duplicates");
  const { loadNavCounts } = await import("../src/lib/navCounts");
  const { updateLead } = await import("../src/lib/actions/leads");
  const { migrateFrontDeskLabels, FRONT_DESK_LABEL_MIGRATION } = await import("../src/lib/dataMigrations");

  console.log("\nFront-desk words: the front desk's, whatever name is in it");
  const paporto = readDecisionMakerName("Dr. Andrea Paporto");
  check("paportofrontdesk@gmail.com → front desk, the doctor's name notwithstanding", classifyAddress("paportofrontdesk@gmail.com", paporto) === "generic");
  check("front.desk@ and front-desk@ are frontdesk", hasFrontDeskWord("paporto.front.desk@gmail.com") && hasFrontDeskWord("front-desk@x.test"));
  check("long words count anywhere: …reception, …appointments, …billing, …office",
    ["drleereception@x.test", "leeappointments@x.test", "billingdrlee@x.test", "drleeoffice@x.test"].every((a) => classifyAddress(a, readDecisionMakerName("Dr. Ann Lee")) === "generic"));
  check("short words at the start, the end, or alone: info@, infodrlee@, drleeinfo@, teamlee@, hello@, leeadmin@, contactlee@",
    ["info@x.test", "infodrlee@x.test", "drleeinfo@x.test", "teamlee@x.test", "hello@x.test", "leeadmin@x.test", "contactlee@x.test"].every((a) => hasFrontDeskWord(a)));
  check("…but not inside a name: martinford@ (info), steaman@ (team), shellos@ (hello), badminton@ (admin)",
    !hasFrontDeskWord("martinford@x.test") && !hasFrontDeskWord("steaman@x.test") && !hasFrontDeskWord("shellos@x.test") && !hasFrontDeskWord("badminton@x.test"));
  check("…so drmartinford@ stays the owner's for Dr. Martin Ford", classifyAddress("drmartinford@x.test", readDecisionMakerName("Dr. Martin Ford")) === "owner");
  const wrongLabel = await seed("Paporto Chiro", {
    websiteNotes: "Dr. Andrea Paporto, chiropractor.",
    email: "paportofrontdesk@gmail.com", emailType: "owner", emailSource: "maps_contacts",
  });
  const rwl = await go(wrongLabel.id);
  check("the finder relabels a stored owner-type front-desk address → Front desk", rwl.status === "front_desk" && (await lead(wrongLabel.id)).emailType === "generic", String(rwl.status));
  const handLabel = await seed("Hand Label Chiro", { email: "officedrkim@x.test", emailType: "owner", emailTypeByHand: true, emailStatus: "valid", emailSource: "maps_contacts" });
  await go(handLabel.id);
  check("…but a type set by hand is left alone", (await lead(handLabel.id)).emailType === "owner");

  console.log("\nThe contact-form panel follows the status");
  const strauss = await seed("Strauss Scoliosis", { email: "info@straussscoliosis.test", emailType: "generic", emailSource: "facebook_page" });
  await go(strauss.id);
  const ls = await lead(strauss.id);
  check("a lead with a valid email in the Email pipeline: no contact-form panel", ls.contactStatus === "front_desk" && !showsContactFormPanel(ls), String(ls.contactStatus));
  check("a Contact form lead: the panel", showsContactFormPanel(await lead(form.id)));
  check("never on a LinkedIn lead", !showsContactFormPanel({ channel: "linkedin", contactStatus: "contact_form" }));

  console.log("\nMissing API keys");
  delete process.env.HUNTER_API_KEY;
  const needsHunter = await seed("Keyless Spine", { websiteNotes: "Dr. Rae Keyless, chiropractor." });
  const rk = await go(needsHunter.id);
  check("Hunter needed, no key → Needs you, \"Missing API key: Hunter\"", rk.status === "needs_you" && (await lead(needsHunter.id)).contactStatusReason === "Missing API key: Hunter", String(rk.status));
  const noHunterNeeded = await seed("Desk Only Spine", { email: "frontdesk@deskonlyspine.test", emailType: "generic", emailSource: "maps_contacts" });
  check("…but a lead that doesn't need Hunter still routes", (await go(noHunterNeeded.id)).status === "front_desk");
  check("not due while the key is missing", !(await run.finderDueLeads()).some((l) => l.id === needsHunter.id));
  process.env.HUNTER_API_KEY = "hunter-test-key";
  check("key saved: due again", (await run.finderDueLeads()).some((l) => l.id === needsHunter.id));
  await jobs.kickContactFinder();
  await waitForFinder();
  check("…and the automatic run clears it", (await lead(needsHunter.id)).contactStatus !== "needs_you", String((await lead(needsHunter.id)).contactStatus));
  delete process.env.INSTANTLY_API_KEY;
  const needsInstantly = await seed("Unchecked Spine", { email: "hi@uncheckedspine.test", emailType: "generic", emailSource: "maps_contacts" });
  const ri = await go(needsInstantly.id);
  check("no Instantly key → Needs you, \"Missing API key: Instantly\"", ri.status === "needs_you" && (await lead(needsInstantly.id)).contactStatusReason === "Missing API key: Instantly");
  process.env.INSTANTLY_API_KEY = "instantly-test-key";
  await jobs.kickContactFinder();
  await waitForFinder();
  check("…cleared once the key is there", (await lead(needsInstantly.id)).contactStatus === "front_desk", String((await lead(needsInstantly.id)).contactStatus));

  console.log("\nThe sidebar badge is the Needs you count");
  const nav = async () => (await loadNavCounts())["/outreach"].n;
  check("badge = the leads Needs you lists", (await nav()) === (await loadEmailQueue()).queue.length, `${await nav()} vs ${(await loadEmailQueue()).queue.length}`);
  const queueNow = (await loadEmailQueue()).queue.map((q) => q.id);
  await prisma.lead.updateMany({ where: { id: { in: queueNow } }, data: { contactStatus: "call", contactStatusReason: null } });
  check("nothing needs you → 0 (the badge hides at 0)", (await nav()) === 0 && (await loadEmailQueue()).queue.length === 0);
  await seed("Badge Spine", { contactStatus: "needs_you", contactStatusReason: cf.OUT_OF_CREDITS });
  check("one needs you → 1", (await nav()) === 1);

  console.log("\nDuplicate doctors and clinics (a warning only)");
  const dl = (id: string, clinicName: string, channel: string, stage: string, websiteUrl: string | null, contactName: string | null, location: string | null) =>
    ({ id, clinicName, channel, stage, websiteUrl, contactName, location });
  const idx = duplicateIndex([
    dl("a", "Strauss Scoliosis Correction", "email", "NEW", "https://straussmethod.com/about", "Dr. Andrew Strauss", "Nanuet, NY 10954"),
    dl("b", "Hudson Valley Scoliosis", "linkedin", "CONTACTED", "https://www.straussmethod.com", null, null),
    dl("c", "Living Well Medical", "linkedin", "CONTACTED", "https://livingwellnewyork.com", "Dr. Steven Shoshany", "632 Broadway, New York, NY 10012"),
    dl("d", "Dr. Steven Shoshany Chiropractor", "email", "LOST", null, "Dr. Steven Shoshany", "636 Broadway, New York, NY 10012"),
    dl("e", "Lee Spine", "email", "NEW", "https://leespine.test", "Dr. Ann Lee", "Austin, TX"),
    dl("f", "Lee Wellness", "email", "NEW", "https://leewellness.test", "Dr. Bob Lee", "Austin, TX"),
    dl("g", "Ann Lee Chiro", "email", "NEW", "https://annleechiro.test", "Dr. Ann Lee", "Portland, OR"),
    dl("h", "FB Only One", "email", "NEW", "https://www.facebook.com/one", null, null),
    dl("i", "FB Only Two", "email", "NEW", "https://facebook.com/two", null, null),
  ]);
  check("same website domain → Also on, with channel and stage", idx.get("a")?.[0]?.id === "b" && idx.get("a")?.[0]?.label === "LinkedIn · Contacted", JSON.stringify(idx.get("a")));
  check("same contact in the same state → Also on (Shoshany, NY)", idx.get("d")?.some((m) => m.id === "c" && m.by === "person") === true);
  check("different doctors, same surname and state → nothing", !idx.has("e") && !idx.has("f"));
  check("the same name in another state → nothing", !(idx.get("g") ?? []).length);
  check("two clinics on Facebook pages are not the same clinic", !idx.has("h") && !idx.has("i"));

  console.log("\nA contact typed on the lead page is the owner, by hand");
  const edited = await seed("Edited Contact Spine", { websiteNotes: "Dr. Site Person, chiropractor.", email: "info@editedcontactspine.test", emailType: "generic", emailSource: "maps_contacts" });
  const fe = new FormData();
  fe.set("clinicName", `Edited Contact Spine ${TAG}`);
  fe.set("contactName", "Dr. Typed Owner");
  fe.set("email", "info@editedcontactspine.test");
  fe.set("stage", "NEW");
  await updateLead(edited.id, fe);
  await waitForFinder();
  check("editing the Contact field marks it set by hand", (await lead(edited.id)).contactNameByHand === true);
  await go(edited.id);
  check("…and the finder never overwrites it, though the site names someone else", (await lead(edited.id)).contactName === "Dr. Typed Owner", String((await lead(edited.id)).contactName));

  console.log("\nA risky address you revoked is not accepted again");
  const rev = await seed("Revoked Spine", { websiteUrl: "https://revokedspine.test", email: "riskydesk@revokedspine.test", emailType: "generic", emailSource: "maps_contacts" });
  await go(rev.id);
  check("found on its own domain: auto-accepted", (await lead(rev.id)).emailRiskyAcceptedAt !== null);
  const pAuto = await emailPanelProps(await lead(rev.id));
  await act.revokeRiskyEmail(rev.id);
  await go(rev.id);
  check("revoked, then re-run: not accepted again", (await lead(rev.id)).emailRiskyAcceptedAt === null);
  const pRev = await emailPanelProps(await lead(rev.id));
  check("Accept risky: hidden while the finder accepts it, offered once you revoked it", !pAuto.risky.canAccept && pRev.risky.canAccept && !pRev.risky.autoAcceptable);
  const offDomain = await seed("Off Domain Spine", { email: "riskydesk@webdesign.test", emailType: "generic", emailSource: "maps_contacts", emailStatus: "risky" });
  check("Accept risky offered for a found address off the clinic's domain", (await emailPanelProps(await lead(offDomain.id))).risky.canAccept);

  console.log("\nThe one-time relabel");
  await prisma.dataMigration.deleteMany({ where: { id: FRONT_DESK_LABEL_MIGRATION } });
  const rl1 = await seed("Relabel Spine", { contactStatus: "owner_email", email: "leefrontdesk@gmail.com", emailType: "owner", emailStatus: "valid", emailSource: "maps_contacts" });
  const rl2 = await seed("Relabel Sent Spine", { contactStatus: "owner_email", email: "kimoffice@gmail.com", emailType: "owner", emailStatus: "valid", emailSource: "maps_contacts" });
  await prisma.emailSend.create({ data: { leadId: rl2.id, step: 0, toEmail: "kimoffice@gmail.com", subject: "s", body: "b", sentAt: new Date() } });
  const rl3 = await seed("Relabel Approved Spine", { contactStatus: "owner_email", email: "parkreception@gmail.com", emailType: "owner", emailStatus: "valid", emailSource: "maps_contacts", emailApprovedAt: new Date() });
  const rl4 = await seed("Relabel Typed Spine", { contactStatus: "owner_email", email: "joinfo@gmail.com", emailType: "owner", emailStatus: "valid", emailSource: "manual" });
  const relabelLog: string[] = [];
  const rr = await migrateFrontDeskLabels({ log: (l) => relabelLog.push(l) });
  check("a backup is taken first", rr.backup !== null && fs.existsSync(rr.backup!), String(rr.backup));
  check("an unsent, unapproved lead's front-desk address → front desk, Owner email → Front desk",
    (await lead(rl1.id)).emailType === "generic" && (await lead(rl1.id)).contactStatus === "front_desk");
  check("sent, approved and typed-by-hand leads are left alone",
    (await lead(rl2.id)).emailType === "owner" && (await lead(rl3.id)).emailType === "owner" && (await lead(rl4.id)).emailType === "owner");
  check("each lead it changes is logged", relabelLog.some((l) => /Relabel Spine/.test(l) && /leefrontdesk@gmail\.com owner → front desk/.test(l)) && !relabelLog.some((l) => /Relabel (Sent|Approved|Typed)/.test(l)));
  check("run again: nothing to do", !(await migrateFrontDeskLabels({ log: () => {} })).ran);
  const dbFile2 = sqliteFile();
  for (const f of fs.readdirSync(path.dirname(dbFile2!))) {
    if (f.startsWith(`${path.basename(dbFile2!)}.backup-`)) fs.unlinkSync(path.join(path.dirname(dbFile2!), f));
  }

  await waitForFinder();
  server.close();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
