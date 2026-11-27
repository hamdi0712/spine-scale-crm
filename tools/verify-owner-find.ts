// The owner rules the contact finder reads — the NPI official's title, the
// doctors a site names, who an address belongs to (front-desk words win over
// a name), the Risky chip — and Settings → Email's free re-clean.
// The run itself (NPI, Hunter, Instantly, routing) is tested in
// tools/verify-contact-finder.ts.
//
//   DATABASE_URL="file:$PWD/.verify-owner.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify-owner.db" npx tsx tools/verify-owner-find.ts

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
  const { parseAlternates, classifyAddress, readDecisionMakerName } = await import("../src/lib/emailFind");
  const { recleanEmailLeads } = await import("../src/lib/ownerReclean");
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
  check("pattern guessing is off by default", DEFAULT_EMAIL_SETTINGS.guessOwnerPatterns === false);

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

  // The run itself — the NPI and site lookup, Hunter, the checks, routing —
  // is the contact finder's now (tools/verify-contact-finder.ts). What stays
  // here are the owner rules it reads.

  console.log("\n8. Doctor names off the site, cleaned and merged");
  const plasker = siteDoctorNames(
    "Dr. Jacob Plasker Testimonials | Dr. Jacob Plasker Dr. Plasker Conditions We Treat. Dr. Jacob. Ask Dr. Plasker's team. Dr. Ste",
    null,
  );
  check("the Plasker variants are one doctor, Dr. Jacob Plasker", plasker.join(",") === "Dr. Jacob Plasker", plasker.join(", "));
  const zilliox = siteDoctorNames("Dr. John Zilliox. Dr. Zilliox Pursuing State licensure…", null);
  check("Dr. John Zilliox / Dr. Zilliox Pursuing State → Dr. John Zilliox", zilliox.join(",") === "Dr. John Zilliox", zilliox.join(", "));
  const fake = siteDoctorNames("Our Dr. Physical Therapists help. Dr. Iguess so.", null);
  check("“Dr. Physical Therapists” and “Dr. Iguess” are not doctors", fake.length === 0, fake.join(", "));
  const pend = siteDoctorNames("Dr. Mike Pendolino Dr", null);
  check("“Dr. Mike Pendolino Dr” → Dr. Mike Pendolino", pend.join(",") === "Dr. Mike Pendolino", pend.join(", "));
  const several = siteDoctorNames("Dr. Ann Lee Testimonials. Dr. Bob Kim Conditions. Dr. Lee and Dr. Kim.", null);
  check("several real doctors stay several", several.length === 2 && several.includes("Dr. Ann Lee") && several.includes("Dr. Bob Kim"), several.join(", "));

  console.log("\n10. Owner or front desk, by the address");
  const asOwner = (a: string, n: string | null) => classifyAddress(a, n ? readDecisionMakerName(n) : null) === "owner";
  check("drhishon@yahoo.com → owner", asOwner("drhishon@yahoo.com", null));
  check("kfwdc@icloud.com → owner (Kyle F. Worell + DC)", asOwner("kfwdc@icloud.com", "Kyle F. Worell"));
  check("drottomeyer@, drdave@, drdom214@, drjkennis@, backpaindoc@, njatlasdr@ → owner",
    ["drottomeyer@a.test", "drdave@a.test", "drdom214@a.test", "drjkennis@a.test", "backpaindoc@a.test", "njatlasdr@a.test"].every((x) => asOwner(x, null)));
  check("teamnadimi@gmail.com → generic, even with the owner's name", !asOwner("teamnadimi@gmail.com", "Dr. Sam Nadimi"));
  check("info@, office@, frontdesk@, numeroffchiro@ → generic",
    !asOwner("info@a.test", "Dr. Sam Info") && !asOwner("office@a.test", null) && !asOwner("frontdesk@a.test", null) && !asOwner("numeroffchiro@gmail.com", "Dr. Mark Numeroff"));

  console.log("\n11. Re-clean: free, fixes names, confirms one-doctor picks, relabels");
  const pick = await seed("Plasker Pick", {
    websiteUrl: "https://plasker.test", ownerStatus: "pick", ownerCheckedAt: new Date(),
    websiteNotes: "Dr. Jacob Plasker Testimonials Dr. Jacob Plasker Dr. Plasker Conditions We treat. Dr. Jacob. Dr. Plasker's. Dr. Ste",
    ownerSiteNames: JSON.stringify(["Dr. Jacob Plasker Testimonials", "Dr. Plasker Conditions We", "Dr. Ste"]),
    email: "drjacob@plasker.test", emailType: "generic", emailSource: "site_crawl", emailStatus: "risky",
  });
  const realPick = await seed("Two Doctors", {
    websiteUrl: "https://two.test", ownerStatus: "pick", ownerCheckedAt: new Date(),
    websiteNotes: "Dr. Ann Lee and Dr. Bob Kim.", ownerSiteNames: JSON.stringify(["Dr. Ann Lee", "Dr. Bob Kim"]),
  });
  const renamed = await seed("Zilliox Chiro", {
    websiteUrl: "https://zil.test", ownerStatus: "confirmed", ownerSource: "site", ownerCheckedAt: new Date(),
    websiteNotes: "Dr. John Zilliox. Dr. Zilliox Pursuing State", contactName: "Dr. Zilliox Pursuing State",
  });
  const byHand = await seed("Hand Label", {
    websiteUrl: "https://hand.test", email: "drhand@hand.test", emailType: "generic", emailTypeByHand: true, emailSource: "site_crawl", emailStatus: "valid",
  });
  const typed = await seed("Typed Address", {
    websiteUrl: "https://typed.test", email: "drtyped@typed.test", emailType: "generic", emailSource: "manual", emailStatus: "valid",
  });
  const hc = hunterCalls.length, ic = instantlyCalls.length, nc = npiCalls.length;
  const rc = await recleanEmailLeads();
  console.log(`    ${rc.changes.map((c) => `${c.clinicName}: ${c.what}`).join("\n    ")}`);
  check("no NPI, Hunter or Instantly calls", hunterCalls.length === hc && instantlyCalls.length === ic && npiCalls.length === nc);
  const pk = await reload(pick.id);
  check("the Plasker pick is confirmed as Dr. Jacob Plasker", pk.ownerStatus === "confirmed" && pk.ownerSource === "site" && pk.contactName === "Dr. Jacob Plasker", `${pk.ownerStatus} ${pk.contactName}`);
  check("its drjacob@ address relabelled owner, status kept", pk.emailType === "owner" && pk.emailStatus === "risky");
  const rp = await reload(realPick.id);
  check("two real doctors still ask to pick", rp.ownerStatus === "pick" && rp.contactName === null);
  const zl = await reload(renamed.id);
  check("“Dr. Zilliox Pursuing State” renamed Dr. John Zilliox", zl.contactName === "Dr. John Zilliox", String(zl.contactName));
  check("a label set by hand is left alone", (await reload(byHand.id)).emailType === "generic");
  check("an address typed by hand is left alone", (await reload(typed.id)).emailType === "generic");

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
