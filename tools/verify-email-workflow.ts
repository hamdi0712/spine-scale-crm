// The cold email workflow, end to end, on seeded leads.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-email-workflow.ts
//
// The model is scripted (tools/deepseek-json-stub.cjs), so nothing is spent.
// Seeds an owner email, a front-desk email, a contact mismatch, a disqualified
// lead, a lead whose evidence is too thin for an observation, and a bad
// address; then drives them through drafting (the made-up-stats check, the
// gap-as-a-question rule, the curiosity fallback), checked addresses,
// approval, the contact pick, sending by hand, follow-ups coming due, a
// bounce, an unsubscribe and a not-interested reply — and checks the
// suppression list holds on every channel.

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
const note = { evidence: "the site", uncertainty: "none", stage: "cold" };

async function main(): Promise<void> {
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const stub = require(DEEPSEEK_STUB) as { setReplies: (m: Record<string, unknown>) => void };
  const { loadActiveIcp } = await import("../src/lib/icpDefinitionStore");
  const { buildBreakdownV2, finish } = await import("../src/lib/icpScoring");
  const wf = await import("../src/lib/emailWorkflow");
  const act = await import("../src/lib/actions/emailWorkflow");
  const { loadLeadEmailState, loadEmailView } = await import("../src/lib/emailWorkflowRead");
  const { loadEmailSettings } = await import("../src/lib/emailSettingsStore");
  const { generateOutreachStep, markMessageSent } = await import("../src/lib/actions/outreachSequence");
  const { importClinicDiscoveryCandidates } = await import("../src/lib/actions/clinicDiscovery");
  const { processDiscoveryCandidate } = await import("../src/lib/actions/discovery");
  const { promoteToLead, SuppressedError } = await import("../src/lib/promoteLead");

  // A clean slate for what this script writes.
  await prisma.emailSend.deleteMany();
  await prisma.suppression.deleteMany();
  await prisma.emailSettings.deleteMany();
  // Two sending inboxes, 1 a day each so going over is easy to see.
  await prisma.lead.updateMany({ data: { sendingInboxId: null } });
  await prisma.sendingInbox.deleteMany();
  const hamdi = await prisma.sendingInbox.create({ data: { address: "hamdi@spinescale.co", displayName: "", dailyLimit: 1, position: 0 } });
  const team = await prisma.sendingInbox.create({ data: { address: "team@spinescale.co", displayName: "", dailyLimit: 1, position: 1 } });
  await prisma.task.deleteMany({ where: { title: { startsWith: "Reply to" } } });
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: "(email verify)" } } });
  await prisma.discoveryCandidate.deleteMany({ where: { clinicName: { endsWith: "(email verify)" } } });

  // ─── Scorecards ──────────────────────────────────────────────────────────
  const icp = (await loadActiveIcp())!;
  const card = (clinic: string, decisionMaker: string | null) => {
    const base = buildBreakdownV2({
      icp,
      evidence: { clinicName: clinic, websiteNotes: "Spinal decompression.", websiteUrl: null, metaAdsSignal: null, reviewCount: 40 } as never,
      reply: null,
      precheck: null,
      threshold: 60,
      evidenceLabels: [],
      notes: [],
      now: new Date(),
    });
    const cite = [{ quote: "We offer spinal decompression on the DRX9000.", source: "Clinic website" }];
    return JSON.stringify(
      finish(
        {
          ...base,
          fit: base.fit.map((e) => ({
            ...e,
            points: e.max,
            citations: cite,
            source: "assist" as const,
            shortfall: null,
            ...(e.key === "title"
              ? { reason: decisionMaker ? `${decisionMaker}, Owner on the site — named on the About page.` : "Nobody named.", points: decisionMaker ? e.max : 0 }
              : {}),
          })),
          signals: base.signals.map((e, i) => ({ ...e, points: e.max, shortfall: i === 0 ? "online booking not found on the pages read" : null })),
        },
        60,
      ),
    );
  };

  const name = (n: string) => `${n} (email verify)`;
  const notes = "Welcome to the clinic. We offer spinal decompression on the DRX9000 and laser therapy. Call (512) 555-0100 to book.";
  const seed = (n: string, data: Record<string, unknown>) =>
    prisma.lead.create({ data: { clinicName: name(n), stage: "NEW", channel: "email", websiteNotes: notes, reviewCount: 40, ...data } });

  const owner = await seed("Owner Spine", {
    contactName: "Dr. Jane Smith",
    email: "drsmith@ownerspine.test",
    emailType: "owner",
    websiteUrl: "https://ownerspine.test",
    icpBreakdown: card(name("Owner Spine"), "Dr. Jane Smith"),
  });
  const desk = await seed("Front Desk Clinic", {
    contactName: "Dr. Amy Lee",
    email: "info@frontdesk.test",
    emailType: "generic",
    websiteUrl: "https://frontdesk.test",
    icpBreakdown: card(name("Front Desk Clinic"), "Dr. Amy Lee"),
  });
  const mismatch = await seed("Mismatch Clinic", {
    contactName: "Mark Jones",
    email: "mark@mismatch.test",
    emailType: "owner",
    websiteUrl: "https://mismatch.test",
    icpBreakdown: card(name("Mismatch Clinic"), "Dr. Jane Doe"),
  });
  const dq = await seed("Disqualified Clinic", {
    contactName: "Dr. Sam Park",
    email: "sam@dq.test",
    emailType: "owner",
    icpDqSurgicalPractice: true,
    icpDqTriggered: "surgical",
    icpScoredAt: new Date(),
  });
  const thin = await seed("Thin Clinic", { contactName: null, email: "hello@thin.test", emailType: "generic", icpBreakdown: null });
  const bad = await seed("Bad Address Clinic", { contactName: "Dr. Kim Ray", email: "info@bad.test", emailType: "generic" });

  // Your name, for {sender}: until it is set, an email cannot be approved.
  const reload = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id }, include: { emailSends: { orderBy: { step: "asc" } } } });
  const settings = await loadEmailSettings();
  const state = (id: string, now = new Date()) => loadLeadEmailState(id, now);

  console.log("\nStarter copy");
  check("every template starts as starter copy, so the banner shows", wf.startersRemaining(settings).length === 8, wf.startersRemaining(settings).join(", "));

  console.log("\nDrafting the opener");
  stub.setReplies({
    // First answer invents a stat; the second is clean.
    [name("Owner Spine")]: [
      { opener: "Most clinics your size lose 30% of decompression leads.", basis: "cited", ...note },
      { opener: "I noticed Owner Spine (email verify) runs spinal decompression on the DRX9000 alongside laser therapy.", basis: "cited", ...note },
    ],
    // First answer states a gap as a fact; the second asks about it.
    [name("Front Desk Clinic")]: [
      { opener: "I didn't see a way to book online on your site.", basis: "gap", ...note },
      { opener: "I couldn't tell from the site how a new patient books outside office hours, is that by phone?", basis: "gap", ...note },
    ],
    [name("Mismatch Clinic")]: { opener: "I noticed the clinic offers spinal decompression alongside laser therapy.", basis: "cited", ...note },
    [name("Disqualified Clinic")]: { opener: "I noticed the clinic offers spinal decompression alongside laser therapy.", basis: "cited", ...note },
    // Nothing to observe: the curiosity fallback.
    [name("Thin Clinic")]: [
      { opener: null, basis: null, ...note },
      { detail: "both spinal decompression and laser therapy under one roof", painSignal: null, ...note },
    ],
  });
  const o1 = await act.generateEmailOpener(owner.id);
  let ownerLead = await reload(owner.id);
  check("a made-up stat is rejected and asked for again", o1.ok && !/30%|most clinics/i.test(ownerLead.emailOpener ?? ""), ownerLead.emailOpener ?? JSON.stringify(o1));
  check("and the redraft naming the DRX9000 from their site is kept", (ownerLead.emailOpener ?? "").includes("DRX9000"));
  check("owner email → owner-direct version, greeted by salutation()", ownerLead.emailVersion === "owner" && (ownerLead.emailBody ?? "").startsWith("Hi Dr. Smith,"), ownerLead.emailBody?.split("\n")[0]);
  check("the email is subject, greeting, opener, body, opt-out and sign-off",
    ownerLead.emailSubject === `Quick question about ${name("Owner Spine")}` &&
      (ownerLead.emailBody ?? "").includes(ownerLead.emailOpener ?? "@@") &&
      (ownerLead.emailBody ?? "").trim().endsWith(`${wf.STARTER_OPT_OUT}\n\n${wf.STARTER_SIGN_OFF}`));
  const o2 = await act.generateEmailOpener(desk.id);
  const deskLead = await reload(desk.id);
  check("a gap stated as fact is rejected; the question is kept", o2.ok && (deskLead.emailOpener ?? "").endsWith("?"), deskLead.emailOpener ?? JSON.stringify(o2));
  check("front-desk email → front-desk version, greeting the team and naming the contact",
    deskLead.emailVersion === "front_desk" &&
      (deskLead.emailBody ?? "").startsWith(`Hi ${name("Front Desk Clinic")} team,`) &&
      (deskLead.emailBody ?? "").includes("pass this to Dr. Lee") &&
      (deskLead.emailBody ?? "").includes("{sender}"),
    deskLead.emailBody?.split("\n").slice(0, 3).join(" / "));
  check("the gate itself: a gap as a statement fails, as a question passes",
    (await import("../src/lib/outreachSequence")).gapAsStatementReason("Your site has no online booking.", "gap") !== null &&
      (await import("../src/lib/outreachSequence")).gapAsStatementReason("I couldn't find online booking, is that by phone?", "gap") === null);
  const o3 = await act.generateEmailOpener(thin.id);
  const thinLead = await reload(thin.id);
  check("thin evidence falls back to the curiosity question", o3.ok && thinLead.emailOpenerMechanism === "curiosity_process" &&
    (thinLead.emailOpener ?? "").includes("both spinal decompression and laser therapy under one roof"), thinLead.emailOpener ?? JSON.stringify(o3));
  await act.generateEmailOpener(mismatch.id);
  await act.generateEmailOpener(dq.id);

  console.log("\nThe made-up-stats check and product names");
  const { inventedStatsReason } = await import("../src/lib/outreachSequence");
  const site = {
    clinicName: "Owner Spine",
    websiteNotes: "We treat disc pain on the DRX9000 and the X3-Laser. Serving Austin for 30 years. Call (512) 555-0100.",
    reviewCount: 40,
  };
  const allowed = (line: string) => inventedStatsReason(line, site) === null;
  check("a product name on the clinic's own site is allowed (DRX9000)", allowed("I noticed you offer decompression on the DRX9000."));
  check("so is one with a hyphen (X3-Laser)", allowed("I saw the X3-Laser on your site."));
  check("the same product name is blocked when the site doesn't mention it", !allowed("I noticed you run the DRX7000."));
  check("a bare number is still blocked, even one that is on the site", !allowed("You've served Austin for 30 years."));
  check("a percentage is still blocked", !allowed("Clinics lose 30% of DRX9000 leads."));
  check("a dollar amount is still blocked", !allowed("The DRX9000 is a $5k a month opportunity."));
  check("a count is still blocked", !allowed("The DRX9000 could bring in 12 more patients a month."));
  check("a comparison is still blocked", !allowed("You run the DRX9000, unlike most clinics."));
  check("the review count is still allowed", allowed("I saw your 40 Google reviews."));

  console.log("\nChecked addresses");
  check("unchecked addresses show Check email first", (await state(owner.id)).status === "check_email");
  // What the Instantly check writes (tools/verify-instantly.ts covers the
  // check itself): a status on each address, and an invalid one moved to the
  // alternates with the lead back at No email.
  const checkedAt = new Date();
  for (const [lead, status] of [[owner, "valid"], [desk, "valid"], [mismatch, "valid"], [dq, "valid"], [thin, "risky"]] as const) {
    await prisma.lead.update({ where: { id: lead.id }, data: { emailStatus: status, emailCheckedAt: checkedAt } });
  }
  await prisma.lead.update({
    where: { id: bad.id },
    data: {
      email: null, emailType: null, emailStatus: null, emailSource: null, emailCheckedAt: checkedAt,
      emailAlternates: JSON.stringify([{ address: "info@bad.test", type: "generic", status: "invalid", source: "imported" }]),
    },
  });
  check("an invalid address leaves the lead at No email", (await state(bad.id)).status === "no_email");
  check("risky is not valid: still Check email", (await state(thin.id)).status === "check_email");

  console.log("\nApproving, the contact check, and the Ready rule");
  check("checked but not approved: Needs opener", (await state(owner.id)).status === "needs_opener");
  check("{sender} stays in the draft, to be signed from the sending inbox", (ownerLead.emailBody ?? "").includes("{sender}") &&
    wf.unfilledPlaceholders(ownerLead.emailBody ?? "").length === 0);
  const savedEdit = await act.saveEmailDraft(owner.id, { subject: "Hi {clinic}", body: "A body with the placeholder left in." });
  const approvedEdit = await act.approveEmail(owner.id);
  check("an edit saves, and an email with an unfilled placeholder cannot be approved",
    savedEdit.ok && !approvedEdit.ok && /\{clinic\}/.test(approvedEdit.ok ? "" : approvedEdit.error), approvedEdit.ok ? "approved?" : approvedEdit.error);
  await act.generateEmailOpener(owner.id); // fresh draft after the test edit
  ownerLead = await reload(owner.id);
  check("approve → Ready (A tier, valid, approved, contact matches)", (await act.approveEmail(owner.id)).ok && (await state(owner.id)).status === "ready", (await state(owner.id)).status);
  await act.approveEmail(desk.id);
  check("front desk Ready too", (await state(desk.id)).status === "ready");
  await act.approveEmail(mismatch.id);
  check("contact mismatch: flagged, Ready blocked", (await state(mismatch.id)).status === "check_contact");
  check("and Mark sent refuses it", !(await act.markEmailSent(mismatch.id, { step: 0, subject: "s", body: "b" })).ok);
  await act.resolveContact(mismatch.id, "scorecard");
  const mm = await reload(mismatch.id);
  check("picking the scorecard's person sets the contact and rebuilds the greeting",
    mm.contactName === "Dr. Jane Doe" && (mm.emailBody ?? "").startsWith("Hi Dr. Doe,") && mm.emailApprovedAt === null, mm.emailBody?.split("\n")[0]);
  await act.approveEmail(mismatch.id);
  check("then Ready once approved again", (await state(mismatch.id)).status === "ready");
  await act.approveEmail(dq.id);
  check("disqualified: never Ready, however complete", (await state(dq.id)).status === "not_ab");
  check("and Mark sent refuses it", !(await act.markEmailSent(dq.id, { step: 0, subject: "s", body: "b" })).ok);

  console.log("\nSending by hand, from two inboxes");
  const leadInbox = async (id: string) => (await reload(id)).sendingInboxId;
  check("leads alternate between inboxes as they become Ready: owner → hamdi@, front desk → team@, then hamdi@ again",
    (await leadInbox(owner.id)) === hamdi.id && (await leadInbox(desk.id)) === team.id && (await leadInbox(mismatch.id)) === hamdi.id);
  check("a lead that never becomes Ready gets no inbox", (await leadInbox(dq.id)) === null);
  const unsigned = await state(owner.id);
  check("with no display name and no Your name, it cannot be sent yet — and says why",
    unsigned.toSend === null && /Nobody to sign it as/.test(unsigned.sendBlocked ?? ""), unsigned.sendBlocked ?? "");
  // hamdi@ signs as its display name; team@ has none and falls back to Your name.
  await prisma.sendingInbox.update({ where: { id: hamdi.id }, data: { displayName: "Hamdi" } });
  await prisma.emailSettings.create({ data: { id: wf.EMAIL_SETTINGS_ID, ...wf.emailSettingsRow({ ...settings, senderName: "Alex" }) } });
  const send0 = (await state(owner.id)).toSend!;
  const deskSend0 = (await state(desk.id)).toSend!;
  check("{sender} is the sending inbox's display name", send0.from === "hamdi@spinescale.co" && send0.body.includes("\nHamdi") && !send0.body.includes("{sender}"));
  check("and Your name where the inbox has none", deskSend0.from === "team@spinescale.co" && deskSend0.body.includes("\nAlex"));
  const gmail = new URL(wf.gmailComposeUrl(send0.from, send0.to, send0.subject, send0.body));
  check("Open in Gmail opens the assigned inbox's account (authuser), with to, subject and body filled in",
    gmail.hostname === "mail.google.com" && gmail.searchParams.get("authuser") === "hamdi@spinescale.co" && gmail.searchParams.get("view") === "cm" &&
      gmail.searchParams.get("to") === "drsmith@ownerspine.test" && gmail.searchParams.get("su") === send0.subject && gmail.searchParams.get("body") === send0.body);
  check("…and the front desk's from team@",
    new URL(wf.gmailComposeUrl(deskSend0.from, deskSend0.to, deskSend0.subject, deskSend0.body)).searchParams.get("authuser") === "team@spinescale.co");
  check("Copy email: subject then body", wf.copyText(send0.subject, send0.body).startsWith(`Subject: ${send0.subject}\n\n`));
  check("the inbox can be changed before Email 1", (await act.setLeadInbox(owner.id, team.id)).ok && (await leadInbox(owner.id)) === team.id);
  await act.setLeadInbox(owner.id, hamdi.id);
  const sent0 = await act.markEmailSent(owner.id, { step: 0, subject: send0.subject, body: send0.body, inboxId: send0.inboxId });
  check("Mark sent records Email 1 and its date, and moves it to In sequence",
    sent0.ok && sent0.step === 0 && (await prisma.emailSend.count({ where: { leadId: owner.id, step: 0 } })) === 1 && (await state(owner.id)).status === "in_sequence");
  check("Mark sent records which inbox sent it", (await prisma.emailSend.findFirstOrThrow({ where: { leadId: owner.id, step: 0 } })).fromEmail === "hamdi@spinescale.co" &&
    sent0.ok && sent0.inbox === "hamdi@spinescale.co" && sent0.sentToday === 1 && sent0.dailyLimit === 1);
  check("Mark sent is logged in the activity feed",
    (await prisma.activityLog.count({ where: { leadId: owner.id, kind: "EMAIL_MARKED_SENT", summary: { startsWith: "Email 1 marked sent to " , endsWith: " from hamdi@spinescale.co" } } })) === 1);

  console.log("\nUndo mark sent");
  const email1 = await prisma.emailSend.findFirstOrThrow({ where: { leadId: owner.id, step: 0 } });
  const undo0 = await act.undoEmailSent(owner.id, email1.id);
  const undone = await state(owner.id, new Date(Date.now() + 10 * DAY));
  check("undo Email 1: the send is gone and the lead is Ready again",
    undo0.ok && (await prisma.emailSend.count({ where: { leadId: owner.id } })) === 0 && (await state(owner.id)).status === "ready", undo0.ok ? "" : undo0.error);
  check("and today's count for hamdi@ drops by one", ((await (await import("../src/lib/emailInboxes")).sentTodayByInbox())[hamdi.id] ?? 0) === 0);
  check("and no follow-up comes due", undone.toSend?.step === 0 && !undone.followUpDueToday);
  check("and the assigned inbox is kept", (await leadInbox(owner.id)) === hamdi.id);
  check("and the undo is logged in the activity feed",
    (await prisma.activityLog.count({ where: { leadId: owner.id, kind: "EMAIL_SEND_UNDONE", summary: { startsWith: "Undid Email 1 marked sent to ", endsWith: " from hamdi@spinescale.co" } } })) === 1);
  check("undoing it twice is refused", !(await act.undoEmailSent(owner.id, email1.id)).ok);
  const again0 = await act.markEmailSent(owner.id, { step: 0, subject: send0.subject, body: send0.body, inboxId: send0.inboxId });
  check("and it can be marked sent again", again0.ok && again0.sentToday === 1);

  const locked = await act.setLeadInbox(owner.id, team.id);
  check("and the inbox cannot be changed after Email 1", !locked.ok && (await leadInbox(owner.id)) === hamdi.id, locked.ok ? "changed?" : locked.error);
  const deskSend = (await state(desk.id)).toSend!;
  const deskSent = await act.markEmailSent(desk.id, { step: 0, subject: deskSend.subject, body: deskSend.body, inboxId: deskSend.inboxId });
  check("each inbox counts on its own: team@ is at 1 of 1", deskSent.ok && deskSent.inbox === "team@spinescale.co" && deskSent.sentToday === 1);
  const mmSend = (await state(mismatch.id)).toSend!;
  const third = await act.markEmailSent(mismatch.id, { step: 0, subject: mmSend.subject, body: mmSend.body, inboxId: mmSend.inboxId });
  check("hamdi@ goes over its own limit: 2 of 1 (allowed, reported)", third.ok && third.inbox === "hamdi@spinescale.co" && third.sentToday === 2 && third.dailyLimit === 1);
  const view = await loadEmailView();
  const counter = (address: string) => view.counters.find((c) => c.address === address);
  check("the Email view counts per inbox: hamdi@ 2 of 1, team@ 1 of 1",
    counter("hamdi@spinescale.co")?.sent === 2 && counter("hamdi@spinescale.co")?.limit === 1 && counter("team@spinescale.co")?.sent === 1 &&
      view.counters.map((c) => c.short).join(" ") === "hamdi@ team@");
  check("each row shows its inbox", view.rows.find((r) => r.id === owner.id)?.inbox === "hamdi@spinescale.co" &&
    view.rows.find((r) => r.id === desk.id)?.inbox === "team@spinescale.co");


  console.log("\nFollow-ups");
  const now = new Date();
  check("not due before three days", (await state(owner.id, new Date(now.getTime() + 2 * DAY))).toSend === null);
  const due = await state(owner.id, new Date(now.getTime() + 3 * DAY));
  check("due on day three: Follow-up due, drafted from the template as a reply",
    due.followUpDueToday && due.toSend?.step === 1 && due.toSend.subject === `Re: ${send0.subject}` && due.toSend.body.startsWith("Hi Dr. Smith,"), due.toSend?.subject);
  // Move Email 1 back three days, and send follow-up 1.
  await prisma.emailSend.updateMany({ where: { leadId: owner.id, step: 0 }, data: { sentAt: new Date(now.getTime() - 3 * DAY) } });
  const viewDue = await loadEmailView();
  check("the Follow-up due today chip counts it", viewDue.rows.filter((r) => r.followUpDueToday).length === 1);
  // Even if the lead's assignment moved (by hand, in the database), the
  // follow-up goes from the inbox Email 1 went from: same thread.
  await prisma.lead.update({ where: { id: owner.id }, data: { sendingInboxId: team.id } });
  const f1 = (await state(owner.id)).toSend!;
  check("follow-ups use Email 1's inbox, so they stay in its thread", f1.from === "hamdi@spinescale.co" && f1.inboxId === hamdi.id &&
    new URL(wf.gmailComposeUrl(f1.from, f1.to, f1.subject, f1.body)).searchParams.get("authuser") === "hamdi@spinescale.co");
  const wrongInbox = await act.markEmailSent(owner.id, { step: 1, subject: f1.subject, body: f1.body, inboxId: team.id });
  check("marking it sent from another inbox is refused", !wrongInbox.ok, wrongInbox.ok ? "accepted?" : wrongInbox.error);
  check("follow-up 1 marked sent, from hamdi@", (await act.markEmailSent(owner.id, { step: 1, subject: f1.subject, body: f1.body, inboxId: f1.inboxId })).ok &&
    (await prisma.emailSend.findFirstOrThrow({ where: { leadId: owner.id, step: 1 } })).inboxId === hamdi.id);
  const fu1 = await prisma.emailSend.findFirstOrThrow({ where: { leadId: owner.id, step: 1 } });
  check("undoing Email 1 while follow-up 1 is the latest is refused",
    !(await act.undoEmailSent(owner.id, (await prisma.emailSend.findFirstOrThrow({ where: { leadId: owner.id, step: 0 } })).id)).ok);
  const undo1 = await act.undoEmailSent(owner.id, fu1.id);
  const fuBack = await state(owner.id);
  check("undo a follow-up: it is Follow-up due again, from the same inbox",
    undo1.ok && fuBack.followUpDueToday && fuBack.toSend?.step === 1 && fuBack.toSend.inboxId === hamdi.id &&
      (await prisma.emailSend.count({ where: { leadId: owner.id } })) === 1, undo1.ok ? "" : undo1.error);
  check("and the undo is logged", (await prisma.activityLog.count({ where: { leadId: owner.id, summary: { startsWith: "Undid Follow-up 1 marked sent" } } })) === 1);
  await act.markEmailSent(owner.id, { step: 1, subject: f1.subject, body: f1.body, inboxId: f1.inboxId });
  await prisma.emailSend.updateMany({ where: { leadId: owner.id, step: 1 }, data: { sentAt: new Date(now.getTime() - 3 * DAY) } });
  const f2 = (await state(owner.id)).toSend!;
  check("follow-up 2 comes due after it", f2?.step === 2);
  await act.markEmailSent(owner.id, { step: 2, subject: f2.subject, body: f2.body, inboxId: f2.inboxId });
  check("follow-up 2 from hamdi@ too", f2.from === "hamdi@spinescale.co" && (await prisma.emailSend.findFirstOrThrow({ where: { leadId: owner.id, step: 2 } })).fromEmail === "hamdi@spinescale.co");
  await prisma.emailSend.updateMany({ where: { leadId: owner.id, step: 2 }, data: { sentAt: new Date(now.getTime() - 30 * DAY) } });
  const after = await state(owner.id);
  check("and it stops after the last template", after.toSend === null && !after.followUpDueToday && after.sequence.includes("last email"), after.sequence);

  console.log("\nResults");
  const bounced = await act.markEmailBounced(mismatch.id);
  const mmAfter = await reload(mismatch.id);
  check("Bounced: the address moves to alternates as invalid and the lead goes back to No email",
    bounced.ok && mmAfter.email === null && (await state(mismatch.id)).status === "no_email" &&
      (await import("../src/lib/emailFind")).parseAlternates(mmAfter.emailAlternates).some((a) => a.address === "mark@mismatch.test" && a.status === "invalid"));
  check("and the clinic is not suppressed", mmAfter.suppressedAt === null && (await prisma.suppression.count()) === 0);

  const replied = await act.markEmailReplied(desk.id, { text: "Thanks, but we're all set.", type: "not_interested" });
  const deskAfter = await reload(desk.id);
  check("Not interested: follow-ups stop", replied.ok && (await state(desk.id, new Date(now.getTime() + 10 * DAY))).toSend === null);
  const deskLast = await prisma.emailSend.findFirstOrThrow({ where: { leadId: desk.id, step: 0 } });
  const undoReplied = await act.undoEmailSent(desk.id, deskLast.id);
  check("undo is refused once they have replied, and the send is kept",
    !undoReplied.ok && (await prisma.emailSend.count({ where: { id: deskLast.id } })) === 1, undoReplied.ok ? "accepted?" : undoReplied.error);
  const mmLast = await prisma.emailSend.findFirstOrThrow({ where: { leadId: mismatch.id } });
  check("and once it has bounced", !(await act.undoEmailSent(mismatch.id, mmLast.id)).ok);
  check("a task is created to answer it", (await prisma.task.count({ where: { leadId: desk.id, title: { startsWith: "Reply to" } } })) === 1);
  check("and the clinic goes on the suppression list", deskAfter.suppressedAt !== null && (await state(desk.id)).status === "stopped" &&
    (await prisma.suppression.count({ where: { email: "info@frontdesk.test", domain: "frontdesk.test", reason: "not_interested" } })) === 1);

  console.log("\nSuppression blocks every channel");
  const li = await generateOutreachStep(desk.id, "CONNECTION");
  check("LinkedIn drafting is refused", !li.ok && /suppression list/.test(li.error), li.ok ? "ok?" : li.error);
  const msg = await prisma.outreachMessage.create({ data: { leadId: desk.id, step: "CONNECTION", content: "Hello there, a connection note." } });
  const marked = await markMessageSent(desk.id, msg.id);
  check("LinkedIn Mark sent is refused", typeof marked === "string" && /suppression list/.test(marked));
  const imp = await importClinicDiscoveryCandidates({
    clinics: [{ clinicName: name("Front Desk Clinic Two"), location: "Austin, TX", websiteUrl: "https://www.frontdesk.test/", emails: [], email: null, sourceQuery: "x" }],
  });
  check("a Discovery search result on the same domain is not imported", imp.suppressed === 1 && imp.created === 0, JSON.stringify(imp));
  const cand = await prisma.discoveryCandidate.create({ data: { clinicName: name("Desk Candidate"), email: "info@frontdesk.test", channel: "email" } });
  const processed = await processDiscoveryCandidate(cand.id);
  check("a candidate with that address is rejected by the queue, nothing spent", processed.status === "REJECTED" && /suppression list/.test(processed.headline));
  let refused = false;
  try {
    await promoteToLead(cand.id, null, new Date());
  } catch (e) {
    refused = e instanceof SuppressedError;
  }
  check("and promotion refuses it", refused);
  const unsub = await act.markEmailUnsubscribed(thin.id);
  check("Unsubscribed suppresses the clinic too", unsub.ok && (await state(thin.id)).status === "stopped" &&
    (await prisma.suppression.count({ where: { reason: "unsubscribed" } })) === 1);

  console.log("\nThe chips");
  const finalView = await loadEmailView();
  const by = (n: string) => finalView.rows.find((r) => r.clinicName === name(n))?.status;
  check("each lead lands in its status",
    by("Owner Spine") === "in_sequence" && by("Front Desk Clinic") === "stopped" && by("Mismatch Clinic") === "no_email" &&
      by("Disqualified Clinic") === "not_ab" && by("Thin Clinic") === "stopped" && by("Bad Address Clinic") === "no_email",
    JSON.stringify(finalView.rows.map((r) => [r.clinicName, r.status])));

  console.log("\nEditing every template clears the banner");
  const edited = {
    ...settings,
    subjectTemplate: "A thought for {clinic}",
    frontDeskSubjectTemplate: "For the doctor at {clinic}",
    ownerBodyTemplate: "{opener}\n\nMine.",
    frontDeskTemplate: "{opener}\n\nMine, for {contact}.",
    optOutLine: "Reply stop and I won't write again.",
    followUpTemplates: ["My follow-up.", "My last note."],
    signOff: "Thanks,\n{sender}",
  };
  check("a template without {opener} is refused", !(await act.saveEmailSettings({ ...edited, ownerBodyTemplate: "No opener here." })).ok);
  check("saved", (await act.saveEmailSettings(edited)).ok);
  check("no starter copy left, so no banner", wf.startersRemaining(await loadEmailSettings()).length === 0 && (await loadEmailView()).starters.length === 0);

  console.log("\nSending inboxes in Settings");
  const current = await loadEmailSettings();
  const listed = async () => (await prisma.sendingInbox.findMany({ orderBy: { position: "asc" } })).map((i) => ({ id: i.id, address: i.address, displayName: i.displayName, dailyLimit: i.dailyLimit }));
  const base = await listed();
  const removeUsed = await act.saveEmailSettings({ ...current, inboxes: base.filter((i) => i.id !== hamdi.id) });
  check("an inbox that has sent email cannot be removed", !removeUsed.ok && /hamdi@spinescale\.co has already sent/.test(removeUsed.ok ? "" : removeUsed.error));
  const added = await act.saveEmailSettings({ ...current, inboxes: [...base.map((i) => (i.id === team.id ? { ...i, displayName: "Spine Scale Team", dailyLimit: 15 } : i)), { id: null, address: "Outreach@SpineScale.co", displayName: "", dailyLimit: 10 }] });
  const afterAdd = await listed();
  check("an inbox is added (address lowercased) and another renamed with a new limit",
    added.ok && afterAdd.length === 3 && afterAdd[2].address === "outreach@spinescale.co" && afterAdd.find((i) => i.id === team.id)?.displayName === "Spine Scale Team" && afterAdd.find((i) => i.id === team.id)?.dailyLimit === 15);
  check("a bad address is refused", !(await act.saveEmailSettings({ ...current, inboxes: [...afterAdd, { id: null, address: "not an address", displayName: "", dailyLimit: 10 }] })).ok);
  check("an unused inbox can be removed", (await act.saveEmailSettings({ ...current, inboxes: afterAdd.slice(0, 2) })).ok && (await listed()).length === 2);

  console.log("\nThe final copy, as the migration writes it");
  const fs = await import("node:fs");
  const migration = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261029150000_final_email_copy/migration.sql"), "utf8");
  const insert = migration.slice(migration.indexOf("INSERT INTO"));
  await prisma.emailSettings.update({ where: { id: wf.EMAIL_SETTINGS_ID }, data: { senderName: "", dailyLimit: 10 } });
  await prisma.$executeRawUnsafe(insert);
  const final = await loadEmailSettings();
  check("written over the edited row; no starter copy, so no banner", wf.startersRemaining(final).length === 0, wf.startersRemaining(final).join(", "));
  check("the two subjects, as given", final.subjectTemplate === "quick question about new patient follow-up" && final.frontDeskSubjectTemplate === "question for the doctor");
  check("placeholders kept exactly as written",
    final.ownerBodyTemplate.startsWith("{greeting}\n\n{opener}\n\n") && final.frontDeskTemplate.startsWith("{greeting}\n\n{opener}\n\n") &&
      final.ownerBodyTemplate.includes("at {clinic} right now") && final.followUpTemplates[0].includes("handled at {clinic},") && final.signOff.startsWith("{sender}\nSpine Scale\n"));
  check("the opt-out line and its typographic quotes, as given", final.optOutLine === "If this isn’t relevant, just reply “no” and I won’t email again.");
  check("two follow-ups, three days apart (day 3, then day 6)", final.followUpTemplates.length === 2 && final.followUpDelayDays === 3 &&
    final.followUpTemplates[1].endsWith("I’ll pick it up.\n\nThanks either way."));
  check("the sender name and daily limit were left as they were", final.senderName === "" && final.dailyLimit === 10);

  console.log("\nThe opener: preferred evidence and no bridging");
  const os = await import("../src/lib/outreachSequence");
  const prompt = os.buildEmailOpenerPrompt(
    { evidence: { clinicName: "X", websiteNotes: "n", metaAdsSignal: null, reviewCount: null }, contactName: null, contactTitle: null, loomUrl: null, replyText: null, priorMessages: [] },
    { cited: [], gaps: [] },
  ).user;
  check("the prompt puts ads, free consult offers, booking and contact options first, equipment and reviews last",
    /1\. Active Meta ads/.test(prompt) && /2\. A free consultation/.test(prompt) && /3\. The booking flow/.test(prompt) && /4\. The contact options/.test(prompt) &&
      /Equipment and the review count come last/.test(prompt));
  check("and forbids bridging assumptions", /THE OPENER STOPS AT THE OBSERVATION/.test(prompt));
  check("a bridging assumption is rejected", os.assumptionReason("I saw you're running Meta ads, which probably means a lot of after-hours inquiries.") !== null &&
    os.assumptionReason("I imagine the front desk is stretched with the free consult offer.") !== null);
  check("a plain observation passes", os.assumptionReason("I saw Lakeside Spine & Disc Center is running Meta ads for a free decompression consultation.") === null);

  console.log("\nBoth emails, assembled for a seeded lead");
  const lake = await prisma.lead.create({
    data: {
      clinicName: name("Lakeside Spine & Disc Center"),
      stage: "NEW",
      channel: "email",
      contactName: "Dr. Maria Lopez",
      email: "drlopez@lakesidespine.test",
      emailType: "owner",
      websiteNotes: "Lakeside Spine & Disc Center. Book your free decompression consultation online or call us. Text us anytime.",
      metaAdsSignal: "Active ads: 3 running, promoting a free consultation",
      reviewCount: 64,
    },
  });
  stub.setReplies({
    [name("Lakeside Spine & Disc Center")]: [
      { opener: "I saw Lakeside Spine & Disc Center is running Meta ads for a free consultation, which probably brings in a lot of after-hours inquiries.", basis: "cited", ...note },
      { opener: "I saw Lakeside Spine & Disc Center is running Meta ads for a free decompression consultation.", basis: "cited", ...note },
    ],
  });
  const lakeOpener = await act.generateEmailOpener(lake.id);
  const lakeLead = await reload(lake.id);
  check("the bridging opener was rejected, the plain one kept", lakeOpener.ok && !/probably/.test(lakeLead.emailOpener ?? "") && /Meta ads/.test(lakeLead.emailOpener ?? ""), lakeLead.emailOpener ?? JSON.stringify(lakeOpener));
  const ownerEmail = { subject: lakeLead.emailSubject!, body: lakeLead.emailBody! };
  await act.setEmailVersion(lake.id, "front_desk");
  const deskVersion = await reload(lake.id);
  const deskEmail = { subject: deskVersion.emailSubject!, body: deskVersion.emailBody! };
  check("owner email: its subject, greeted by name, opt-out, then the sign-off",
    ownerEmail.subject === "quick question about new patient follow-up" && ownerEmail.body.startsWith("Hi Dr. Lopez,\n\nI saw ") &&
      ownerEmail.body.includes("at Lakeside Spine & Disc Center (email verify) right now.") &&
      ownerEmail.body.endsWith(`${final.optOutLine}\n\n{sender}\nSpine Scale\nOne Archers’ Place, East Tower\nTaft Avenue corner Castro Street, Malate\nManila 1004, Philippines`));
  check("front-desk email: its subject, greeting the team",
    deskEmail.subject === "question for the doctor" && deskEmail.body.startsWith(`Hi ${name("Lakeside Spine & Disc Center")} team,\n\nI saw `) &&
      deskEmail.body.includes("Would you mind passing it along?"));
  const fu = (n: number) => wf.renderFollowUp(final, lakeLead, "owner", n, ownerEmail.subject)!;
  check("follow-ups reply in thread, greeted, with the opt-out and sign-off", fu(1).subject === "Re: quick question about new patient follow-up" &&
    fu(1).body.startsWith("Hi Dr. Lopez,\n\nJust bumping") && fu(2).body.includes("Thanks either way.\n\nIf this isn’t relevant"));
  for (const [label, e] of [["OWNER", ownerEmail], ["FRONT DESK", deskEmail], ["FOLLOW-UP 1", fu(1)], ["FOLLOW-UP 2", fu(2)]] as const) {
    console.log(`\n  ── ${label} ──\n  Subject: ${e.subject}\n\n${e.body.split("\n").map((l) => `  ${l}`).join("\n")}`);
  }

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
