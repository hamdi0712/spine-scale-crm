// The Pipeline's Email view: the filter chips (Owner and Front desk off the
// contact finder's contactStatus), what it remembers between visits, and the
// same clinic on another lead — a Duplicate only on the same channel,
// "On LinkedIn" / "On Call" otherwise.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-pipeline-filters.ts
//
// The browser half (tier A + Front desk, open a lead, back) was checked on a
// production build with Playwright; the remembered state is checked here.

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
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  const { FILTER_TABS, matchesFilter, readFilter, parseViewState, serializeViewState } = await import("../src/lib/emailFilters");
  const { duplicateIndex, matchTag } = await import("../src/lib/duplicates");
  const { loadEmailView } = await import("../src/lib/emailWorkflowRead");

  const TAG = "(filters verify)";
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: TAG } } });
  await prisma.lead.updateMany({ where: { channel: "email" }, data: { channel: "linkedin" } });
  const mk = (name: string, data: Record<string, unknown>) =>
    prisma.lead.create({ data: { clinicName: `${name} ${TAG}`, stage: "NEW", channel: "email", ...data } });

  console.log("\nThe chips");
  check("in order: All, Owner, Front desk, Contact form, Due today, Ready, Needs work, In sequence, Done, Lost",
    FILTER_TABS.map(([, l]) => l).join(", ") === "All, Owner, Front desk, Contact form, Due today, Ready, Needs work, In sequence, Done, Lost",
    FILTER_TABS.map(([, l]) => l).join(", "));
  check("Has email, No email and Risky are gone; a remembered one reads as nothing", readFilter("email") === null && readFilter("noemail") === null && readFilter("risky") === null);

  await mk("Owner One", { contactStatus: "owner_email", email: "drone@one.test", emailType: "owner", emailStatus: "valid" });
  await mk("Owner Two", { contactStatus: "owner_email", email: "drtwo@two.test", emailType: "owner", emailStatus: "valid" });
  await mk("Owner Lost", { contactStatus: "owner_email", email: "drlost@lost.test", emailType: "owner", emailStatus: "valid", stage: "LOST" });
  await mk("Desk One", { contactStatus: "front_desk", email: "info@deskone.test", emailType: "generic", emailStatus: "valid" });
  await mk("Form One", { contactStatus: "contact_form" });
  const view = await loadEmailView();
  const rows = view.rows.filter((r) => r.clinicName.endsWith(TAG));
  const count = (f: Parameters<typeof matchesFilter>[1]) => rows.filter((r) => matchesFilter(r, f)).length;
  const stored = async (status: string) => prisma.lead.count({ where: { clinicName: { endsWith: TAG }, contactStatus: status, stage: { not: "LOST" } } });
  check("Owner = contactStatus owner_email (Lost left out)", count("owner") === (await stored("owner_email")) && count("owner") === 2, String(count("owner")));
  check("Front desk = contactStatus front_desk", count("desk") === (await stored("front_desk")) && count("desk") === 1, String(count("desk")));
  check("the Lost lead is only under Lost", count("lost") === 1 && !rows.filter((r) => matchesFilter(r, "owner")).some((r) => /Owner Lost/.test(r.clinicName)));
  check("All counts every lead but the Lost one", count("all") === rows.length - 1);

  console.log("\nMore than one chip");
  const { matchesSelection, toggleFilter, chipCount, readSelection } = await import("../src/lib/emailFilters");
  const r = (contactStatus: string, status: string, extra: Record<string, unknown> = {}) =>
    ({ contactStatus, status, stage: "NEW", followUpDueToday: false, ...extra }) as Parameters<typeof matchesSelection>[0];
  const sample = [
    r("owner_email", "needs_opener"),
    r("owner_email", "ready"),
    r("front_desk", "needs_opener"),
    r("front_desk", "in_sequence", { followUpDueToday: true }),
    r("owner_email", "needs_opener", { stage: "LOST" }),
  ];
  const shown = (sel: Parameters<typeof matchesSelection>[1]) => sample.filter((x) => matchesSelection(x, sel)).length;
  check("Owner + Needs work: only owner leads that need work (different groups narrow)", shown(["owner", "work"]) === 1);
  check("Ready + Needs work: either (same group widens)", shown(["ready", "work"]) === 3);
  check("Owner + Front desk: either", shown(["owner", "desk"]) === 4);
  check("nothing picked = All, Lost left out", shown([]) === 4);
  check("Lost shows only when Lost is picked, and narrows with Owner", shown(["lost"]) === 1 && shown(["owner", "lost"]) === 1 && shown(["owner"]) === 2);
  check("pressing a chip adds or removes it; All clears them",
    JSON.stringify(toggleFilter(["owner"], "work")) === JSON.stringify(["owner", "work"]) &&
      JSON.stringify(toggleFilter(["owner", "work"], "owner")) === JSON.stringify(["work"]) &&
      toggleFilter(["owner", "work"], "all").length === 0);
  check("counts follow the other group: with Owner picked, Needs work counts 1", chipCount(sample, ["owner"], "work") === 1 && chipCount(sample, [], "work") === 2);
  check("…and Front desk counts what it would show beside Needs work", chipCount(sample, ["owner", "work"], "desk") === 1);
  check("the picked chips are remembered as a list", JSON.stringify(readSelection("owner,work")) === JSON.stringify(["owner", "work"]) && readSelection("all")?.length === 0 && readSelection("risky") === null);

  console.log("\nRemembered between visits");
  const st = { tiers: ["A"], sort: "score" as const, query: "spine", inbox: "hamdi@spinescale.co" };
  const back = parseViewState(serializeViewState(st));
  check("tiers, sort, search and inbox read back as they were", JSON.stringify(back) === JSON.stringify(st), JSON.stringify(back));
  check("a damaged value is ignored, not trusted", parseViewState("{not json") === null && parseViewState(JSON.stringify({ tiers: ["Z"], sort: "x" }))?.tiers.length === 0);

  console.log("\nThe same clinic on another lead");
  const lead = (id: string, channel: string, stage = "NEW") => ({
    id, clinicName: `Clinic ${id}`, channel, stage, websiteUrl: "https://straussmethod.test", contactName: null, location: null,
  });
  const idx = duplicateIndex([lead("email1", "email"), lead("li1", "linkedin", "CONTACTED")]);
  const onLi = matchTag("email", idx.get("email1")![0]);
  check("a LinkedIn match: \"On LinkedIn\", neutral — not Duplicate", onLi.kind === "elsewhere" && onLi.pill === "On LinkedIn", onLi.pill);
  check("…tooltip \"<lead> · LinkedIn · <stage>\"", onLi.tooltip === "Clinic li1 · LinkedIn · Contacted", onLi.tooltip);
  check("…lead page chip \"Also on LinkedIn: <lead> · <stage>\"", onLi.chip === "Also on LinkedIn: Clinic li1 · Contacted", onLi.chip);
  const idx2 = duplicateIndex([lead("email1", "email"), lead("email2", "email")]);
  const same = matchTag("email", idx2.get("email1")![0]);
  check("the same channel (email + email): still Duplicate", same.kind === "duplicate" && same.pill === "Duplicate");
  const idx3 = duplicateIndex([lead("li1", "linkedin"), lead("li2", "linkedin")]);
  check("two LinkedIn leads: Duplicate", matchTag("linkedin", idx3.get("li1")![0]).kind === "duplicate");
  const idx4 = duplicateIndex([lead("email1", "email"), lead("call1", "call")]);
  const onCall = matchTag("email", idx4.get("email1")![0]);
  check("a Call match: \"On Call\", neutral", onCall.kind === "elsewhere" && onCall.pill === "On Call", onCall.pill);
  await prisma.lead.create({ data: { clinicName: `Strauss LinkedIn ${TAG}`, channel: "linkedin", stage: "CONTACTED", websiteUrl: "https://straussmethod.test" } });
  await mk("Strauss Email", { contactStatus: "front_desk", websiteUrl: "https://straussmethod.test", email: "info@straussmethod.test", emailType: "generic", emailStatus: "valid" });
  const row = (await loadEmailView()).rows.find((r) => r.clinicName === `Strauss Email ${TAG}`)!;
  check("on the Pipeline row: \"On LinkedIn\", no Duplicate", row.duplicates.length === 1 && row.duplicates[0].kind === "elsewhere" && row.duplicates[0].pill === "On LinkedIn");

  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: TAG } } });
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
