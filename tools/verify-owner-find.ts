// Find owners — the owner's name from the NPI Registry and the stored crawl,
// then the owner's email from Hunter or the clinic's pattern, each checked
// through Instantly — against local mocks of all three APIs, shaped like
// their real answers (see the headers of src/lib/npiRegistry.ts and
// src/lib/hunter.ts).
//
//   DATABASE_URL="file:$PWD/.verify-owner.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify-owner.db" npx tsx tools/verify-owner-find.ts
//
// Use a fresh database: the job works on every email lead that qualifies.
//
// The cases: an NPI match that agrees with the site (and a Hunter Email
// Finder hit); an NPI official who is an office manager (and a Hunter miss
// found by the guesses); a name mismatch (a pick); a Gmail-only clinic
// (skipped, nothing spent); a catch-all domain (kept as a risky alternate);
// and the budget refusal. Then the front-desk email naming the doctor, the
// Risky chip's rule, and the automatic run on a newly promoted lead.

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

// ─── The mocks ─────────────────────────────────────────────────────────────

// NPI organization records, in the registry's own shape.
function org(number: string, name: string, city: string, state: string, phone: string, official: Record<string, string>, dba?: string) {
  return {
    number,
    enumeration_type: "NPI-2",
    basic: { organization_name: name, authorized_official_name_suffix: "--", ...official },
    other_names: dba ? [{ code: "3", organization_name: dba, type: "Doing Business As" }] : [],
    addresses: [
      { address_purpose: "LOCATION", address_1: "1 MAIN ST", city: city.toUpperCase(), state, telephone_number: phone, country_code: "US" },
      { address_purpose: "MAILING", address_1: "PO BOX 1", city: city.toUpperCase(), state, telephone_number: phone, country_code: "US" },
    ],
    taxonomies: [{ code: "111N00000X", desc: "Chiropractor", primary: true }],
  };
}
const NPI = [
  org("1000000001", "AGREE SPINE PLLC", "Austin", "TX", "512-555-0101", {
    authorized_official_name_prefix: "Dr.", authorized_official_first_name: "ANN", authorized_official_last_name: "LEE",
    authorized_official_credential: "D.C.", authorized_official_title_or_position: "Owner", authorized_official_telephone_number: "5125550101",
  }),
  // Same name prefix, another town and phone: not this clinic.
  org("1000000009", "AGREE SPINE OF DALLAS LLC", "Dallas", "TX", "214-555-0999", {
    authorized_official_first_name: "WRONG", authorized_official_last_name: "PERSON", authorized_official_title_or_position: "President",
  }),
  org("1000000002", "MANAGER CHIROPRACTIC INC", "Denver", "CO", "303-555-0102", {
    authorized_official_first_name: "PAT", authorized_official_last_name: "DOE", authorized_official_title_or_position: "Office Manager",
    authorized_official_telephone_number: "3035550102",
  }),
  org("1000000003", "PARK HEALTH GROUP PC", "Tampa", "FL", "813-555-0103", {
    authorized_official_name_prefix: "Dr.", authorized_official_first_name: "JOHN", authorized_official_last_name: "PARK",
    authorized_official_title_or_position: "President",
  }, "MISMATCH WELLNESS"),
  org("1000000004", "GMAIL CHIRO", "Reno", "NV", "775-555-0104", {
    authorized_official_name_prefix: "Dr.", authorized_official_first_name: "TOM", authorized_official_last_name: "HALE",
    authorized_official_title_or_position: "Owner",
  }),
  org("1000000005", "CATCHALL CLINIC LLC", "Boise", "ID", "208-555-0105", {
    authorized_official_name_prefix: "Dr.", authorized_official_first_name: "KIM", authorized_official_last_name: "ROSS",
    authorized_official_credential: "DC", authorized_official_title_or_position: "CEO",
  }),
];

// Hunter, by domain: what Email Finder and Domain Search answer.
const FINDER: Record<string, { email: string | null; provenance?: string }> = {
  "agreespine.test": { email: "ann.lee@agreespine.test", provenance: "found" },
  "managerchiro.test": { email: null },
  "catchall.test": { email: null },
};
const PATTERN: Record<string, string | null> = { "managerchiro.test": null, "catchall.test": "{first}" };
// Instantly, by address and by domain.
const VALID = new Set(["ann.lee@agreespine.test", "sam@managerchiro.test"]);
const CATCH_ALL_DOMAINS = new Set(["catchall.test"]);

