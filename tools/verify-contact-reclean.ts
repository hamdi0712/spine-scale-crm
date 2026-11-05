// The re-clean clears contact names that are not names, wherever they came
// from, and keeps names set by hand.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-contact-reclean.ts

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

async function main(): Promise<void> {
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must point at a scratch database with 'verify' in its name.");
  const { prisma } = await import("../src/lib/prisma");
  const { recleanEmailLeads } = await import("../src/lib/ownerReclean");
  const { contactNameFailsRules } = await import("../src/lib/ownerFind");
  const tag = " (reclean verify)";
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: tag } } });
  const seed = (n: string, data: Record<string, unknown>) =>
    prisma.lead.create({ data: { clinicName: n + tag, stage: "NEW", channel: "email", ...data } });

  console.log("\nThe rule");
  for (const [n, bad] of [["Dr. Iguess", true], ["Dr. Physical Therapists", true], ["Welcome Team", true],
    ["Dr. Lee", false], ["Dr. Sean McDonald", false], ["Jane Smith", false], ["Dr. O'Brien", false]] as const) {
    check(`${n} → ${bad ? "not a name" : "a name"}`, contactNameFailsRules(n) === bad);
  }

  console.log("\nThe re-clean");
  // Vanguard's shape: from Maps contacts, never owner-checked.
  const vanguard = await seed("Vanguard Spine & Sport", { contactName: "Dr. Iguess", email: "scheduling@vanguardspine.com", emailSource: "maps_contacts", emailStatus: "risky" });
  const linkedin = await seed("LinkedIn Clinic", { channel: "linkedin", contactName: "Dr. Thanks" });
  const real = await seed("Real Name Clinic", { contactName: "Dr. Lee" });
  const typed = await seed("Typed Clinic", { contactName: "Dr. Iguess", contactNameByHand: true });
  const picked = await seed("Picked Clinic", { contactName: "Dr. Physical", ownerSource: "manual", ownerStatus: "confirmed" });
  const r = await recleanEmailLeads();
  const get = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
  check("Vanguard's \"Dr. Iguess\" is cleared", (await get(vanguard.id)).contactName === null, JSON.stringify(r.changes.filter((c) => c.clinicName.endsWith(tag))));
  check("and logged in the activity feed", (await prisma.activityLog.count({ where: { leadId: vanguard.id, kind: "CONTACT_NAME_CLEARED" } })) === 1);
  check("a junk name on a non-email lead is cleared too", (await get(linkedin.id)).contactName === null);
  check("a real short name is kept", (await get(real.id)).contactName === "Dr. Lee");
  check("a name typed by hand is kept, even if it fails", (await get(typed.id)).contactName === "Dr. Iguess");
  check("an owner picked by hand is kept", (await get(picked.id)).contactName === "Dr. Physical");
  const again = await recleanEmailLeads();
  check("a second run changes nothing", again.changes.filter((c) => c.clinicName.endsWith(tag)).length === 0);

  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: tag } } });
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
