// The Email queue → pipeline flow, the Contact form list and the Call list,
// against a real database.
//
//   DATABASE_URL="file:$PWD/.verify-buckets.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify-buckets.db" npx tsx tools/verify-email-buckets.ts
//
// The cases: no owner stays in the queue; a hand pick clears the markers so
// Find owners covers it again; owner + risky email goes to the pipeline;
// nothing found with a form goes to the Contact form list; nothing at all goes
// to the Call list; a replied lead is a warm call; a form sent three days ago
// with no reply is a form follow-up; Not interested marks Lost and suppresses.

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

const TAG = "verify-email-buckets";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { loadEmailQueue, loadCallList, emailPipelineIds } = await import("../src/lib/emailBucketsRead");
  const { pickOwner, findOwnerLeads } = await import("../src/lib/ownerFindRun");
  const { logCall } = await import("../src/lib/actions/callList");
  const { markContactFormSent } = await import("../src/lib/actions/emailWorkflow");

  await prisma.lead.deleteMany({ where: { leadSource: TAG } });
  const FORM_LINKS = JSON.stringify([{ url: "https://form.example/contact-us", text: "Contact us" }]);
  const make = (clinicName: string, data: Record<string, unknown> = {}) =>
    prisma.lead.create({ data: { clinicName, leadSource: TAG, channel: "email", phone: "512-555-0100", ...data } });

  const noOwner = await make("No Owner Clinic");
  const pick = await make("Pick Clinic", {
    ownerStatus: "pick",
    ownerSiteNames: JSON.stringify(["Dr. Jane Roe", "Dr. Sam Poe"]),
    ownerCheckedAt: new Date(),
    ownerEmailAt: new Date(),
  });
  const risky = await make("Risky Clinic", { ownerStatus: "confirmed", contactName: "Dr. Ann Lee", email: "ann@risky.example", emailStatus: "risky" });
  const formLead = await make("Form Clinic", {
    ownerStatus: "confirmed", contactName: "Dr. Bo Cho", ownerCheckedAt: new Date(), ownerEmailAt: new Date(),
    websiteUrl: "https://form.example", websiteLinks: FORM_LINKS,
  });
  // Spinal Decompression Plus: owner address from Maps contacts, Find owners
  // never confirmed anyone, the contact settled by hand, the email approved
  // (Ready). It belongs in the pipeline, and only there.
  const sdp = await make("Spinal Decompression Plus", {
    ownerStatus: null, contactName: "Dr. James Ottomeyer", email: "drottomeyer@frontierhealthcenter.example", emailType: "owner",
    emailStatus: "valid", emailSource: "maps_contacts", contactConfirmedAt: new Date(), emailApprovedAt: new Date(),
  });
  const approvedOnly = await make("Approved Only Clinic", { contactName: "Dr. Ed Fox", email: "ed@approved.example", emailStatus: "valid", emailApprovedAt: new Date() });
  const byHand = await make("By Hand Clinic", { contactName: "Dr. Flo Gee", contactNameByHand: true, email: "flo@byhand.example", emailStatus: "valid" });
  const unsettled = await make("Unsettled Clinic", { contactName: "Dr. Gus Hay", email: "gus@unsettled.example", emailStatus: "valid" });
  const approvedNoEmail = await make("Approved Invalid Clinic", { contactName: "Dr. Hal Ivy", email: "hal@invalid.example", emailStatus: "invalid", emailApprovedAt: new Date() });
  const nothing = await make("Nothing Clinic", { ownerStatus: "not_found", ownerCheckedAt: new Date() });
  const replied = await make("Replied Clinic", {
    ownerStatus: "confirmed", contactName: "Dr. Cy Dee", email: "cy@replied.example", emailStatus: "valid",
    emailRepliedAt: new Date(), emailReplyType: "interested",
  });
  const lost = await make("Lost Clinic", { stage: "LOST" });

  console.log("Buckets");
  let { queue, forms } = await loadEmailQueue();
  const inQueue = (id: string) => queue.some((q) => q.id === id);
  const pipe = await emailPipelineIds();
  check("a lead with no owner stays in the queue", inQueue(noOwner.id) && !pipe.has(noOwner.id));
  check("owner + risky email moves to the pipeline", pipe.has(risky.id) && !inQueue(risky.id));
  check("nothing found + contact form → Contact form list", forms.some((f) => f.id === formLead.id) && !inQueue(formLead.id));
  let calls = await loadCallList();
  const callOf = (id: string) => calls.find((c) => c.id === id);
  check("nothing at all → Call list (Last resort)", callOf(nothing.id)?.section === "last_resort" && !inQueue(nothing.id));
  check("a replied lead shows under Warm calls", callOf(replied.id)?.section === "warm");
  check("a Lost lead is hidden everywhere", !inQueue(lost.id) && !forms.some((f) => f.id === lost.id) && !callOf(lost.id));

  console.log("Who the email goes to, settled");
  const only = (id: string) => [inQueue(id), pipe.has(id), forms.some((f) => f.id === id), !!callOf(id)].filter(Boolean).length === 1;
  check("Spinal Decompression Plus (Ready, owner never confirmed, contact kept by hand) → pipeline only", pipe.has(sdp.id) && !inQueue(sdp.id) && only(sdp.id));
  check("approved email + usable address → pipeline only", pipe.has(approvedOnly.id) && only(approvedOnly.id));
  check("contact set by hand + usable address → pipeline only", pipe.has(byHand.id) && only(byHand.id));
  check("usable address but nothing settled → queue only", inQueue(unsettled.id) && only(unsettled.id));
  check("approved but the address is invalid → queue only", inQueue(approvedNoEmail.id) && only(approvedNoEmail.id));

  console.log("Hand pick");
  const r = await pickOwner(pick.id, "Dr. Jane Roe");
  const after = await prisma.lead.findUniqueOrThrow({ where: { id: pick.id } });
  check("picking an owner works", r.ok);
  check("the pick clears both markers", after.ownerCheckedAt === null && after.ownerEmailAt === null, `${after.ownerCheckedAt} ${after.ownerEmailAt}`);
  check("the owner picked by hand is kept", after.ownerStatus === "confirmed" && after.ownerSource === "manual");
  check("the next Find owners run includes it", (await findOwnerLeads()).some((l) => l.id === pick.id));
  check("it is back in the queue", (await loadEmailQueue()).queue.some((q) => q.id === pick.id));
  check("Find owners leaves pipeline leads alone", !(await findOwnerLeads()).some((l) => l.id === risky.id));

  console.log("Contact form → Form follow-up");
  await markContactFormSent(formLead.id);
  ({ queue, forms } = await loadEmailQueue());
  check("after Mark form sent it leaves the Contact form list", !forms.some((f) => f.id === formLead.id));
  calls = await loadCallList();
  check("…and is not on the Call list yet", !callOf(formLead.id));
  const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000);
  await prisma.activityLog.updateMany({ where: { leadId: formLead.id, kind: "CONTACT_FORM_SENT" }, data: { createdAt: fourDaysAgo } });
  calls = await loadCallList();
  check("three days on with no reply it is a Form follow-up", callOf(formLead.id)?.section === "form_follow_up");

  console.log("Call buttons");
  check("Called – no answer logs", (await logCall(nothing.id, "CALL_NO_ANSWER")).ok);
  calls = await loadCallList();
  check("…and shows as the last call", callOf(nothing.id)?.lastCall?.label === "Called – no answer");
  check("Talked logs", (await logCall(nothing.id, "CALL_TALKED")).ok);
  check("Not interested logs", (await logCall(nothing.id, "CALL_NOT_INTERESTED")).ok);
  const ni = await prisma.lead.findUniqueOrThrow({ where: { id: nothing.id } });
  check("Not interested marks it Lost and suppresses it", ni.stage === "LOST" && ni.suppressedReason === "not_interested");
  check("…with a suppression row", (await prisma.suppression.count({ where: { leadId: nothing.id } })) === 1);
  check("three call entries in the activity feed", (await prisma.activityLog.count({ where: { leadId: nothing.id, kind: { startsWith: "CALL_" } } })) === 3);
  calls = await loadCallList();
  check("…and it is off the Call list", !callOf(nothing.id));

  await prisma.suppression.deleteMany({ where: { clinicName: { in: ["Nothing Clinic"] } } });
  await prisma.lead.deleteMany({ where: { leadSource: TAG } });
  console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
