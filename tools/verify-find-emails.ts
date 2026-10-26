// Find emails against a fake Apify, end to end, on seeded A-tier leads:
//
//   crawl      an owner's mailto: and an info@ in the stored crawl — found for
//              free, the owner's verified first, no extractor run
//   extractor  nothing stored; the extractor finds a front-desk address, and
//              the owner's is guessed from the scorecard's decision-maker
//   catchall   the domain accepts everything: risky, and no guesses at all
//   manual     an address typed into the lead form — never touched
//   imported   an imported address that comes back invalid: kept in the
//              alternates, and a valid one found in its place
//   unknown    the verifier cannot tell — counted apart from risky
//   nothing    nothing stored, nothing extracted, nobody named — none
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-find-emails.ts
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
// Two actors on the run-sync endpoint. The extractor answers by site; the
// verifier answers by address, in a different output shape per domain, the
// way different verifier actors do.

const extractorCalls: string[] = [];
const verifierCalls: string[] = [];

const VALID = new Set([
  "dr.janet@crawl-spine.com",
  "frontdesk@extract-spine.com",
  "mark.owens@extract-spine.com",
  "hello@imported-spine.com",
]);

function extractorItems(url: string): unknown[] {
  const host = new URL(url).hostname;
  if (host === "extract-spine.com") {
    return [
      { url: `https://${host}/`, domain: host, emails: [], phones: ["555-0100"] },
      // A web designer's address in the footer: not the clinic's.
      { url: `https://${host}/contact`, domain: host, emails: ["frontdesk@extract-spine.com", "studio@webagency.io"] },
    ];
  }
  return [];
}

