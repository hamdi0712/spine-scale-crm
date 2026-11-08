// The Ad Hub compliance gate, driven through the server actions.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-adhub-compliance.ts
//
// Seeds one concept and creative, then checks: no status from Ready onward is
// reachable without the checklist, Ready is refused while the compliant
// headline is empty or repeats the raw hook, editing live copy unticks the
// checklist and drops a gated creative back to compliance review, and editing
// only the raw hook does not.

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

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

async function main(): Promise<void> {
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  const act = await import("../src/lib/actions/adhub");
  const { AD_COMPLIANCE_ITEMS, COMPLIANCE_GATED_STATUSES } = await import("../src/lib/adhub");

  const persona = await prisma.persona.create({ data: { name: "Verify persona" } });
  const desire = await prisma.desire.create({ data: { statement: "Verify desire" } });
  const benefit = await prisma.benefit.create({
    data: { desireId: desire.id, productName: "P", feature: "F", benefit: "B" },
  });
  const concept = await prisma.concept.create({
    data: {
      name: "Verify concept",
      personaId: persona.id,
      desireId: desire.id,
      benefitId: benefit.id,
      awarenessLevel: "PROBLEM_AWARE",
      sophisticationStage: 1,
    },
  });
  const creative = await prisma.creative.create({
    data: {
      conceptId: concept.id,
      rawHook: "Fix your sciatica in 3 visits",
      conceptHeadline: "",
      adHeadline: "A spine assessment built around your week",
      adCopy: "Book an assessment.",
      cta: "Book now",
      compliance: { create: AD_COMPLIANCE_ITEMS.map((item, i) => ({ item, sortOrder: i })) },
    },
  });
  const id = creative.id;
  const load = () =>
    prisma.creative.findUniqueOrThrow({ where: { id }, include: { compliance: true } });
  const setStatus = (status: string) => act.setCreativeStatus(id, form({ status }));
  const tickAll = () => prisma.complianceCheck.updateMany({ where: { creativeId: id }, data: { checked: true } });
  const editForm = (over: Record<string, string>) => {
    const base = {
      creativeType: "PHOTO",
      creativeNumber: "1",
      rawHook: "Fix your sciatica in 3 visits",
      conceptHeadline: "A back assessment that fits your workday",
      adHeadline: "A spine assessment built around your week",
      adCopy: "Book an assessment.",
      cta: "Book now",
    };
    return form({ ...base, ...over });
  };

  console.log("Gate without checks");
  await setStatus("LAUNCHED");
  check("Draft → Launched refused without checks", (await load()).status === "DRAFT");
  for (const s of COMPLIANCE_GATED_STATUSES) {
    await setStatus(s);
    check(`Draft → ${s} refused without checks`, (await load()).status === "DRAFT");
  }
  await setStatus("COMPLIANCE_REVIEW");
  check("Compliance review stays reachable", (await load()).status === "COMPLIANCE_REVIEW");

  console.log("Compliant headline");
  await tickAll();
  await setStatus("READY");
  check("Ready refused when the compliant headline is empty", (await load()).status === "COMPLIANCE_REVIEW");

  await prisma.creative.update({ where: { id }, data: { conceptHeadline: "  fix your SCIATICA in 3 visits " } });
  await setStatus("READY");
  check("Ready refused when compliant repeats the raw hook", (await load()).status === "COMPLIANCE_REVIEW");

  await prisma.creative.update({ where: { id }, data: { conceptHeadline: "A back assessment that fits your workday" } });
  await setStatus("READY");
  check("Ready allowed once checked and rewritten", (await load()).status === "READY");
  await setStatus("LAUNCHED");
  check("Ready → Launched allowed", (await load()).status === "LAUNCHED");

  console.log("Editing copy");
  await act.updateCreative(id, editForm({ rawHook: "A different internal draft" }));
  let c = await load();
  check("Editing only the raw hook keeps checks", c.compliance.every((x) => x.checked));
  check("Editing only the raw hook keeps status", c.status === "LAUNCHED");

  await act.updateCreative(id, editForm({ rawHook: "A different internal draft", adCopy: "Book a free assessment today." }));
  c = await load();
  check("Editing ad copy unticks every check", c.compliance.every((x) => !x.checked && x.checkedAt === null));
  check("Editing ad copy drops Launched to Compliance review", c.status === "COMPLIANCE_REVIEW");

  for (const [field, value] of [
    ["conceptHeadline", "An assessment for people with busy weeks"],
    ["adHeadline", "Book a spine assessment around your schedule"],
    ["cta", "Learn more"],
  ] as const) {
    await tickAll();
    await prisma.creative.update({ where: { id }, data: { status: "TESTING" } });
    const before = await load();
    await act.updateCreative(
      id,
      editForm({
        rawHook: before.rawHook,
        conceptHeadline: before.conceptHeadline,
        adHeadline: before.adHeadline,
        adCopy: before.adCopy,
        cta: before.cta,
        [field]: value,
      }),
    );
    c = await load();
    check(`Editing ${field} resets checks and status`, c.compliance.every((x) => !x.checked) && c.status === "COMPLIANCE_REVIEW");
  }

  console.log("Unticking");
  await tickAll();
  await prisma.creative.update({ where: { id }, data: { status: "WINNER" } });
  await act.toggleComplianceItem(c.compliance[0].id);
  check("Unticking an item drops Winner to Compliance review", (await load()).status === "COMPLIANCE_REVIEW");

  await prisma.persona.delete({ where: { id: persona.id } });
  await prisma.benefit.delete({ where: { id: benefit.id } });
  await prisma.desire.delete({ where: { id: desire.id } });
  await prisma.$disconnect();

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
