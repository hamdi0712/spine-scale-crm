// Pages only read: opening Pipeline or a lead writes nothing and starts no
// job. A lead's inbox is given by the write that makes it Ready and taken
// back by the one that stops it being Ready; addresses are checked from the
// writes that create them. And the owner panel says where the owner came from.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-email-reads.ts
//
// Instantly is a local mock that answers "verified" to everything, so a check
// that starts costs nothing and reaches nothing outside this process.

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

// Every address is verified; every call is counted.
const calls: string[] = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if ((req.url ?? "").startsWith("/api/?")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result_count: 0, results: [] }));
      return;
    }
    calls.push(`${req.method} ${req.url}`);
    const email = req.method === "POST" ? (JSON.parse(body || "{}").email as string) : decodeURIComponent((req.url ?? "").split("/").pop() ?? "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", email, verification_status: "verified", catch_all: false, credits: 99, credits_used: 0.25 }));
  });
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.INSTANTLY_API_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.NPI_API_BASE = process.env.INSTANTLY_API_BASE;
  process.env.INSTANTLY_POLL_MS = "50";
  process.env.INSTANTLY_API_KEY = "test-key";
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }

  const fs = await import("node:fs");
  const { prisma } = await import("../src/lib/prisma");
  const wf = await import("../src/lib/emailWorkflow");
  const act = await import("../src/lib/actions/emailWorkflow");
  const { loadEmailView, emailPanelProps, loadLeadEmailState } = await import("../src/lib/emailWorkflowRead");
  const { loadActiveIcp } = await import("../src/lib/icpDefinitionStore");
  const { buildBreakdownV2, finish } = await import("../src/lib/icpScoring");
  const { loadEmailSettings, saveEmailSettingsRow } = await import("../src/lib/emailSettingsStore");
  const { promoteDiscoveryCandidate } = await import("../src/lib/actions/discovery");
  const { updateLead } = await import("../src/lib/actions/leads");
  const { ownerPanelProps } = await import("../src/lib/ownerFind");
  const { syncReadyInboxes } = await import("../src/lib/emailInboxes");

  const TAG = "(reads verify)";
  await prisma.jobRunItem.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.emailCheck.deleteMany();
  await prisma.emailSend.deleteMany();
  await prisma.appSecrets.deleteMany();
  await prisma.lead.updateMany({ data: { sendingInboxId: null } });
  await prisma.sendingInbox.deleteMany();
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: TAG } } });
  await prisma.discoveryCandidate.deleteMany({ where: { clinicName: { endsWith: TAG } } });
  // Only this script's leads on email, so the counts below are its own.
  await prisma.lead.updateMany({ where: { channel: "email" }, data: { channel: "linkedin" } });

  // The playbook copy, so a hand-written opener passes the pre-send check,
  // and a budget with room, so a check would start if anything asked.
  await prisma.emailSettings.deleteMany();
  await prisma.emailSettings.create({ data: { id: wf.EMAIL_SETTINGS_ID, ...wf.emailSettingsRow({ ...wf.DEFAULT_EMAIL_SETTINGS, senderName: "Hamdi" }) } });
  const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261107120000_email_playbook/migration.sql"), "utf8");
  await prisma.$executeRawUnsafe(sql.slice(sql.indexOf("UPDATE")));
  await saveEmailSettingsRow({ ...(await loadEmailSettings()), checkCreditBudget: 100, creditsPerCheck: 1 });
  const hamdi = await prisma.sendingInbox.create({ data: { address: "hamdi@spinescale.co", displayName: "", dailyLimit: 20, position: 0 } });
  const team = await prisma.sendingInbox.create({ data: { address: "team@spinescale.co", displayName: "", dailyLimit: 20, position: 1 } });

  const icp = (await loadActiveIcp())!;
  const card = (clinic: string, dm: string) => {
    const base = buildBreakdownV2({
      icp,
      evidence: { clinicName: clinic, websiteNotes: "Spinal decompression.", websiteUrl: null, metaAdsSignal: null, reviewCount: 40 } as never,
      reply: null, precheck: null, threshold: 60, evidenceLabels: [], notes: [], now: new Date(),
    });
    const cite = [{ quote: "We offer spinal decompression on the DRX9000.", source: "Clinic website" }];
    return JSON.stringify(finish({
      ...base,
      fit: base.fit.map((e) => ({ ...e, points: e.max, citations: cite, source: "assist" as const, shortfall: null, ...(e.key === "title" ? { reason: `${dm}, Owner on the site.` } : {}) })),
      signals: base.signals.map((e) => ({ ...e, points: e.max, shortfall: null })),
    }, 60));
  };
  const OPENER = "Your booking page only takes requests by form. Anyone ready to start waits to hear back.";
  // A Charleston-like lead: owner address, contact set by hand, A-tier, an
  // email drafted and waiting for approval.
  const seed = async (n: string, data: Record<string, unknown> = {}) => {
    const clinicName = `${n} ${TAG}`;
    const l = await prisma.lead.create({
      data: {
        clinicName, stage: "NEW", channel: "email", reviewCount: 40,
        contactName: "Dr. Heath Hishon", contactNameByHand: true,
        email: `drhishon@${n.toLowerCase().replace(/[^a-z]/g, "")}.test`, emailType: "owner", emailStatus: "valid", emailSource: "maps_contacts",
        websiteNotes: "We offer spinal decompression on the DRX9000.", icpBreakdown: card(clinicName, "Dr. Heath Hishon"),
        ...data,
      },
    });
    const r = await act.saveManualOpener(l.id, OPENER);
    if (!r.ok) throw new Error(r.error);
    return l;
  };
  const inboxOf = async (id: string) => (await prisma.lead.findUniqueOrThrow({ where: { id } })).sendingInboxId;
  const withSends = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id }, include: { emailSends: { orderBy: { step: "asc" } } } });
  // A check now runs inside the contact finder (src/lib/contactFinderRun.ts)
  // for email leads; the bare email check is still there for "Check again".
  const CHECKERS = ["email-check", "contact-finder"];
  const checkRuns = () => prisma.jobRun.count({ where: { source: { in: CHECKERS } } });
  const waitForChecks = async () => {
    for (let i = 0; i < 400; i++) {
      await sleep(50);
      if ((await prisma.jobRun.count({ where: { source: { in: CHECKERS }, status: "running" } })) === 0) {
        await sleep(150); // a run's after-hook may start one more
        if ((await prisma.jobRun.count({ where: { source: { in: CHECKERS }, status: "running" } })) === 0) return;
      }
    }
    throw new Error("A check never finished.");
  };

  // ─── Reading writes nothing ──────────────────────────────────────────────
  console.log("\nLoading Pipeline and a lead page");
  const charleston = await seed("Charleston Neck Back");
  // Approved straight in the database, the way a lead that became Ready before
  // this change looks: Ready, and no inbox. The old read path gave it one.
  await prisma.lead.update({ where: { id: charleston.id }, data: { emailApprovedAt: new Date() } });
  // And an address nobody has checked, with a key and budget: the old read
  // path started a check for it.
  const unchecked = await prisma.lead.create({
    data: { clinicName: `Unchecked Clinic ${TAG}`, stage: "NEW", channel: "email", email: "info@unchecked.test", emailType: "generic", emailSource: "maps_contacts" },
  });
  const snapshot = async () =>
    JSON.stringify({
      leads: await prisma.lead.findMany({ orderBy: { id: "asc" } }),
      inboxes: await prisma.sendingInbox.findMany({ orderBy: { id: "asc" } }),
      jobs: await prisma.jobRun.count(),
      jobItems: await prisma.jobRunItem.count(),
      checks: await prisma.emailCheck.count(),
      activity: await prisma.activityLog.count(),
      notes: await prisma.leadNote.count(),
      candidates: await prisma.discoveryCandidate.findMany({ orderBy: { id: "asc" } }),
    });
  const before = await snapshot();
  const view = await loadEmailView();
  const panel = await emailPanelProps(await withSends(charleston.id));
  const state = await loadLeadEmailState(charleston.id);
  await sleep(300); // anything fired and forgotten would have started by now
  check("the Pipeline data loads", view.rows.some((r) => r.id === charleston.id) && view.unchecked >= 1, `${view.rows.length} rows`);
  check("the lead page shows the lead as Ready", panel.status === "ready" && state.status === "ready", `${panel.status}/${state.status}`);
  check("loading Pipeline, the lead panel and the lead's state wrote nothing", (await snapshot()) === before);
  check("and started no job — no check either", (await prisma.jobRun.count()) === 0 && calls.length === 0, `${calls.length} calls to Instantly`);
  check("the Ready lead is shown with no inbox rather than given one on read", panel.inbox === null && (await inboxOf(charleston.id)) === null);
  check("the sweep a job runs at its end gives it one", (await syncReadyInboxes()).assigned === 1 && (await inboxOf(charleston.id)) !== null);
  await prisma.lead.update({ where: { id: unchecked.id }, data: { emailStatus: "valid", emailCheckedAt: new Date() } });

  // ─── Approve gives the inbox, Unapprove takes it back ────────────────────
  console.log("\nApprove and Unapprove");
  await prisma.lead.update({ where: { id: charleston.id }, data: { emailApprovedAt: null, sendingInboxId: null } });
  const first = await seed("First Spine");
  const second = await seed("Second Spine");
  check("before Approve: not Ready, no inbox", (await loadLeadEmailState(first.id)).status === "needs_opener" && (await inboxOf(first.id)) === null);
  const a1 = await act.approveEmail(first.id);
  check("Approve makes it Ready and assigns an inbox", a1.ok && (await loadLeadEmailState(first.id)).status === "ready" && (await inboxOf(first.id)) !== null,
    a1.ok ? `inbox ${a1.inbox?.address ?? "none"}` : a1.error);
  check("Approve hands the inbox back, so the From line shows it at once", a1.ok && a1.inbox !== null && a1.inbox.id === (await inboxOf(first.id)));
  check("and the panel, read next, shows the same inbox", (await emailPanelProps(await withSends(first.id))).inbox?.id === (await inboxOf(first.id)));
  const a2 = await act.approveEmail(second.id);
  check("the next one Ready gets the other inbox (same alternating rule)", a2.ok && a2.inbox !== null && a1.ok && a2.inbox.id !== a1.inbox?.id,
    `${a1.ok ? a1.inbox?.address : "?"} then ${a2.ok ? a2.inbox?.address : "?"}`);
  check("Unapprove works", (await act.unapproveEmail(first.id)).ok);
  check("Unapprove clears the inbox (nothing sent)", (await inboxOf(first.id)) === null);
  await act.approveEmail(first.id);
  check("approving again gives one again", (await inboxOf(first.id)) !== null);

  console.log("\nEvery other way out of Ready, with nothing sent");
  check("saving the draft by hand drops the approval and clears the inbox",
    (await act.saveEmailDraft(first.id, { subject: "Quick question", body: "Hi Dr. Hishon,\n\nA question?\n\n{sender}" })).ok && (await inboxOf(first.id)) === null);
  await act.saveManualOpener(first.id, OPENER);
  await act.approveEmail(first.id);
  check("rewriting the opener clears it too", (await inboxOf(first.id)) !== null && (await act.saveManualOpener(first.id, "Your contact page asks people to call during office hours. Anyone reading at night waits for the morning.")).ok && (await inboxOf(first.id)) === null);
  await act.approveEmail(first.id);
  await prisma.lead.update({ where: { id: first.id }, data: { scoringRejectedAt: new Date(), scoringRejectedReason: "test" } });
  check("a tier or scoring change out of A/B, swept, clears it", (await syncReadyInboxes()).released >= 1 && (await inboxOf(first.id)) === null);
  await prisma.lead.update({ where: { id: first.id }, data: { scoringRejectedAt: null, scoringRejectedReason: null } });
  await syncReadyInboxes();
  check("and back in A/B, Ready again, it gets one", (await inboxOf(first.id)) !== null);

  console.log("\nA contact change, on the lead form");
  const form = (contact: string | null, email: string) => {
    const f = new FormData();
    f.set("clinicName", `First Spine ${TAG}`);
    if (contact) f.set("contactName", contact);
    f.set("email", email);
    f.set("stage", "NEW");
    return f;
  };
  await updateLead(first.id, form(null, "drhishon@firstspine.test"));
  check("a contact that no longer passes takes the lead out of Ready and clears the inbox",
    (await loadLeadEmailState(first.id)).status !== "ready" && (await inboxOf(first.id)) === null, (await loadLeadEmailState(first.id)).status);
  await updateLead(first.id, form("Dr. Heath Hishon", "drhishon@firstspine.test"));
  const fixed = await loadLeadEmailState(first.id);
  check("a contact fix that clears the last blocker makes it Ready and assigns one, no click on Approve",
    fixed.status === "ready" && (await inboxOf(first.id)) !== null, fixed.status);

  console.log("\nAccept risky and Revoke accept");
  const risky = await seed("Risky Spine", { emailStatus: "risky" });
  await prisma.lead.update({ where: { id: risky.id }, data: { emailApprovedAt: new Date() } });
  check("approved but risky: not Ready, no inbox", (await loadLeadEmailState(risky.id)).status === "check_email" && (await inboxOf(risky.id)) === null);
  await act.acceptRiskyEmail(risky.id);
  check("Accept risky makes it Ready and assigns an inbox", (await loadLeadEmailState(risky.id)).status === "ready" && (await inboxOf(risky.id)) !== null);
  await act.revokeRiskyEmail(risky.id);
  check("Revoke accept clears it", (await inboxOf(risky.id)) === null);

  console.log("\nOnce Email 1 has gone, the inbox stays");
  await act.approveEmail(second.id);
  const p2 = await emailPanelProps(await withSends(second.id));
  const sent = await act.markEmailSent(second.id, { step: 0, subject: p2.toSend!.subject, body: p2.toSend!.body, inboxId: p2.toSend!.inboxId });
  const held = await inboxOf(second.id);
  await act.unapproveEmail(second.id);
  check("Unapprove after a send leaves the inbox", sent.ok && held !== null && (await inboxOf(second.id)) === held);
  check("both inboxes were used", new Set([hamdi.id, team.id]).has(held ?? ""));

  // ─── Checks start from the writes that create addresses ──────────────────
  console.log("\nA check starts when an address appears");
  await waitForChecks();
  const card2 = card(`Promoted Clinic ${TAG}`, "Dr. Ann Bee");
  const candidate = await prisma.discoveryCandidate.create({
    data: { clinicName: `Promoted Clinic ${TAG}`, channel: "email", email: "info@promoted.test", status: "REJECTED", icpBreakdown: card2, icpTotal: 80, icpTier: "A", scoringModel: "v2" },
  });
  const runsBefore = await checkRuns();
  try {
    await promoteDiscoveryCandidate(candidate.id);
  } catch (e) {
    // redirect() to the new lead, which a script has no router for.
    if (!/NEXT_REDIRECT/.test(String((e as Error)?.message ?? e))) throw e;
  }
  const promoted = await prisma.lead.findFirstOrThrow({ where: { clinicName: `Promoted Clinic ${TAG}` } });
  for (let i = 0; i < 100 && (await checkRuns()) === runsBefore; i++) await sleep(50);
  check("promoting a candidate with an address starts a check", (await checkRuns()) > runsBefore);
  await waitForChecks();
  check("and the promoted lead's address is checked", (await prisma.lead.findUniqueOrThrow({ where: { id: promoted.id } })).emailStatus === "valid");

  const typed = await prisma.lead.create({ data: { clinicName: `Typed Clinic ${TAG}`, stage: "NEW", channel: "email" } });
  const runsBeforeTyped = await checkRuns();
  const callsBefore = calls.length;
  const f = new FormData();
  f.set("clinicName", `Typed Clinic ${TAG}`);
  f.set("email", "office@typed.test");
  f.set("stage", "NEW");
  await updateLead(typed.id, f);
  for (let i = 0; i < 100 && (await checkRuns()) === runsBeforeTyped; i++) await sleep(50);
  check("saving an email by hand starts a check", (await checkRuns()) > runsBeforeTyped);
  await waitForChecks();
  check("and checks that address", (await prisma.lead.findUniqueOrThrow({ where: { id: typed.id } })).emailStatus === "valid" && calls.length > callsBefore);

  console.log("\nA verdict that makes an approved lead Ready gives it an inbox");
  const waiting = await seed("Waiting Spine", { emailStatus: null });
  await prisma.lead.update({ where: { id: waiting.id }, data: { emailApprovedAt: new Date() } });
  const { checkLeadEmail } = await import("../src/lib/emailCheckRun");
  const v = await checkLeadEmail(waiting.id);
  check("the check comes back valid, the lead is Ready, and it has an inbox — no click",
    v.kind === "checked" && (await loadLeadEmailState(waiting.id)).status === "ready" && (await inboxOf(waiting.id)) !== null);

  console.log("\nNo key, no check — and no noise");
  await waitForChecks();
  delete process.env.INSTANTLY_API_KEY;
  const quiet = await prisma.lead.create({ data: { clinicName: `Quiet Clinic ${TAG}`, stage: "NEW", channel: "email" } });
  const runsQuiet = await checkRuns();
  const fq = new FormData();
  fq.set("clinicName", `Quiet Clinic ${TAG}`);
  fq.set("email", "hi@quiet.test");
  fq.set("stage", "NEW");
  await updateLead(quiet.id, fq);
  await sleep(300);
  await waitForChecks();
  const quietLead = await prisma.lead.findUniqueOrThrow({ where: { id: quiet.id } });
  check("with no Instantly key the save goes through, nothing is checked, and no noise: it waits quietly",
    quietLead.email === "hi@quiet.test" && quietLead.emailStatus === null && quietLead.contactStatus === "finding", `${quietLead.contactStatus} ${runsQuiet}`);
  process.env.INSTANTLY_API_KEY = "test-key";

  // ─── The owner panel ─────────────────────────────────────────────────────
  console.log("\nWhere the owner came from");
  const ownerOf = (extra: Record<string, unknown>) =>
    ownerPanelProps({
      id: "x", contactName: "Dr. Heath Hishon", contactNameByHand: false, channel: "email", websiteUrl: "https://charlestonneckandback.com",
      emailStatus: "valid", ownerStatus: null, ownerSource: null, ownerSiteNames: null, ownerCheckedAt: null, ownerEmailAt: null,
      npiNumber: null, npiOfficialName: null, npiOfficialTitle: null, email: "drhishon@yahoo.com", emailType: "owner", emailAlternates: null,
      ...extra,
    });
  const hand = ownerPanelProps(await prisma.lead.findUniqueOrThrow({ where: { id: charleston.id } }));
  check("a hand-set owner (Charleston: never looked up) is not \"Not looked up\"", hand.statusLabel !== "Not looked up", hand.statusLabel);
  check("it reads Owner confirmed · Dr. Heath Hishon · set by hand",
    hand.statusLabel === "Owner confirmed" && hand.owner === "Dr. Heath Hishon" && hand.basisLabel === "set by hand", `${hand.statusLabel} · ${hand.owner} · ${hand.basisLabel}`);
  check("settled, so Find owner is hidden (Look up again instead) and there is no owner email to find", hand.basisLabel !== null && !hand.canFindEmail);
  check("confirmed by NPI", ownerOf({ ownerStatus: "confirmed", ownerSource: "npi_site" }).basisLabel === "confirmed by NPI" && ownerOf({ ownerStatus: "confirmed", ownerSource: "npi" }).basisLabel === "confirmed by NPI");
  check("from site", ownerOf({ ownerStatus: "confirmed", ownerSource: "site" }).basisLabel === "from site");
  check("picked by hand from the choices reads set by hand", ownerOf({ ownerStatus: "confirmed", ownerSource: "manual" }).basisLabel === "set by hand");
  check("from the email address: drhishon@ for Dr. Heath Hishon, not set by hand", ownerOf({}).basisLabel === "from the email address");
  const none = ownerOf({ email: "info@charlestonneckandback.com", emailType: "generic" });
  check("nothing to go on: Not looked up, and Find owner stays", none.basisLabel === null && none.statusLabel === "Not looked up");
  check("an address naming someone else is not the owner's", ownerOf({ email: "drottomeyer@yahoo.com" }).basisLabel === null);
  check("two names to pick between is not settled, even with a contact typed", ownerOf({ ownerStatus: "pick", contactNameByHand: true }).basisLabel === null);

  await waitForChecks();
  server.close();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