function verdict(address: string): unknown {
  const domain = address.split("@")[1];
  if (domain === "catchall-spine.com") return { email: address, status: "accept_all" };
  if (domain === "unknown-spine.com") return { email: address, result: "unknown" };
  if (domain === "extract-spine.com") return { input: { email: address }, result: VALID.has(address) ? "deliverable" : "undeliverable" };
  return { email: address, status: VALID.has(address) ? "valid" : "invalid", isCatchAll: false };
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
    await sleep(40);
    const m = url.pathname.match(/\/acts\/([^/]+)\/run-sync-get-dataset-items$/);
    if (req.method === "POST" && m) {
      const actor = decodeURIComponent(m[1]);
      const input = JSON.parse(body);
      if (actor === "vdrmota~contact-info-scraper") {
        extractorCalls.push(input.startUrls[0].url);
        return send(201, extractorItems(input.startUrls[0].url));
      }
      if (actor === "andok~email-verifier") {
        verifierCalls.push(input.emails[0]);
        return send(201, [verdict(input.emails[0])]);
      }
    }
    send(404, { error: { type: "record-not-found", message: "No such actor" } });
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
  const { planFindEmails, startFindEmails } = await import("../src/lib/actions/jobs");
  const { updateLead } = await import("../src/lib/actions/leads");
  const { readJob } = await import("../src/lib/jobRunner");
  const ef = await import("../src/lib/emailFind");
  const { linksFromMarkdown, isProgramLink } = await import("../src/lib/websiteCrawl");

  console.log("\nPure rules");
  const mailto = linksFromMarkdown("[Email Dr. Reyes](mailto:Dr.Janet@crawl-spine.com) [Disc care](mailto:x@y.com)", "https://crawl-spine.com/");
  check("a crawl keeps mailto: links now", mailto.some((l) => l.url === "mailto:Dr.Janet@crawl-spine.com"), JSON.stringify(mailto.map((l) => l.url)));
  check("a mailto: link is never program-page evidence", mailto.every((l) => !isProgramLink(l)));
  check("junk is not an address", ef.extractEmails("logo@2x.png abc@sentry.io name@example.com real@clinic.com").join() === "real@clinic.com");
  const v = (o: Record<string, string>) => ef.readVerdict(Object.keys(o), Object.values(o));
  check("'deliverable' reads valid", v({ result: "deliverable" }).status === "valid");
  check("catch-all is risky, never valid", v({ status: "valid", isCatchAll: "true" }).status === "risky" && v({ status: "catch_all" }).status === "risky");
  check("an unreadable reply is unknown, not valid", v({ foo: "bar" }).status === "unknown");
  check(
    "guesses are first@, firstlast@, first.last@, drlast@",
    ef.namePatternGuesses(ef.readDecisionMakerName("Dr. Mark Owens, DC")!, "x.com").join() === "mark@x.com,markowens@x.com,mark.owens@x.com,drowens@x.com",
  );

  console.log("\nSeeding seven A-tier leads");
  await prisma.jobRunItem.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.lead.deleteMany();
  await savePipelineSettings({
    ...(await loadPipelineSettings()),
    recrawlConcurrency: 3,
    emailExtractor: { enabled: true, actorId: "vdrmota~contact-info-scraper" },
    emailVerifier: { enabled: true, actorId: "andok~email-verifier" },
  });
  // A perfect old-model scorecard: 10 of 10, A-tier.
  const aTier = {
    icpScoredAt: new Date(),
    icpStaffSize: 2,
    icpPackageEconomics: 3,
    icpBudgetSignal: 2,
    icpGapBooking: true,
    icpGapReviews: true,
    icpGapRemarketing: true,
  };
  const make = (data: Record<string, unknown>) =>
    prisma.lead.create({ data: { clinicName: "x", ...aTier, ...data } as never });
  const crawl = await make({
    clinicName: "Crawl Spine",
    websiteUrl: "https://www.crawl-spine.com/",
    contactName: "Dr. Janet Reyes",
    websiteNotes: "Call us or write to info@crawl-spine.com. Built by studio@webagency.io",
    websiteLinks: JSON.stringify([{ text: "Email Dr. Reyes", url: "mailto:dr.janet@crawl-spine.com", page: "https://crawl-spine.com/" }]),
  });
  const extract = await make({
    clinicName: "Extract Spine",
    websiteUrl: "extract-spine.com",
    websiteNotes: "We offer spinal decompression.",
    // The decision-maker named only by the new-model scorecard.
    icpBreakdown: JSON.stringify(fakeBreakdown("Dr. Mark Owens is named on the site at a single-address clinic — counted as the decision-maker.")),
  });
  const catchall = await make({
    clinicName: "Catchall Spine",
    websiteUrl: "https://catchall-spine.com",
    contactName: "Sara Lind",
    websiteNotes: "Questions? info@catchall-spine.com",
  });
  const manual = await make({ clinicName: "Manual Spine", websiteUrl: "https://manual-spine.com", websiteNotes: "info@manual-spine.com" });
  const imported = await make({
    clinicName: "Imported Spine",
    websiteUrl: "https://imported-spine.com",
    email: "old@imported-spine.com",
    emailSource: "imported",
    websiteNotes: "Say hello@imported-spine.com",
  });
  const unknown = await make({ clinicName: "Unknown Spine", websiteUrl: "https://unknown-spine.com", websiteNotes: "info@unknown-spine.com" });
  const nothing = await make({ clinicName: "Nothing Spine", websiteUrl: "https://nothing-spine.com", websiteNotes: "No addresses here." });

  // The hand-entered one goes in through the lead form, as it would.
  const form = new FormData();
  form.set("clinicName", "Manual Spine");
  form.set("email", "Owner@Manual-Spine.com");
  form.set("websiteUrl", "https://manual-spine.com");
  form.set("stage", "NEW");
  await updateLead(manual.id, form);
  const typed = await prisma.lead.findUniqueOrThrow({ where: { id: manual.id } });
  check("an address typed into the lead form is marked manual", typed.emailSource === "manual", String(typed.emailSource));

  console.log("\nThe estimate for all A-tier");
  const plan = await planFindEmails({ tier: "A" });
  if (!plan.ok) throw new Error(plan.error);
  console.log(`  ${JSON.stringify({ ...plan, ids: plan.ids.length })}`);
  check("six leads covered, the manual one left out", plan.leads === 6 && plan.manual === 1 && !plan.ids.includes(manual.id));
  check("exactly two need the paid extractor (extract, nothing)", plan.needExtractor === 2, String(plan.needExtractor));
  check("an estimate ceiling is quoted", plan.ceilingUsd > 0, `$${plan.ceilingUsd.toFixed(3)}`);

  console.log("\nThe run");
  const launched = await startFindEmails(plan.ids, "pipeline-find-emails-tier");
  if (!launched.ok) throw new Error(launched.error);
  let job = await readJob(launched.id);
  while (job && job.status === "running") {
    await sleep(150);
    job = await readJob(launched.id);
  }
  const items = await prisma.jobRunItem.findMany({ where: { runId: launched.id }, orderBy: { seq: "asc" } });
  for (const i of items) console.log(`    ${i.name.padEnd(15)} ${i.outcome.padEnd(5)} ${i.detail}`);
  console.log(`  note: ${job?.note}`);
  console.log(`  spent: $${job?.spentUsd.toFixed(3)} of an estimated $${job?.estimatedUsd?.toFixed(3)}`);
  console.log(`  extractor ran on: ${extractorCalls.join(", ")}`);
  console.log(`  verifier checked: ${verifierCalls.join(", ")}`);

  const get = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });

  const c = await get(crawl.id);
  check("crawl: the owner's mailto: address, verified valid", c.email === "dr.janet@crawl-spine.com" && c.emailType === "owner" && c.emailStatus === "valid" && c.emailSource === "site_crawl", `${c.email} ${c.emailType} ${c.emailStatus} ${c.emailSource}`);
  check("crawl: no extractor run, one verification, no guesses", !extractorCalls.some((u) => u.includes("crawl-spine")) && verifierCalls.filter((a) => a.endsWith("@crawl-spine.com")).length === 1);
  check("crawl: info@ kept as an unchecked alternate; the web designer's address dropped", /info@crawl-spine\.com/.test(c.emailAlternates ?? "") && !/webagency/.test(c.emailAlternates ?? ""), c.emailAlternates ?? "");

  const e = await get(extract.id);
  check("extractor: run once, on this clinic only", extractorCalls.filter((u) => u.includes("extract-spine")).length === 1);
  check("extractor: owner address guessed from the scorecard's decision-maker", e.email === "mark.owens@extract-spine.com" && e.emailSource === "name_pattern" && e.emailStatus === "valid" && e.emailType === "owner", `${e.email} ${e.emailSource}`);
  check("extractor: guessing stopped at the first valid (drowens@ never tried)", !verifierCalls.includes("drowens@extract-spine.com"));
  check("extractor: the front desk address is an alternate, valid", /frontdesk@extract-spine\.com.*"status":"valid".*"source":"extractor"/.test(e.emailAlternates ?? ""), e.emailAlternates ?? "");
  check("extractor: invalid guesses are not kept", !/"mark@extract-spine/.test(e.emailAlternates ?? ""));

  const ca = await get(catchall.id);
  check("catch-all: risky, never valid", ca.email === "info@catchall-spine.com" && ca.emailStatus === "risky", `${ca.email} ${ca.emailStatus}`);
  check("catch-all: no name guesses at all", verifierCalls.filter((a) => a.endsWith("@catchall-spine.com")).length === 1, verifierCalls.filter((a) => a.endsWith("@catchall-spine.com")).join());

  const mn = await get(manual.id);
  check("manual: untouched", mn.email === "Owner@Manual-Spine.com" && mn.emailSource === "manual" && mn.emailCheckedAt === null && mn.emailStatus === null);
  check("manual: nothing sent anywhere", !verifierCalls.some((a) => a.includes("manual-spine")) && !extractorCalls.some((u) => u.includes("manual-spine")));

  const im = await get(imported.id);
  check("imported: verified, came back invalid, moved to the alternates", /old@imported-spine\.com.*"status":"invalid".*"source":"imported"/.test(im.emailAlternates ?? ""), im.emailAlternates ?? "");
  check("imported: a valid one found in its place", im.email === "hello@imported-spine.com" && im.emailStatus === "valid" && im.emailSource === "site_crawl");

  const un = await get(unknown.id);
  check("unknown: kept, marked unknown", un.email === "info@unknown-spine.com" && un.emailStatus === "unknown");

  const no = await get(nothing.id);
  check("nothing: none found, marked not found", no.email === null && no.emailType === "not_found" && no.emailCheckedAt !== null);

  check(
    "summary counts valid owner, valid generic, risky, unknown and none apart",
    job?.note === "Valid owner 2 · valid generic 1 · risky only 1 · unknown 1 · none 1.",
    job?.note ?? "",
  );
  check("spend counted from what ran, under the estimate", (job?.spentUsd ?? 0) > 0 && (job?.spentUsd ?? 0) <= (job?.estimatedUsd ?? 0) + 1e-9);

  console.log("\nRe-saving the lead form without changing the address");
  const resave = new FormData();
  resave.set("clinicName", "Crawl Spine");
  resave.set("email", "dr.janet@crawl-spine.com");
  resave.set("stage", "NEW");
  await updateLead(crawl.id, resave);
  const c2 = await get(crawl.id);
  check("keeps the found source and verdict", c2.emailSource === "site_crawl" && c2.emailStatus === "valid");

  console.log("\nAn imported address that verifies valid is never replaced");
  await prisma.lead.update({ where: { id: imported.id }, data: { email: "hello@imported-spine.com", emailSource: "imported", emailAlternates: null } });
  const before = verifierCalls.length;
  const again = await startFindEmails([imported.id], "pipeline-find-emails-selected");
  if (!again.ok) throw new Error(again.error);
  let j2 = await readJob(again.id);
  while (j2 && j2.status === "running") {
    await sleep(100);
    j2 = await readJob(again.id);
  }
  const im2 = await get(imported.id);
  check("kept, valid, still imported, after one verification", im2.email === "hello@imported-spine.com" && im2.emailSource === "imported" && im2.emailStatus === "valid" && verifierCalls.length === before + 1);

  console.log("\nVerifier off");
  await savePipelineSettings({ ...(await loadPipelineSettings()), emailVerifier: { enabled: false, actorId: "andok~email-verifier" } });
  const off = await planFindEmails({ tier: "A" });
  check("the estimate refuses, saying to switch it on", !off.ok && /verifier/.test(off.error));

  await prisma.$disconnect();
  server.close();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

// The least of an A-tier new-model breakdown whose decision-maker line names
// somebody — the shape titleEntry in src/lib/icpScoring.ts writes.
function fakeBreakdown(titleReason: string) {
  return {
    model: "v2",
    version: 1,
    icp: { id: "x", name: "x", updatedAt: new Date().toISOString() },
    disqualifiers: [],
    fit: [{ key: "title", label: "Decision-maker title", points: 15, max: 15, citations: [], reason: titleReason, source: "computed", shortfall: null }],
    signals: [],
    fitTotal: 60,
    signalsTotal: 30,
    ungatedTotal: 90,
    total: 90,
    tier: "A",
    primaryService: { service: "spine and disc care", citation: null, reason: "" },
    paymentModel: { model: "unknown", citation: null, reason: "" },
    chiroProgram: null,
    verdict: { kind: "fit" },
    summary: "",
    evidence: [],
    notes: [],
    scoredAt: new Date().toISOString(),
  };
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
