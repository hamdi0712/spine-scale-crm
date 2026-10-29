// Discovery by channel, end to end — including the one-time migration.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-discovery-channels.ts
//
// Builds its own scratch database (the file DATABASE_URL names is deleted and
// recreated): every migration up to the one before Discovery had channels,
// then a seed of leads and candidates as they would stand today, then the
// discovery-channel migration itself. Checks that existing candidates are
// LinkedIn, that every email lead moved back to LinkedIn with nothing else
// changed and the count on record, that Clinic-first results land in Email
// even when the clinic is an old LinkedIn candidate or lead, that a match with
// a LinkedIn lead already talking to us is tagged and cannot be promoted by
// any path, and that promotion follows the candidate's channel.

import { execSync } from "node:child_process";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
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

const NEW_MIGRATION = "20261029120000_discovery_channel";
const ROOT = path.join(__dirname, "..");

function migrate(schemaDir: string): void {
  execSync(`npx prisma migrate deploy --schema ${path.join(schemaDir, "schema.prisma")}`, {
    cwd: ROOT,
    stdio: "pipe",
    env: process.env,
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/verify/.test(url) || !url.startsWith("file:")) {
    throw new Error("Refusing to run: DATABASE_URL must be a file: URL with 'verify' in its name — this script deletes it.");
  }
  const file = url.slice("file:".length);
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-journal`, { force: true });

  // ─── The database as it stands before this change ────────────────────────
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "verify-channels-"));
  fs.cpSync(path.join(ROOT, "prisma"), old, { recursive: true });
  fs.rmSync(path.join(old, "migrations", NEW_MIGRATION), { recursive: true, force: true });
  migrate(old);
  fs.rmSync(old, { recursive: true, force: true });

  const { prisma } = await import("../src/lib/prisma");
  const ago = (days: number) => Date.now() - days * 86_400_000;
  // Raw SQL, because the client already knows columns this database does not
  // have yet. Only the columns without a default are named.
  const lead = (id: string, name: string, location: string, channel: string, extra: Record<string, unknown> = {}) => {
    const cols = { id, clinicName: name, location, channel, stage: "NEW", createdAt: ago(30), updatedAt: ago(30), ...extra };
    const keys = Object.keys(cols);
    return prisma.$executeRawUnsafe(
      `INSERT INTO "Lead" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ...Object.values(cols),
    );
  };
  await lead("lead-email-1", "Old Email Clinic", "Austin, TX", "email", { email: "info@oldemail.test", stage: "CONTACTED" });
  await lead("lead-email-2", "Second Email Clinic", "Dallas, TX", "email");
  await lead("lead-li-plain", "Old LinkedIn Clinic", "Houston, TX", "linkedin");
  await lead("lead-li-accepted", "Talking Spine Center", "Plano, TX", "linkedin", { connectionAcceptedAt: ago(5) });
  await lead("lead-li-booked", "Booked Disc Clinic", "Frisco, TX", "linkedin", { stage: "DISCOVERY" });
  await lead("lead-li-lost", "Lost Back Clinic", "Waco, TX", "linkedin", { stage: "LOST" });
  await prisma.$executeRawUnsafe(
    `INSERT INTO "DiscoveryCandidate" ("id","clinicName","location","discoverySource","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
    "cand-li",
    "Existing Spine Candidate",
    "Austin, TX",
    "CLINIC_FIRST",
    "PENDING",
    ago(10),
    ago(10),
  );
  const before = (await prisma.$queryRawUnsafe(
    `SELECT "id","stage","email","updatedAt" FROM "Lead" WHERE "id" = 'lead-email-1'`,
  )) as { id: string; stage: string; email: string; updatedAt: number | bigint }[];

  // ─── The migration ───────────────────────────────────────────────────────
  migrate(path.join(ROOT, "prisma"));
  await prisma.$disconnect();

  const { PIPELINE_DEFAULT_WHERE } = await import("../src/lib/liveLeadWhere");
  const { importClinicDiscoveryCandidates } = await import("../src/lib/actions/clinicDiscovery");
  const { discoveryQueue, discoveryQueueSelected, processDiscoveryCandidate, promoteDiscoveryCandidate } = await import("../src/lib/actions/discovery");
  const { promoteToLead, TalkingOnLinkedinError } = await import("../src/lib/promoteLead");

  console.log("\nThe one-time move");
  const emailPipeline = await prisma.lead.count({ where: { ...PIPELINE_DEFAULT_WHERE, channel: "email" } });
  check("the Email pipeline shows 0", emailPipeline === 0, String(emailPipeline));
  const moved = await prisma.lead.findMany({ where: { id: { in: ["lead-email-1", "lead-email-2"] } } });
  check("both email leads are back on LinkedIn", moved.every((l) => l.channel === "linkedin"));
  const after = moved.find((l) => l.id === "lead-email-1")!;
  check(
    "nothing else on a moved lead changed (stage, email, updatedAt)",
    after.stage === before[0].stage && after.email === before[0].email && after.updatedAt.getTime() === Number(before[0].updatedAt),
  );
  const log = await prisma.activityLog.findFirst({ where: { kind: "LEADS_MOVED_TO_LINKEDIN" } });
  check("the count is on record in the activity feed", log?.summary.startsWith("2 email-channel leads moved back to LinkedIn") === true, log?.summary);
  check("no lead was deleted", (await prisma.lead.count()) === 6);

  console.log("\nExisting candidates are LinkedIn");
  const existing = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: "cand-li" } });
  check("an existing candidate (even a Clinic-first one) is linkedin", existing.channel === "linkedin" && existing.linkedinConflictLeadId === null);
  check("it shows in the LinkedIn view, not Email",
    (await prisma.discoveryCandidate.count({ where: { channel: "linkedin", id: "cand-li" } })) === 1 &&
      (await prisma.discoveryCandidate.count({ where: { channel: "email" } })) === 0);
  check("Email Discovery shows 0", (await prisma.discoveryCandidate.count({ where: { channel: "email" } })) === 0);

  console.log("\nA Clinic-first search lands in Email");
  const clinic = (clinicName: string, location: string) => ({
    clinicName,
    location,
    websiteUrl: null,
    city: null,
    state: null,
    country: null,
    companyLinkedinUrl: null,
    facebookUrl: null,
    phone: null,
    email: null,
    emails: [],
    contactName: null,
    contactTitle: null,
    linkedinUrl: null,
    sourceQuery: "spinal decompression",
  });
  const plainBefore = await prisma.lead.findUniqueOrThrow({ where: { id: "lead-li-plain" } });
  const summary = await importClinicDiscoveryCandidates({
    clinics: [
      clinic("Old LinkedIn Clinic", "Houston, TX"),
      clinic("Existing Spine Candidate", "Austin, TX"),
      clinic("Old Email Clinic", "Austin, TX"),
      clinic("Talking Spine Center", "Plano, TX"),
      clinic("Booked Disc Clinic", "Frisco, TX"),
      clinic("Lost Back Clinic", "Waco, TX"),
    ],
  });
  check("all six created — none merged into or skipped for a LinkedIn record", summary.created === 6 && summary.merged === 0 && summary.skipped === 0, JSON.stringify(summary));
  const email = await prisma.discoveryCandidate.findMany({ where: { channel: "email" } });
  const byName = (n: string) => email.find((c) => c.clinicName === n);
  check("a clinic that is an old LinkedIn lead is a new email candidate", byName("Old LinkedIn Clinic")?.linkedinConflictLeadId === null);
  check("a clinic that is an old LinkedIn candidate is a new email candidate, the old one untouched",
    byName("Existing Spine Candidate") !== undefined &&
      (await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: "cand-li" } })).updatedAt.getTime() === existing.updatedAt.getTime());
  const plainAfter = await prisma.lead.findUniqueOrThrow({ where: { id: "lead-li-plain" } });
  check("the old LinkedIn lead is untouched", JSON.stringify(plainAfter) === JSON.stringify(plainBefore));

  console.log("\nTalking on LinkedIn");
  const talking = byName("Talking Spine Center")!;
  const booked = byName("Booked Disc Clinic")!;
  check("a match with an accepted LinkedIn lead is tagged with that lead", talking.linkedinConflictLeadId === "lead-li-accepted");
  check("a match with a lead at Discovery Call Booked is tagged", booked.linkedinConflictLeadId === "lead-li-booked");
  check("a Lost lead that never accepted or replied does not tag", byName("Lost Back Clinic")?.linkedinConflictLeadId === null);
  check("the import counts two tagged", summary.tagged === 2);

  const emailQueue = (await discoveryQueue("email")).map((c) => c.clinicName);
  check("the Email queue skips the tagged ones", emailQueue.length === 4 && !emailQueue.includes("Talking Spine Center") && !emailQueue.includes("Booked Disc Clinic"), emailQueue.join(", "));
  check("even when they are ticked", (await discoveryQueueSelected([talking.id, booked.id], "email")).length === 0);
  const linkedinQueue = (await discoveryQueue("linkedin")).map((c) => c.clinicName);
  check("the LinkedIn queue is the LinkedIn candidates only", JSON.stringify(linkedinQueue) === JSON.stringify(["Existing Spine Candidate"]), linkedinQueue.join(", "));

  const processed = await processDiscoveryCandidate(talking.id);
  const afterProcess = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: talking.id } });
  check("processing it directly spends nothing and promotes nothing", processed.promotedLeadId === null && afterProcess.status === "PENDING" && afterProcess.enrichedAt === null, processed.headline);

  let refused = false;
  try {
    await promoteToLead(talking.id, null, new Date());
  } catch (e) {
    refused = e instanceof TalkingOnLinkedinError;
  }
  check("promotion itself refuses it", refused);
  let redirectedTo = "";
  try {
    await promoteDiscoveryCandidate(talking.id);
  } catch (e) {
    redirectedTo = String((e as { digest?: string }).digest ?? "");
  }
  check("the Promote anyway override refuses it", redirectedTo.includes(`/discovery/${talking.id}`), redirectedTo);
  check("no lead was created for it", (await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: talking.id } })).promotedLeadId === null &&
    (await prisma.lead.count()) === 6);

  console.log("\nPromotion follows the candidate's channel");
  check("the Email pipeline still shows 0 before anything is promoted",
    (await prisma.lead.count({ where: { ...PIPELINE_DEFAULT_WHERE, channel: "email" } })) === 0);
  const emailLead = await prisma.lead.findUniqueOrThrow({ where: { id: await promoteToLead(byName("Old LinkedIn Clinic")!.id, null, new Date()) } });
  check("an email candidate promotes into the email channel", emailLead.channel === "email");
  const liLead = await prisma.lead.findUniqueOrThrow({ where: { id: await promoteToLead("cand-li", null, new Date()) } });
  check("an old Clinic-first candidate on LinkedIn promotes into LinkedIn", liLead.channel === "linkedin");

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
