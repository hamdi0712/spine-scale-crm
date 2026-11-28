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
  const { CONTACT_TABS, STATUS_TABS, NO_SELECTION, chipCount, visibleRows, pressChip, readFilter, readSelection, writeSelection, parseViewState, serializeViewState } =
    await import("../src/lib/emailFilters");
  const { duplicateIndex, matchTag } = await import("../src/lib/duplicates");
  const { loadEmailView } = await import("../src/lib/emailWorkflowRead");

  const TAG = "(filters verify)";
  await prisma.lead.deleteMany({ where: { clinicName: { endsWith: TAG } } });
  await prisma.lead.updateMany({ where: { channel: "email" }, data: { channel: "linkedin" } });
  const mk = (name: string, data: Record<string, unknown>) =>
    prisma.lead.create({ data: { clinicName: `${name} ${TAG}`, stage: "NEW", channel: "email", ...data } });

  console.log("\nThe chips");
  check("contact chips: All, Owner, Front desk, Contact form", CONTACT_TABS.map(([, l]) => l).join(", ") === "All, Owner, Front desk, Contact form");
  check("status chips: Due today, Ready, Needs work, In sequence, Done, Lost", STATUS_TABS.map(([, l]) => l).join(", ") === "Due today, Ready, Needs work, In sequence, Done, Lost");
  check("Has email, No email and Risky are gone", readFilter("email") === null && readFilter("noemail") === null && readFilter("risky") === null);

  await mk("Owner One", { contactStatus: "owner_email", email: "drone@one.test", emailType: "owner", emailStatus: "valid" });
  await mk("Owner Lost", { contactStatus: "owner_email", email: "drlost@lost.test", emailType: "owner", emailStatus: "valid", stage: "LOST" });
  await mk("Desk One", { contactStatus: "front_desk", email: "info@deskone.test", emailType: "generic", emailStatus: "valid" });
  await mk("Form One", { contactStatus: "contact_form" });
  const live = (await loadEmailView()).rows.filter((r) => r.clinicName.endsWith(TAG));
  const none = { tiers: [], inbox: "", query: "" };
  const stored = async (status: string) => prisma.lead.count({ where: { clinicName: { endsWith: TAG }, contactStatus: status, stage: { not: "LOST" } } });
  check("Owner = contactStatus owner_email, Lost left out", chipCount(live, NO_SELECTION, "owner", none) === (await stored("owner_email")), String(chipCount(live, NO_SELECTION, "owner", none)));
  check("Front desk = contactStatus front_desk", chipCount(live, NO_SELECTION, "desk", none) === (await stored("front_desk")));
  check("Contact form = contactStatus contact_form", chipCount(live, NO_SELECTION, "form", none) === (await stored("contact_form")));
  check("All leaves Lost out; Lost holds only it", chipCount(live, NO_SELECTION, "all", none) === live.length - 1 && chipCount(live, NO_SELECTION, "lost", none) === 1);

  console.log("\nEvery count is the list it would show — every combination, tier A and all tiers");
  // A made-up pipeline with every kind of lead, so every combination has
  // something in it and something left out.
  const statuses = ["ready", "needs_opener", "check_email", "in_sequence", "replied", "contact_form"] as const;
  const contacts = ["owner_email", "front_desk", "contact_form"] as const;
  const rows: Parameters<typeof visibleRows>[0] = [];
  let n = 0;
  for (const cs of contacts)
    for (const st of statuses)
      for (const tier of ["A", "B", null] as const)
        for (const stage of ["NEW", "LOST"])
          rows.push({
            clinicName: `${n % 3 === 0 ? "Harbor" : "Clinic"} ${n++}`, contactName: null, location: null, email: null,
            icpTier: tier, inbox: n % 3 === 0 ? "hamdi@spinescale.co" : "team@spinescale.co",
            contactStatus: cs, status: st as never, stage, followUpDueToday: st === "in_sequence" && n % 2 === 0,
          });
  // The rules written out again, plainly, to check the module against.
  const STATUS_OF: Record<string, string[]> = { ready: ["ready"], work: ["needs_opener", "needs_manual_opener", "check_email", "check_contact", "check_clinic_name", "no_email"], sequence: ["in_sequence"], done: ["replied", "stopped", "not_ab"] };
  const CONTACT_OF: Record<string, string | null> = { all: null, owner: "owner_email", desk: "front_desk", form: "contact_form" };
  const expected = (contact: string, status: string | null, v: { tiers: string[]; inbox: string; query: string }) =>
    rows.filter((r) => {
      const lostByName = v.query !== "" && r.stage === "LOST" && r.clinicName.toLowerCase().includes(v.query.toLowerCase());
      const lostOk = r.stage === "LOST" ? status === "lost" || lostByName : status !== "lost";
      const contactOk = CONTACT_OF[contact] === null || r.contactStatus === CONTACT_OF[contact];
      const statusOk = status === null || status === "lost" || (status === "due" ? r.followUpDueToday : (STATUS_OF[status] ?? []).includes(r.status as string));
      const statusOkForLostByName = r.stage === "LOST" && lostByName && status !== "lost" ? true : statusOk;
      return (
        lostOk && contactOk && statusOkForLostByName &&
        (v.tiers.length === 0 || (r.icpTier !== null && v.tiers.includes(r.icpTier))) &&
        (v.inbox === "" || r.inbox === v.inbox) &&
        (v.query === "" || r.clinicName.toLowerCase().includes(v.query.toLowerCase()))
      );
    }).length;
  const views = [
    { name: "all tiers", v: { tiers: [] as string[], inbox: "", query: "" } },
    { name: "tier A only", v: { tiers: ["A"], inbox: "", query: "" } },
    { name: "tier A + one inbox", v: { tiers: ["A"], inbox: "hamdi@spinescale.co", query: "" } },
    { name: "all tiers + a search", v: { tiers: [] as string[], inbox: "", query: "harbor" } },
  ];
  const statusChoices: (string | null)[] = [null, ...STATUS_TABS.map(([k]) => k)];
  let combos = 0;
  let wrong: string[] = [];
  for (const { name, v } of views)
    for (const [contact] of CONTACT_TABS)
      for (const status of statusChoices) {
        const sel = { contact, status } as Parameters<typeof visibleRows>[1];
        combos++;
        // The list for this selection…
        if (visibleRows(rows, sel, v).length !== expected(contact, status, v)) wrong.push(`${name}: ${contact}+${status} list`);
        // …and every chip's count beside it is the list pressing it gives.
        for (const [chip] of [...CONTACT_TABS, ...STATUS_TABS]) {
          const shownAfter = visibleRows(rows, pressChip(sel, chip), v).length;
          const isActiveStatus = sel.status === chip;
          const counted = chipCount(rows, sel, chip, v);
          const listWith = isActiveStatus ? visibleRows(rows, sel, v).length : shownAfter;
          if (counted !== listWith) wrong.push(`${name}: ${contact}+${status}, chip ${chip}: count ${counted} ≠ list ${listWith}`);
        }
      }
  check(`count shown = rows listed, for every chip in all ${combos} reachable selections`, wrong.length === 0, wrong.slice(0, 3).join("; "));
  const tierA = { tiers: ["A"], inbox: "", query: "" };
  check("tier A only: In sequence counts only tier-A leads, as the list shows",
    chipCount(rows, NO_SELECTION, "sequence", tierA) === visibleRows(rows, { contact: "all", status: "sequence" }, tierA).length &&
      chipCount(rows, NO_SELECTION, "sequence", tierA) < chipCount(rows, NO_SELECTION, "sequence", none));
  const inSeq = { contact: "all" as const, status: "sequence" as const };
  check("with In sequence picked, Front desk counts the front-desk leads in sequence",
    chipCount(rows, inSeq, "desk", none) === rows.filter((r) => r.stage !== "LOST" && r.status === "in_sequence" && r.contactStatus === "front_desk").length);
  check("Lost never counts under All, Owner, Front desk or Contact form",
    (["all", "owner", "desk", "form"] as const).every((c) => visibleRows(rows, { contact: c, status: null }, none).every((r) => r.stage !== "LOST")));
  check("…only under Lost — unless a search finds one by name",
    visibleRows(rows, { contact: "all", status: "lost" }, none).every((r) => r.stage === "LOST") &&
      visibleRows(rows, NO_SELECTION, { tiers: [], inbox: "", query: "harbor" }).some((r) => r.stage === "LOST"));
  check("one contact chip and one status chip at a time; the status chip toggles off",
    JSON.stringify(pressChip({ contact: "owner", status: "work" }, "desk")) === JSON.stringify({ contact: "desk", status: "work" }) &&
      JSON.stringify(pressChip({ contact: "owner", status: "work" }, "ready")) === JSON.stringify({ contact: "owner", status: "ready" }) &&
      pressChip({ contact: "owner", status: "work" }, "work").status === null);
  check("remembered as \"owner,work\"; an older list or a ?tab= link reads back",
    writeSelection({ contact: "owner", status: "work" }) === "owner,work" &&
      JSON.stringify(readSelection("owner,work")) === JSON.stringify({ contact: "owner", status: "work" }) &&
      JSON.stringify(readSelection("due")) === JSON.stringify({ contact: "all", status: "due" }) &&
      readSelection("risky") === null);

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