const npiCalls: string[] = [];
const hunterCalls: string[] = [];
const instantlyCalls: string[] = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://x");
    res.setHeader("Content-Type", "application/json");
    // NPI Registry
    if (req.method === "GET" && url.pathname === "/api/") {
      const q = url.searchParams;
      npiCalls.push(`${q.get("organization_name")}|${q.get("state") ?? ""}`);
      if (q.get("version") !== "2.1" || q.get("enumeration_type") !== "NPI-2") {
        res.end(JSON.stringify({ Errors: [{ description: "bad version or type", field: "version" }] }));
        return;
      }
      const prefix = (q.get("organization_name") ?? "").replace(/\*$/, "").toUpperCase();
      const state = q.get("state");
      const results = NPI.filter(
        (o) =>
          [o.basic.organization_name, ...o.other_names.map((n) => n.organization_name)].some((n) => n.startsWith(prefix)) &&
          (!state || o.addresses.some((a) => a.state === state)),
      );
      res.end(JSON.stringify({ result_count: results.length, results }));
      return;
    }
    // Hunter
    if (req.method === "GET" && url.pathname.startsWith("/v2/")) {
      if (req.headers["x-api-key"] !== "hunter-test-key") {
        res.statusCode = 401;
        res.end(JSON.stringify({ errors: [{ id: "authentication_failed", code: 401, details: "No user found for the API key supplied" }] }));
        return;
      }
      const domain = url.searchParams.get("domain") ?? "";
      if (url.pathname === "/v2/email-finder") {
        hunterCalls.push(`finder:${domain}:${url.searchParams.get("first_name")} ${url.searchParams.get("last_name")}`);
        const f = FINDER[domain] ?? { email: null };
        res.setHeader("X-Credits-Used", f.email ? "1" : "0");
        res.setHeader("X-Credits-Unit", "credit");
        res.end(JSON.stringify({
          data: { first_name: url.searchParams.get("first_name"), last_name: url.searchParams.get("last_name"), email: f.email, score: f.email ? 94 : null, domain, accept_all: CATCH_ALL_DOMAINS.has(domain), provenance: f.email ? f.provenance : null, sources: [], verification: { date: null, status: f.email ? "valid" : null } },
          meta: { params: { domain } },
        }));
        return;
      }
      if (url.pathname === "/v2/domain-search") {
        hunterCalls.push(`domain:${domain}:limit=${url.searchParams.get("limit")}`);
        const pattern = PATTERN[domain] ?? null;
        res.setHeader("X-Credits-Used", pattern ? "1" : "0");
        res.setHeader("X-Credits-Unit", "credit");
        res.end(JSON.stringify({
          data: { domain, disposable: false, webmail: false, accept_all: CATCH_ALL_DOMAINS.has(domain), pattern, organization: null, linked_domains: [], emails: [] },
          meta: { results: 0, limit: 1, offset: 0 },
        }));
        return;
      }
    }
    // Instantly
    if (req.method === "POST" && url.pathname === "/api/v2/email-verification") {
      const { email } = JSON.parse(body) as { email: string };
      instantlyCalls.push(email);
      const domain = email.slice(email.indexOf("@") + 1);
      const catchAll = CATCH_ALL_DOMAINS.has(domain);
      const status = catchAll || VALID.has(email) ? "verified" : "invalid";
      res.end(JSON.stringify({ email, verification_status: status, catch_all: catchAll, credits_used: 1, credits: 500 }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

const TAG = "Owner verify";

async function main(): Promise<void> {
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  process.env.NPI_API_BASE = base;
  process.env.HUNTER_API_BASE = base;
  process.env.HUNTER_API_KEY = "hunter-test-key";
  process.env.INSTANTLY_API_BASE = base;
  process.env.INSTANTLY_API_KEY = "test-key";

  const { prisma } = await import("../src/lib/prisma");
  const { startOwnerJob, autoFindOwners, ownerJobEstimate } = await import("../src/lib/actions/jobs");
  const { pickOwner, findOwnerLeads } = await import("../src/lib/ownerFindRun");
  const { parseAlternates } = await import("../src/lib/emailFind");
  const { hasRiskyEmail, siteDoctorNames, stateFromLocation, isDecisionMakerTitle, ownerPanelProps } = await import("../src/lib/ownerFind");
  const { DEFAULT_EMAIL_SETTINGS, renderEmail } = await import("../src/lib/emailWorkflow");
  const { loadEmailSettings, saveEmailSettingsRow } = await import("../src/lib/emailSettingsStore");

  const clean = async () => {
    await prisma.lead.deleteMany({ where: { leadSource: TAG } });
    await prisma.jobRun.deleteMany({});
    await prisma.hunterCall.deleteMany({});
    await prisma.emailCheck.deleteMany({});
  };
  await clean();
  await saveEmailSettingsRow({ ...DEFAULT_EMAIL_SETTINGS });

  const seed = (name: string, data: Record<string, unknown>) =>
    prisma.lead.create({ data: { clinicName: name, channel: "email", stage: "NEW", leadSource: TAG, ...data } });
  const reload = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
  const waitFor = async (source: string, after: Date) => {
    for (let i = 0; i < 400; i++) {
      const run = await prisma.jobRun.findFirst({ where: { source, startedAt: { gte: after } }, orderBy: { startedAt: "desc" } });
      if (run && run.status !== "running") return run;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${source} never finished`);
  };

  console.log("\nThe rules");
  check("state read off the location", stateFromLocation("Austin, TX") === "TX" && stateFromLocation("Boise, Idaho") === "ID" && stateFromLocation("Reno") === null);
  check("office and billing titles are not decision-makers", !isDecisionMakerTitle("Office Manager") && !isDecisionMakerTitle("Billing Coordinator") && !isDecisionMakerTitle("Practice Administrator"));
  check("owners, presidents and doctors are", isDecisionMakerTitle("Owner") && isDecisionMakerTitle("President") && isDecisionMakerTitle("CEO") && isDecisionMakerTitle("Owner / Office Manager"));
  const names = siteDoctorNames("Meet Dr. Ann Lee, founder. Dr. Lee has 20 years of experience. Our associate Sam Ray, D.C. joined in 2020.", null);
  check("doctors off the crawl, each once", names.length === 2 && names.includes("Dr. Ann Lee") && names.includes("Dr. Sam Ray"), names.join(", "));

  // Names start with the tag only in the clinic, not the NPI search word.
  const agree = await seed("Agree Spine", {
    location: "Austin, TX", phone: "(512) 555-0101", websiteUrl: "https://www.agreespine.test",
    websiteNotes: "Welcome to Agree Spine. Meet Dr. Ann Lee, our founder and lead chiropractor.",
    email: "info@agreespine.test", emailType: "generic", emailSource: "site_crawl", emailStatus: "valid",
  });
  const manager = await seed("Manager Chiropractic", {
    location: "Denver, CO", phone: "303-555-0102", websiteUrl: "https://managerchiro.test",
    websiteNotes: "Dr. Sam Ray treats back pain with decompression.",
    email: "info@managerchiro.test", emailType: "generic", emailSource: "maps_contacts", emailStatus: "valid",
  });
  const mismatch = await seed("Mismatch Wellness", {
    location: "Tampa, FL", phone: "813-555-0103", websiteUrl: "https://mismatch.test",
    websiteNotes: "Dr. Mia Chen is the chiropractor at Mismatch Wellness.",
    email: "frontdesk@mismatch.test", emailType: "generic", emailSource: "site_crawl", emailStatus: "valid",
  });
  const gmail = await seed("Gmail Chiro", {
    location: "Reno, NV", phone: "775-555-0104", websiteUrl: "https://gmailchiro.test",
    websiteNotes: "Dr. Tom Hale, chiropractor.",
    email: "gmailchiro.office@gmail.com", emailType: "generic", emailSource: "maps_contacts", emailStatus: "valid",
  });
  const catchall = await seed("Catchall Clinic", {
    location: "Boise, ID", phone: "208-555-0105", websiteUrl: "https://catchall.test",
    websiteNotes: "Dr. Kim Ross founded Catchall Clinic.",
    email: "front@catchall.test", emailType: "generic", emailSource: "site_crawl", emailStatus: "valid",
  });
  const mine = [agree, manager, mismatch, gmail, catchall].map((l) => l.id);

  console.log("\nThe budget refusal");
  await saveEmailSettingsRow({ ...(await loadEmailSettings()), hunterCreditBudget: 3 });
  const est = await ownerJobEstimate();
  check("the estimate counts the five leads, two Hunter credits and four checks each at most", est.count === 5 && est.hunterMax === 10 && est.instantlyMax === 20, JSON.stringify(est));
  const refused = await startOwnerJob({});
  check("a job that could pass the Hunter budget is refused", !refused.ok && /Hunter credits/.test(refused.error) && /1 lead would fit/.test(refused.error), refused.ok ? "started" : refused.error);
  check("nothing was called", npiCalls.length === 0 && hunterCalls.length === 0 && instantlyCalls.length === 0);
  await saveEmailSettingsRow({ ...(await loadEmailSettings()), hunterCreditBudget: 50 });

  console.log("\nThe run");
  const t0 = new Date(Date.now() - 1000);
  const started = await startOwnerJob({});
  check("starts in the shared job runner", started.ok, started.ok ? "" : started.error);
  const run = await waitFor("find-owners", t0);
  console.log(`    note: ${run.note}`);
  check("finished", run.status === "finished", run.status);
  check(
    "the summary: owners confirmed, owner emails found by status, credits used",
    /4 owners confirmed \(1 to pick by hand\)/.test(run.note ?? "") && /3 owner emails found — 2 valid, 1 risky, 0 invalid/.test(run.note ?? "") && /Hunter credits/.test(run.note ?? ""),
    run.note ?? "",
  );

  console.log("\n1. NPI agrees with the site → confirmed; Hunter Email Finder hit");
  const a = await reload(agree.id);
  check("matched the Austin record by phone, not the Dallas one", a.npiNumber === "1000000001", String(a.npiNumber));
  check("official and title saved", a.npiOfficialName === "Dr. Ann Lee" && a.npiOfficialTitle === "Owner", `${a.npiOfficialName}, ${a.npiOfficialTitle}`);
  check("owner confirmed (NPI and site agree), now the contact", a.ownerStatus === "confirmed" && a.ownerSource === "npi_site" && a.contactName === "Dr. Ann Lee");
  check("Hunter's address is the main email, source Hunter, checked valid", a.email === "ann.lee@agreespine.test" && a.emailSource === "hunter" && a.emailType === "owner" && a.emailStatus === "valid");
  const aAlts = parseAlternates(a.emailAlternates);
  check("the front desk moved to the alternates, as it was", aAlts.some((x) => x.address === "info@agreespine.test" && x.type === "generic" && x.status === "valid" && x.source === "site_crawl"), a.emailAlternates ?? "");
  check("Domain Search not needed", !hunterCalls.some((c) => c.startsWith("domain:agreespine")), hunterCalls.join(" | "));

  console.log("\n2. NPI official is an office manager → flagged; the site's one doctor confirmed; Hunter miss found by guessing");
  const m = await reload(manager.id);
  check("the official is kept and flagged not a decision-maker", m.npiOfficialName === "Pat Doe" && ownerPanelProps(m).npiNotDecisionMaker === true, `${m.npiOfficialName} (${m.npiOfficialTitle})`);
  check("the site's only doctor is the confirmed owner", m.ownerStatus === "confirmed" && m.ownerSource === "site" && m.contactName === "Dr. Sam Ray", `${m.ownerStatus}/${m.ownerSource}/${m.contactName}`);
  check("Hunter asked for Sam Ray, found nothing, then Domain Search", hunterCalls.includes("finder:managerchiro.test:sam ray") && hunterCalls.includes("domain:managerchiro.test:limit=1"));
  check("no pattern: drray@ tried first (invalid), then sam@ (valid) — and it stopped there", instantlyCalls.join(",").includes("drray@managerchiro.test,sam@managerchiro.test") && !instantlyCalls.includes("drsam@managerchiro.test"), instantlyCalls.join(", "));
  check("the guess is the main email, source Pattern guess", m.email === "sam@managerchiro.test" && m.emailSource === "pattern_guess" && m.emailStatus === "valid");
  const mAlts = parseAlternates(m.emailAlternates);
  check("the invalid guess is kept as an invalid alternate; the front desk too", mAlts.some((x) => x.address === "drray@managerchiro.test" && x.status === "invalid") && mAlts.some((x) => x.address === "info@managerchiro.test"), m.emailAlternates ?? "");
  const hunterCredits = await prisma.hunterCall.findMany({ where: { leadId: manager.id } });
  check("Hunter's misses cost nothing (X-Credits-Used 0)", hunterCredits.length === 2 && hunterCredits.every((h) => h.creditsUsed === 0));

  console.log("\n3. A name mismatch → both shown to pick");
  const x = await reload(mismatch.id);
  check("matched through the DBA name, by phone", x.npiNumber === "1000000003");
  check("status pick; NPI's and the site's names both offered", x.ownerStatus === "pick" && ownerPanelProps(x).choices.join(",") === "Dr. John Park,Dr. Mia Chen", ownerPanelProps(x).choices.join(","));
  check("nothing spent and the contact untouched until picked", !hunterCalls.some((c) => c.includes("mismatch.test")) && x.contactName === null);
  const picked = await pickOwner(mismatch.id, "Dr. Mia Chen");
  const x2 = await reload(mismatch.id);
  check("picking confirms her as the owner", picked.ok && x2.ownerStatus === "confirmed" && x2.ownerSource === "manual" && x2.contactName === "Dr. Mia Chen");
  check("a name that wasn't offered is refused", !(await pickOwner(mismatch.id, "Someone Else")).ok);

  console.log("\n4. A Gmail-only clinic → skipped");
  const g = await reload(gmail.id);
  check("owner confirmed for free", g.ownerStatus === "confirmed" && g.contactName === "Dr. Tom Hale");
  check("no Hunter call and no check for it", !hunterCalls.some((c) => c.includes("gmailchiro")) && !instantlyCalls.some((c) => c.includes("gmailchiro")));
  check("its Gmail address stays the main email, and it is not offered again", g.email === "gmailchiro.office@gmail.com" && g.ownerEmailAt !== null);

  console.log("\n5. A catch-all domain → risky, kept, never the main email");
  const c = await reload(catchall.id);
  check("pattern {first} built kim@ and Instantly said catch-all", instantlyCalls.includes("kim@catchall.test"));
  check("only one guess checked on a catch-all domain", instantlyCalls.filter((e) => e.endsWith("@catchall.test")).length === 1);
  check("the front desk is still the main email", c.email === "front@catchall.test" && c.emailStatus === "valid");
  const cAlts = parseAlternates(c.emailAlternates);
  check("the guess is an alternate marked risky, not deleted", cAlts.some((y) => y.address === "kim@catchall.test" && y.status === "risky" && y.type === "owner" && y.source === "pattern_guess"), c.emailAlternates ?? "");
  check("the Risky chip catches it", hasRiskyEmail(c) && !hasRiskyEmail(await reload(agree.id)));

  console.log("\n6. The front desk is asked to pass it to the doctor by name");
  const fd = renderEmail(DEFAULT_EMAIL_SETTINGS, { clinicName: c.clinicName, contactName: c.contactName, contactTitle: c.contactTitle, websiteNotes: c.websiteNotes }, "front_desk", "Saw your decompression page.");
  check("“Could you pass this to Dr. Ross?”", /pass this to Dr\. Ross\?/.test(fd.body), fd.body.split("\n").find((l) => l.includes("pass")) ?? "");
  const before = renderEmail(DEFAULT_EMAIL_SETTINGS, { clinicName: "X", contactName: null, contactTitle: null, websiteNotes: null }, "front_desk", "o");
  check("(without a contact name it says “the doctor or owner”, never a blank)", /pass this to the doctor or owner\?/.test(before.body), before.body.split("\n").find((l) => l.includes("pass")) ?? "");
  const saved = renderEmail(
    { ...DEFAULT_EMAIL_SETTINGS, frontDeskTemplate: "{greeting}\n\n{opener}\n\nThis is probably a question for {contact}. Would you mind passing it along?" },
    { clinicName: "X", contactName: null, contactTitle: null, websiteNotes: null },
    "front_desk",
    "o",
  );
  check("the saved template's line, with no contact: “…a question for the doctor or owner.”", saved.body.includes("This is probably a question for the doctor or owner. Would you mind"));
  const named = renderEmail(
    { ...DEFAULT_EMAIL_SETTINGS, frontDeskTemplate: "{greeting}\n\n{opener}\n\nThis is probably a question for {contact}. Would you mind passing it along?" },
    { clinicName: c.clinicName, contactName: c.contactName, contactTitle: c.contactTitle, websiteNotes: c.websiteNotes },
    "front_desk",
    "o",
  );
  check("…and with a confirmed owner: “…a question for Dr. Ross.”", named.body.includes("This is probably a question for Dr. Ross. Would you mind"));

  console.log("\n7. Not run twice; the automatic run on a new lead");
  const left = (await findOwnerLeads()).filter((l) => mine.includes(l.id)).map((l) => l.clinicName);
  check("only the just-picked lead is still waiting", left.join(",") === "Mismatch Wellness", left.join(","));
  const fresh = await seed("Newly Promoted Spine", { location: "Austin, TX", websiteUrl: "https://newly.test", email: "hi@newly.test", emailType: "generic", emailStatus: "valid" });
  const t1 = new Date();
  await autoFindOwners();
  await waitFor("find-owners", t1);
  const f = await reload(fresh.id);
  const mx = await reload(mismatch.id);
  check("the new lead was looked up on its own", f.ownerCheckedAt !== null && f.ownerStatus === "not_found", String(f.ownerStatus));
  check("the auto run only takes leads never looked up (the picked one waits for its own run)", mx.ownerEmailAt === null);

  await prisma.lead.deleteMany({ where: { leadSource: TAG } });
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  server.close();
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
