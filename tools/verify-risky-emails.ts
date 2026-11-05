// Risky (catch-all) addresses accepted by hand, on seeded leads.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-risky-emails.ts
//
// A found risky info@ accepted → Ready; revoked → out of Ready; a guessed
// risky address gets no Accept; Check again is gone on risky; over the risky
// daily limit is counted (the page asks, the server allows); and an accepted
// risky address that bounces flags the other accepted leads on its domain —
// out of Ready before Email 1, follow-ups paused mid-sequence — until kept.

import Module from "node:module";
import path from "node:path";

const CACHE_STUB = path.join(__dirname, "next-cache-stub.cjs");
const DEEPSEEK_STUB = path.join(__dirname, "deepseek-json-stub.cjs");
type Resolver = (request: string, ...args: unknown[]) => string;
const resolveFilename = (Module as unknown as { _resolveFilename: Resolver })._resolveFilename;
(Module as unknown as { _resolveFilename: Resolver })._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "next/cache") return CACHE_STUB;
  if (request === "@/lib/deepseek") return DEEPSEEK_STUB;
  return resolveFilename.call(this, request, ...args);
};

let failures = 0;
function check(label: string, passed: boolean, detail = ""): void {
  if (!passed) failures++;
  console.log(`  ${passed ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const DAY = 86_400_000;

async function main(): Promise<void> {
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  const { loadActiveIcp } = await import("../src/lib/icpDefinitionStore");
  const { buildBreakdownV2, finish } = await import("../src/lib/icpScoring");
  const wf = await import("../src/lib/emailWorkflow");
  const act = await import("../src/lib/actions/emailWorkflow");
  const { loadLeadEmailState, emailPanelProps } = await import("../src/lib/emailWorkflowRead");

  await prisma.emailSend.deleteMany();
  await prisma.suppression.deleteMany();
  await prisma.emailSettings.deleteMany();
  await prisma.lead.updateMany({ data: { sendingInboxId: null } });
  await prisma.sendingInbox.deleteMany();
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: "(risky verify)" } } });
  const inbox = await prisma.sendingInbox.create({ data: { address: "hamdi@spinescale.co", displayName: "Hamdi", dailyLimit: 50, position: 0 } });

  const icp = (await loadActiveIcp())!;
  const card = (clinic: string) => {
    const base = buildBreakdownV2({
      icp,
      evidence: { clinicName: clinic, websiteNotes: "Spinal decompression.", websiteUrl: null, metaAdsSignal: null, reviewCount: 40 } as never,
      reply: null, precheck: null, threshold: 60, evidenceLabels: [], notes: [], now: new Date(),
    });
    const cite = [{ quote: "We offer spinal decompression.", source: "Clinic website" }];
    return JSON.stringify(finish({
      ...base,
      fit: base.fit.map((e) => ({ ...e, points: e.max, citations: cite, source: "assist" as const, shortfall: null })),
      signals: base.signals.map((e) => ({ ...e, points: e.max, shortfall: null })),
    }, 60));
  };
  const name = (n: string) => `${n} (risky verify)`;
  const seed = (n: string, data: Record<string, unknown>) =>
    prisma.lead.create({
      data: {
        clinicName: name(n), stage: "NEW", channel: "email", reviewCount: 40, contactName: null,
        emailType: "generic", emailStatus: "risky", icpBreakdown: card(name(n)),
        emailSubject: "Quick question", emailBody: "Hi team,\n\nA question.\n\n{sender}", emailApprovedAt: new Date(),
        ...data,
      },
    });
  const status = async (id: string, now = new Date()) => (await loadLeadEmailState(id, now)).status;
  const panel = async (id: string) =>
    emailPanelProps(await prisma.lead.findUniqueOrThrow({ where: { id }, include: { emailSends: { orderBy: { step: "asc" } } } }));

  console.log("\nAccept and revoke");
  const asj = await seed("American Spine And Joint", { email: "info@americanspineandjoint.com", emailSource: "site_crawl", websiteUrl: "https://americanspineandjoint.com" });
  check("a risky, found address starts on Check email", (await status(asj.id)) === "check_email");
  let p = await panel(asj.id);
  check("Accept risky is offered, and Check again is not", p.risky.isRisky && p.risky.canAccept && !p.risky.accepted);
  check("Mark sent is refused before accepting", !(await act.markEmailSent(asj.id, { step: 0, subject: "x", body: "y" })).ok);
  check("Accept risky works", (await act.acceptRiskyEmail(asj.id)).ok);
  check("accepted → Ready", (await status(asj.id)) === "ready");
  check("and logged in the activity feed", (await prisma.activityLog.count({ where: { leadId: asj.id, kind: "EMAIL_RISKY_ACCEPTED" } })) === 1);
  p = await panel(asj.id);
  check("the email to send carries the Risky tag", p.toSend?.risky === true);
  check("Revoke accept works", (await act.revokeRiskyEmail(asj.id)).ok);
  check("revoked → back out of Ready", (await status(asj.id)) === "check_email");
  check("and logged", (await prisma.activityLog.count({ where: { leadId: asj.id, kind: "EMAIL_RISKY_REVOKED" } })) === 1);
  check("the approval was kept throughout", (await prisma.lead.findUniqueOrThrow({ where: { id: asj.id } })).emailApprovedAt !== null);
  await act.acceptRiskyEmail(asj.id);
  await prisma.lead.update({ where: { id: asj.id }, data: { email: "office@americanspineandjoint.com" } });
  check("a changed address drops the old acceptance", (await status(asj.id)) === "check_email");
  await prisma.lead.update({ where: { id: asj.id }, data: { email: "info@americanspineandjoint.com" } });

  console.log("\nWhich addresses may be accepted");
  const guessed = await seed("Guessed Clinic", { email: "drsmith@guessed.test", emailSource: "pattern_guess" });
  p = await panel(guessed.id);
  check("a guessed risky address gets no Accept button", p.risky.isRisky && !p.risky.canAccept);
  check("and the server refuses it", !(await act.acceptRiskyEmail(guessed.id)).ok);
  for (const [src, ok] of [["maps_contacts", true], ["facebook_page", true], ["hunter", true], ["manual", true], ["extractor", true],
    ["hunter_inferred", false], ["name_pattern", false], ["imported", false], [null, false]] as const) {
    check(`source ${src ?? "(none)"} → ${ok ? "acceptable" : "not acceptable"}`,
      wf.canAcceptRisky({ email: "a@b.test", emailStatus: "risky", emailSource: src }) === ok);
  }

  console.log("\nThe risky daily limit");
  await prisma.emailSettings.upsert({ where: { id: wf.EMAIL_SETTINGS_ID }, update: { riskyDailyLimit: 1 }, create: { id: wf.EMAIL_SETTINGS_ID, ...wf.emailSettingsRow({ ...wf.DEFAULT_EMAIL_SETTINGS, riskyDailyLimit: 1 }) } });
  const r1 = await seed("Risky One", { email: "info@riskyone.test", emailSource: "maps_contacts" });
  const r2 = await seed("Risky Two", { email: "info@riskytwo.test", emailSource: "maps_contacts" });
  await act.acceptRiskyEmail(r1.id);
  await act.acceptRiskyEmail(r2.id);
  p = await panel(r1.id);
  const s1 = await act.markEmailSent(r1.id, { step: 0, subject: p.toSend!.subject, body: p.toSend!.body, inboxId: p.toSend!.inboxId });
  check("first risky send goes through", s1.ok);
  check("and is recorded as risky", (await prisma.emailSend.findFirstOrThrow({ where: { leadId: r1.id } })).risky);
  p = await panel(r2.id);
  check("the next one is over the limit — the page will ask", p.toSend?.risky === true && p.inboxRiskySentToday >= p.riskyLimit, `${p.inboxRiskySentToday} of ${p.riskyLimit}`);
  const s2 = await act.markEmailSent(r2.id, { step: 0, subject: p.toSend!.subject, body: p.toSend!.body, inboxId: p.toSend!.inboxId });
  check("and continuing anyway is allowed", s2.ok);

  console.log("\nA bounce on a catch-all domain");
  const domain = "catchall.test";
  const a = await seed("Catchall A", { email: `info@${domain}`, emailSource: "site_crawl" });
  const b = await seed("Catchall B", { email: `frontdesk@${domain}`, emailSource: "maps_contacts" });
  const c = await seed("Catchall C", { email: `billing@${domain}`, emailSource: "facebook_page" });
  const d = await seed("Catchall D not accepted", { email: `hello@${domain}`, emailSource: "site_crawl" });
  for (const l of [a, b, c]) await act.acceptRiskyEmail(l.id);
  // C is mid-sequence: Email 1 went four days ago.
  await prisma.emailSend.create({ data: { leadId: c.id, step: 0, toEmail: `billing@${domain}`, inboxId: inbox.id, subject: "Quick question", body: "x", sentAt: new Date(Date.now() - 4 * DAY), risky: true } });
  await prisma.lead.update({ where: { id: c.id }, data: { sendingInboxId: inbox.id } });
  check("before: B Ready, C has a follow-up due", (await status(b.id)) === "ready" && (await panel(c.id)).toSend?.step === 1);
  await prisma.emailSend.create({ data: { leadId: a.id, step: 0, toEmail: `info@${domain}`, inboxId: inbox.id, subject: "Quick question", body: "x", risky: true } });
  check("A bounces", (await act.markEmailBounced(a.id)).ok);
  const aAfter = await prisma.lead.findUniqueOrThrow({ where: { id: a.id } });
  check("handled like any bounce: No email, address in the alternates", aAfter.email === null && (aAfter.emailAlternates ?? "").includes(`info@${domain}`) && (await status(a.id)) === "no_email");
  check("the bounce is logged", (await prisma.activityLog.count({ where: { leadId: a.id, kind: "EMAIL_BOUNCED" } })) === 1);
  const bAfter = await prisma.lead.findUniqueOrThrow({ where: { id: b.id } });
  check("B (accepted, same domain) is flagged", bAfter.emailRiskyFlaggedAt !== null, bAfter.emailRiskyFlagReason ?? "");
  check("and out of Ready", (await status(b.id)) === "check_email");
  check("C (mid-sequence) is flagged, its follow-up paused", (await panel(c.id)).toSend === null && (await panel(c.id)).sendBlocked === null &&
    "blocked" in wf.sendBlocker(await prisma.lead.findUniqueOrThrow({ where: { id: c.id } }), "A", [{ step: 0, sentAt: new Date(Date.now() - 4 * DAY) }], wf.DEFAULT_EMAIL_SETTINGS, new Date()));
  check("D (not accepted) is not flagged", (await prisma.lead.findUniqueOrThrow({ where: { id: d.id } })).emailRiskyFlaggedAt === null);
  check("each flag is logged", (await prisma.activityLog.count({ where: { kind: "EMAIL_RISKY_FLAGGED", leadId: { in: [b.id, c.id] } } })) === 2);
  check("Reviewed – keep on B", (await act.keepFlaggedRiskyEmail(b.id)).ok && (await status(b.id)) === "ready");
  check("Revoke on C keeps its follow-ups paused", (await act.revokeRiskyEmail(c.id)).ok && (await panel(c.id)).toSend === null);
  check("re-accept on C resumes them", (await act.acceptRiskyEmail(c.id)).ok && (await panel(c.id)).toSend?.step === 1);

  await prisma.emailSend.deleteMany();
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: "(risky verify)" } } });
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
