// The backup email finder (the website, then the Facebook page), the lead
// page's contact-form buttons, and the front-desk message they copy — against
// a local mock of Apify's run-sync endpoint and Instantly's email check.
//
//   DATABASE_URL="file:$PWD/.verify-fb.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify-fb.db" npx tsx tools/verify-facebook-emails.ts
//
// Use a fresh database: the bulk action and the Instantly check both work on
// every lead that qualifies, not only the ones seeded here.
//
// Seeds email leads whose Facebook page lists an email, lists none, and lists
// only a web vendor's; one that already has an email; one whose stored crawl
// has one (no Facebook run at all); and a candidate promoted with no Maps
// email. Checks what each ends up with, that nothing is overwritten, that a
// page is read once, that a found address goes through the Instantly check,
// and the bulk action's estimate. Then the contact-form link on a site with
// "Contact Us", one with only "Schedule Appointment" and one with neither;
// the copied message in its three cases; and Mark form sent.

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

// ─── The mock ──────────────────────────────────────────────────────────────

// What each Facebook page "lists", as apify~facebook-pages-scraper returns a
// page: the email field, and the About lines under info / intro.
const PAGES: Record<string, unknown[]> = {
  "https://www.facebook.com/fblisted": [
    {
      title: "FB Listed Spine",
      pageUrl: "https://www.facebook.com/fblisted",
      email: "frontdesk@fblisted.test",
      info: ["Spinal decompression in Austin", "Questions? Email Dr. Lee directly: drlee@fblisted.test"],
      // A post mentioning somebody else's address is not read.
      posts: [{ text: "Thanks to our designer hello@pixelwebdesigns.com!" }],
    },
  ],
  "https://www.facebook.com/fbnothing": [
    { title: "FB Nothing Chiro", pageUrl: "https://www.facebook.com/fbnothing", intro: "Family chiropractic since 1998.", phone: "(512) 555-0199" },
  ],
  "https://www.facebook.com/fbvendor": [
    { title: "FB Vendor Clinic", pageUrl: "https://www.facebook.com/fbvendor", email: "hello@pixelwebdesigns.com", info: ["Site by support@wix.com"] },
  ],
  "https://www.facebook.com/fbpromoted": [
    { title: "FB Promoted Clinic", pageUrl: "https://www.facebook.com/fbpromoted", email: "info@fbpromoted.test" },
  ],
};
const apifyCalls: string[] = [];
const checked: string[] = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://x");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && /\/acts\/.+\/run-sync-get-dataset-items$/.test(url.pathname)) {
      const input = JSON.parse(body) as { startUrls?: { url: string }[] };
      const page = input.startUrls?.[0]?.url ?? "";
      apifyCalls.push(page);
      res.end(JSON.stringify(PAGES[page] ?? []));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/v2/email-verification") {
      const { email } = JSON.parse(body) as { email: string };
      checked.push(email);
      res.end(JSON.stringify({ email, verification_status: "verified", catch_all: false, credits_used: 1 }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

const TAG = "FB verify";

async function main(): Promise<void> {
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  process.env.APIFY_API_BASE = `http://127.0.0.1:${port}`;
  process.env.APIFY_API_TOKEN = "test-token";
  process.env.INSTANTLY_API_BASE = `http://127.0.0.1:${port}`;
  process.env.INSTANTLY_API_KEY = "test-key";

  const { prisma } = await import("../src/lib/prisma");
  const { loadPipelineSettings, savePipelineSettings } = await import("../src/lib/pipelineSettingsStore");
  const { DEFAULT_PIPELINE_SETTINGS, readPipelineSettings, pipelineSettingsRow, facebookEmailsCost, fmtEstimate } = await import("../src/lib/pipelineSettings");
  const { findBackupEmail, facebookEmailLeads } = await import("../src/lib/facebookEmailRun");
  const { startFacebookEmailJob, autoFindBackupEmail } = await import("../src/lib/actions/jobs");
  const { uncheckedEmailLeads } = await import("../src/lib/emailCheckRun");
  const { parseAlternates, EMAIL_SOURCE_LABELS } = await import("../src/lib/emailFind");
  const { promoteToLead } = await import("../src/lib/promoteLead");
  const { pickContactFormLink } = await import("../src/lib/contactForm");
  const { frontDeskMessage, DEFAULT_EMAIL_SETTINGS, renderEmail } = await import("../src/lib/emailWorkflow");
  const { markContactFormSent } = await import("../src/lib/actions/emailWorkflow");

  const clean = async () => {
    await prisma.discoveryCandidate.deleteMany({ where: { clinicName: { startsWith: TAG } } });
    await prisma.lead.deleteMany({ where: { clinicName: { startsWith: TAG } } });
    await prisma.jobRun.deleteMany({});
  };
  await clean();

  const seed = (name: string, data: Record<string, unknown>) =>
    prisma.lead.create({ data: { clinicName: `${TAG} — ${name}`, channel: "email", stage: "NEW", ...data } });
  const reload = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
  const waitFor = async (source: string) => {
    for (let i = 0; i < 200; i++) {
      const run = await prisma.jobRun.findFirst({ where: { source }, orderBy: { startedAt: "desc" } });
      if (run && run.status !== "running") return run;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${source} never finished`);
  };

  console.log("\nThe setting");
  check("off by default", DEFAULT_PIPELINE_SETTINGS.facebookEmails.enabled === false);
  check("the default actor is the Facebook page scraper", DEFAULT_PIPELINE_SETTINGS.facebookEmails.actorId === "apify~facebook-pages-scraper");
  const roundTrip = readPipelineSettings(
    pipelineSettingsRow({ ...DEFAULT_PIPELINE_SETTINGS, facebookEmails: { enabled: true, actorId: "someone/fb-pages" } }),
  );
  check("saved and read back, the ID normalised", roundTrip.facebookEmails.enabled && roundTrip.facebookEmails.actorId === "someone~fb-pages", JSON.stringify(roundTrip.facebookEmails));
  check("a malformed ID falls back to the default", readPipelineSettings({ facebookEmailsActorId: "not an id!" }).facebookEmails.actorId === "apify~facebook-pages-scraper");

  const listed = await seed("FB Listed Spine", { contactName: "Dr. Ann Lee", websiteUrl: "https://fblisted.test", facebookUrl: "https://www.facebook.com/fblisted" });
  const nothing = await seed("FB Nothing Chiro", { websiteUrl: "https://fbnothing.test", facebookUrl: "https://www.facebook.com/fbnothing" });
  const vendor = await seed("FB Vendor Clinic", { websiteUrl: "https://fbvendor.test", facebookUrl: "https://www.facebook.com/fbvendor" });
  const has = await seed("Has Email", {
    websiteUrl: "https://hasemail.test",
    facebookUrl: "https://www.facebook.com/fblisted",
    email: "typed@hasemail.test",
    emailSource: "manual",
    emailStatus: "valid",
  });
  const site = await seed("Site Crawl Clinic", {
    websiteUrl: "https://sitecrawl.test",
    facebookUrl: "https://www.facebook.com/fbnothing",
    websiteLinks: JSON.stringify([{ text: "Email us", url: "mailto:office@sitecrawl.test", page: "https://sitecrawl.test/" }]),
  });

  console.log("\nTurned off: nothing is spent");
  await savePipelineSettings(DEFAULT_PIPELINE_SETTINGS);
  const off = await findBackupEmail(nothing.id, await loadPipelineSettings());
  check("skipped, and says where to turn it on", off.kind === "skipped" && /Settings → Pipeline/.test(off.detail), off.detail);
  check("no page was read", apifyCalls.length === 0);
  check("the bulk action refuses", !(await startFacebookEmailJob()).ok);

  await savePipelineSettings({ ...DEFAULT_PIPELINE_SETTINGS, facebookEmails: { enabled: true, actorId: "apify~facebook-pages-scraper" } });
  const settings = await loadPipelineSettings();

  console.log("\nThe website first (free)");
  const siteR = await findBackupEmail(site.id, settings);
  const siteLead = await reload(site.id);
  check("the stored crawl's address is the email", siteR.kind === "found" && siteLead.email === "office@sitecrawl.test", siteR.detail);
  check("source Site crawl, not checked", siteLead.emailSource === "site_crawl" && siteLead.emailStatus === null);
  check("and no Facebook page was read for it", apifyCalls.length === 0);

  console.log("\nAn existing email is never touched");
  const hasR = await findBackupEmail(has.id, settings);
  const hasLead = await reload(has.id);
  check("skipped quietly", hasR.kind === "skipped" && hasR.quiet === true);
  check("email, source and status unchanged; no page read", hasLead.email === "typed@hasemail.test" && hasLead.emailSource === "manual" && hasLead.emailStatus === "valid" && apifyCalls.length === 0);

  console.log("\nThe bulk action");
  const eligible = await facebookEmailLeads();
  const names = eligible.map((l) => l.clinicName).sort();
  check(
    "lists the three with no email and an unread page — not the one with an email, not the one the website filled",
    names.length === 3 && names.every((n) => /FB (Listed|Nothing|Vendor)/.test(n)),
    names.join(", "),
  );
  check("the estimate is per page", fmtEstimate(facebookEmailsCost(eligible.length)) === "~$0.03", fmtEstimate(facebookEmailsCost(eligible.length)));
  const started = await startFacebookEmailJob();
  check("starts in the shared job runner", started.ok, started.ok ? "" : started.error);
  const run = await waitFor("facebook-emails");
  check("finished, 1 found", run.status === "finished" && /^1 email found/.test(run.note ?? ""), `${run.status}: ${run.note}`);
  check("each page read once", apifyCalls.length === 3 && new Set(apifyCalls).size === 3, apifyCalls.join(", "));

  const listedLead = await reload(listed.id);
  const listedAlts = parseAlternates(listedLead.emailAlternates);
  check("page lists an email → saved", listedLead.email === "drlee@fblisted.test", String(listedLead.email));
  check("labelled owner (it carries Dr. Lee's name)", listedLead.emailType === "owner");
  check("source Facebook page", listedLead.emailSource === "facebook_page" && EMAIL_SOURCE_LABELS.facebook_page === "Facebook page");
  check(
    "the front-desk address is an alternate, labelled generic",
    listedAlts.length === 1 && listedAlts[0].address === "frontdesk@fblisted.test" && listedAlts[0].type === "generic" && listedAlts[0].source === "facebook_page",
    listedLead.emailAlternates ?? "null",
  );
  check("the address in a post was not read", !/pixelwebdesigns/.test(`${listedLead.email} ${listedLead.emailAlternates}`));
  check("the page is marked read", listedLead.facebookEmailAt !== null);

  const nothingLead = await reload(nothing.id);
  check("page lists no email → still no email, page marked read", nothingLead.email === null && nothingLead.emailSource === null && nothingLead.facebookEmailAt !== null);

  const vendorLead = await reload(vendor.id);
  check("web-vendor and builder addresses dropped → no email", vendorLead.email === null && vendorLead.emailAlternates === null && vendorLead.facebookEmailAt !== null, String(vendorLead.email));

  console.log("\nThe Instantly check, automatically");
  const check1 = await waitFor("email-check");
  check("an email check ran when the bulk action finished", check1.status === "finished", `${check1.status}: ${check1.note}`);
  check("the Facebook address and the website one were checked", checked.includes("drlee@fblisted.test") && checked.includes("office@sitecrawl.test"), checked.join(", "));
  check("the address someone typed was not re-checked", !checked.includes("typed@hasemail.test"));
  check("the Facebook address is valid now", (await reload(listed.id)).emailStatus === "valid");

  console.log("\nA page is read once");
  const before = apifyCalls.length;
  const again = await findBackupEmail(nothing.id, settings);
  check("already read: skipped, no new run", again.kind === "skipped" && apifyCalls.length === before, again.detail);
  check("and the bulk action has nothing left", (await facebookEmailLeads()).length === 0);

  console.log("\nPromotion");
  const crawlCand = await prisma.discoveryCandidate.create({
    data: {
      clinicName: `${TAG} — Promoted By Website`,
      channel: "email",
      status: "PENDING",
      websiteUrl: "https://bywebsite.test",
      websiteNotes: "Call us or write to appointments@bywebsite.test — we reply within a day.",
    },
  });
  const crawlLeadId = await promoteToLead(crawlCand.id, null, new Date());
  const crawlLead = await reload(crawlLeadId);
  check("no Maps email: the stored crawl's address comes across, source Site crawl", crawlLead.email === "appointments@bywebsite.test" && crawlLead.emailSource === "site_crawl", String(crawlLead.email));

  const fbCand = await prisma.discoveryCandidate.create({
    data: { clinicName: `${TAG} — FB Promoted Clinic`, channel: "email", status: "PENDING", websiteUrl: "https://fbpromoted.test", facebookUrl: "https://www.facebook.com/fbpromoted" },
  });
  const fbLeadId = await promoteToLead(fbCand.id, null, new Date());
  check("nothing from Maps or the website: no email yet", (await reload(fbLeadId)).email === null);
  await autoFindBackupEmail(fbLeadId);
  const fbLead = await reload(fbLeadId);
  check("then its Facebook page is read and the address saved", fbLead.email === "info@fbpromoted.test" && fbLead.emailSource === "facebook_page", String(fbLead.email));
  check("and it is waiting for (or has had) the Instantly check", fbLead.emailStatus !== null || (await uncheckedEmailLeads()).some((l) => l.id === fbLeadId));

  console.log("\nThe contact-form link");
  const links = (list: [string, string][]) => JSON.stringify(list.map(([text, url]) => ({ text, url, page: "https://clinic.test/" })));
  const withContact = links([
    ["Book Now", "https://clinic.test/book-now"],
    ["Schedule Appointment", "https://clinic.test/schedule"],
    ["Contact Us", "https://www.clinic.test/contact-us/"],
    ["Our booking partner", "https://janeapp.com/clinic"],
  ]);
  check("'Contact Us' is picked, over the booking links found before it", pickContactFormLink(withContact, "https://clinic.test") === "https://www.clinic.test/contact-us/");
  const scheduleOnly = links([
    ["About", "https://clinic.test/about"],
    ["Book online", "https://janeapp.com/clinic"],
    ["Schedule Appointment", "https://clinic.test/new-patients/schedule-appointment"],
  ]);
  check("only 'Schedule Appointment' → that one; the other domain's booking page is not", pickContactFormLink(scheduleOnly, "https://www.clinic.test/") === "https://clinic.test/new-patients/schedule-appointment");
  check("matched on the path too", pickContactFormLink(links([["Get in touch", "https://clinic.test/contact"]]), "clinic.test") === "https://clinic.test/contact");
  const neither = links([
    ["Home", "https://clinic.test/"],
    ["Facebook", "https://facebook.com/clinic"],
    ["Email us", "mailto:info@clinic.test"],
    ["Contact", "https://wixsite.com/contact"],
  ]);
  check("neither → no button", pickContactFormLink(neither, "https://clinic.test") === null);
  check("no stored links, or no website → no button", pickContactFormLink(null, "https://clinic.test") === null && pickContactFormLink(withContact, null) === null);

  console.log("\nCopy message");
  const base = { clinicName: "Lake Spine", contactName: "Dr. Mia Park", contactTitle: null, websiteNotes: null };
  const S = DEFAULT_EMAIL_SETTINGS;
  const approvedDesk = frontDeskMessage(
    { ...base, emailVersion: "front_desk", emailSubject: "Edited subject", emailBody: "Hi Lake Spine team,\n\nEdited body.\n\n{sender}", emailOpener: "x", emailApprovedAt: new Date() },
    S,
    "Hamdi",
  );
  check("approved front-desk email → copied as approved, signed", approvedDesk.subject === "Edited subject" && approvedDesk.body.endsWith("Hamdi") && approvedDesk.body.includes("Edited body."), approvedDesk.body);
  const opener = "I noticed you offer decompression on the DRX9000.";
  const approvedOwner = frontDeskMessage(
    { ...base, emailVersion: "owner", emailSubject: "Owner subject", emailBody: "Hi Dr. Park,\n\nOwner body.", emailOpener: opener, emailApprovedAt: new Date() },
    S,
    "Hamdi",
  );
  const expected = renderEmail(S, base, "front_desk", opener);
  check("approved owner email → the front-desk template, with the approved opener", approvedOwner.subject === expected.subject && approvedOwner.body.includes(opener) && approvedOwner.body.startsWith("Hi Lake Spine team,") && !approvedOwner.body.includes("Owner body"), approvedOwner.body);
  const none = frontDeskMessage({ ...base, emailVersion: null, emailSubject: null, emailBody: null, emailOpener: opener, emailApprovedAt: null }, S, "Hamdi");
  check("nothing approved → the front-desk template without an opener", !none.body.includes(opener) && !none.body.includes("{opener}") && none.body.startsWith("Hi Lake Spine team,") && !/\n{3,}/.test(none.body), none.body);
  check("and no {sender} left in it", !none.body.includes("{sender}") && none.body.includes("Hamdi"));

  console.log("\nMark form sent");
  const sendsBefore = await prisma.emailSend.count({ where: { leadId: nothing.id } });
  const statusBefore = await reload(nothing.id);
  const marked = await markContactFormSent(nothing.id);
  const log = await prisma.activityLog.findFirst({ where: { leadId: nothing.id, kind: "CONTACT_FORM_SENT" } });
  const task = await prisma.task.findFirst({ where: { leadId: nothing.id } });
  const now = new Date();
  const due = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 3));
  check("marked", marked.ok);
  check("logged in the activity feed with the date", !!log && /^Contact form sent to .+ on [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(log.summary), log?.summary);
  check("a task to call the clinic in 3 days", !!task && /^Call /.test(task.title) && task.status === "TODO" && task.dueDate?.getTime() === due.getTime(), `${task?.title} ${task?.dueDate?.toISOString()}`);
  const after = await reload(nothing.id);
  check(
    "the email sequence is untouched",
    (await prisma.emailSend.count({ where: { leadId: nothing.id } })) === sendsBefore && after.stage === statusBefore.stage && after.emailApprovedAt === statusBefore.emailApprovedAt,
  );

  await clean();
  await prisma.activityLog.deleteMany({ where: { kind: "CONTACT_FORM_SENT" } });
  await savePipelineSettings(DEFAULT_PIPELINE_SETTINGS);
  await prisma.$disconnect();
  server.close();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
