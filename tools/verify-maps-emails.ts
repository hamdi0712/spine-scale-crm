// Emails off the Clinic-first Maps search.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-maps-emails.ts
//
// Seeds a Maps result as the crawler returns it with scrapeContacts on — one
// clinic with its own address and a web vendor's, one with only a vendor's,
// one with a Gmail inbox and no website, one with no email at all — and runs
// it through the same normalise, import and promotion the app uses. Checks the
// search asks for contacts, that vendor and junk addresses are dropped, that
// the best address is the email and the rest are alternates, that every one
// is source maps_contacts and not checked, that a merge never puts them beside
// an email already there, that promotion carries them to the lead (re-labelled
// once a person is named), and what the confirm dialog prices the add-on at.

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

const TAG = "Maps email verify";

async function main(): Promise<void> {
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  const { itemsToTable } = await import("../src/lib/apify");
  const { clinicSearchInput, normalizeClinicRow, DEFAULT_CLINIC_SEARCH_CONFIG } = await import("../src/lib/clinicDiscovery");
  const { importClinicDiscoveryCandidates } = await import("../src/lib/actions/clinicDiscovery");
  const { promoteToLead } = await import("../src/lib/promoteLead");
  const { parseAlternates, effectiveEmailSource, EMAIL_SOURCE_LABELS, EMAIL_STATUS_LABELS, readEmailStatus } = await import("../src/lib/emailFind");
  const { mapsContactsCost, fmtEstimate } = await import("../src/lib/pipelineSettings");

  const clean = async () => {
    const rows = await prisma.discoveryCandidate.findMany({ where: { clinicName: { startsWith: TAG } }, select: { promotedLeadId: true } });
    await prisma.discoveryCandidate.deleteMany({ where: { clinicName: { startsWith: TAG } } });
    const leadIds = rows.flatMap((r) => (r.promotedLeadId ? [r.promotedLeadId] : []));
    if (leadIds.length > 0) await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  };
  await clean();

  console.log("\nThe search asks for contacts");
  const input = clinicSearchInput("spinal decompression", DEFAULT_CLINIC_SEARCH_CONFIG);
  check("scrapeContacts: true is in the actor input", input.scrapeContacts === true);

  console.log("\nThe seeded Maps result, normalised");
  // As compass~crawler-google-places returns places with scrapeContacts on.
  const items = [
    {
      title: `${TAG} — Austin Spine Center`,
      website: "https://www.austinspine.com/",
      address: "100 Congress Ave, Austin, TX 78701",
      city: "Austin",
      state: "Texas",
      phone: "(512) 555-0100",
      emails: ["info@austinspine.com", "support@wix.com", "hello@pixelwebdesigns.com", "logo@2x.png", "drsmith@austinspine.com"],
    },
    {
      title: `${TAG} — Vendor Only Chiropractic`,
      website: "https://vendoronlychiro.com",
      address: "200 Main St, Dallas, TX 75201",
      emails: ["hello@pixelwebdesigns.com"],
    },
    {
      title: `${TAG} — Gmail Back Clinic`,
      address: "300 Elm St, Houston, TX 77002",
      emails: ["gmailbackclinic@gmail.com", "frontdesk@someotherbiz.com"],
    },
    {
      title: `${TAG} — No Email Disc Center`,
      website: "https://noemaildisc.com",
      address: "400 Oak St, San Antonio, TX 78205",
    },
  ];
  const table = itemsToTable(items, items.length);
  const clinics = table.rows.map((cells) => normalizeClinicRow({ headers: table.headers, cells }, "spinal decompression")!);
  check("every result read as a clinic", clinics.every((c) => c !== null) && clinics.length === 4);
  check(
    "the emails list comes through the flatten",
    clinics[0].emails.length === 5 && clinics[0].emails[0] === "info@austinspine.com",
    JSON.stringify(clinics[0].emails),
  );
  check("a place with no emails has none", clinics[3].emails.length === 0 && clinics[3].email === null);

  console.log("\nImport");
  // Through JSON, as the browser round trip sends it.
  const summary = await importClinicDiscoveryCandidates({ clinics: JSON.parse(JSON.stringify(clinics)), actorId: "compass~crawler-google-places" });
  check("four candidates created", summary.created === 4, JSON.stringify(summary));

  const byName = async (suffix: string) =>
    prisma.discoveryCandidate.findFirstOrThrow({ where: { clinicName: `${TAG} — ${suffix}` } });

  const austin = await byName("Austin Spine Center");
  const austinAlts = parseAlternates(austin.emailAlternates);
  check("clinic email is the main email", austin.email === "info@austinspine.com", String(austin.email));
  check("labelled generic (nobody named yet)", austin.emailType === "generic", String(austin.emailType));
  check("source is maps contacts", austin.emailSource === "maps_contacts" && EMAIL_SOURCE_LABELS.maps_contacts === "Maps contacts");
  check("status null: not checked", austin.emailStatus === null && EMAIL_STATUS_LABELS[readEmailStatus(austin.emailStatus) ?? "unchecked"] === "Not checked");
  check(
    "the other clinic address is the only alternate",
    austinAlts.length === 1 && austinAlts[0].address === "drsmith@austinspine.com" && austinAlts[0].status === null && austinAlts[0].source === "maps_contacts",
    austin.emailAlternates ?? "null",
  );
  const all = [austin.email, ...austinAlts.map((a) => a.address)].join(" ");
  check("web-vendor and builder addresses dropped", !/wix\.com|pixelwebdesigns/.test(all), all);
  check("junk (image name) dropped", !/2x\.png/.test(all));

  const vendor = await byName("Vendor Only Chiropractic");
  check(
    "only a vendor address → no email at all",
    vendor.email === null && vendor.emailSource === null && vendor.emailAlternates === null && vendor.emailType === null,
  );

  const gmail = await byName("Gmail Back Clinic");
  check("a Gmail inbox is kept with no website", gmail.email === "gmailbackclinic@gmail.com", String(gmail.email));
  check("another business's domain is not", gmail.emailAlternates === null, String(gmail.emailAlternates));

  const none = await byName("No Email Disc Center");
  check("no email → nothing stored", none.email === null && none.emailSource === null && none.emailType === null && none.emailAlternates === null);

  console.log("\nA second sighting merges without overwriting");
  await prisma.discoveryCandidate.update({ where: { id: none.id }, data: { email: "typed@noemaildisc.com" } });
  const again = await importClinicDiscoveryCandidates({
    clinics: [
      { ...clinics[3], emails: ["office@noemaildisc.com"] },
      { ...clinics[1], emails: ["contact@vendoronlychiro.com"] },
    ],
  });
  check("both merged, none created", again.merged === 2 && again.created === 0, JSON.stringify(again));
  const noneAfter = await byName("No Email Disc Center");
  check(
    "an email already there is kept, and nothing labels it as Maps",
    noneAfter.email === "typed@noemaildisc.com" && noneAfter.emailSource === null && noneAfter.emailAlternates === null,
  );
  const vendorAfter = await byName("Vendor Only Chiropractic");
  check(
    "a blank email is filled from the new sighting",
    vendorAfter.email === "contact@vendoronlychiro.com" && vendorAfter.emailSource === "maps_contacts" && vendorAfter.emailStatus === null,
  );

  console.log("\nPromotion");
  // The decision-maker stage names somebody after the search ran.
  await prisma.discoveryCandidate.update({ where: { id: austin.id }, data: { contactName: "Dr. John Smith" } });
  const now = new Date();
  const leadId = await promoteToLead(austin.id, null, now);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const leadAlts = parseAlternates(lead.emailAlternates);
  check("lead is on the email channel", lead.channel === "email", lead.channel);
  check("the owner's address becomes the main email once a person is named", lead.email === "drsmith@austinspine.com" && lead.emailType === "owner", `${lead.email} ${lead.emailType}`);
  check(
    "the front desk becomes the alternate",
    leadAlts.length === 1 && leadAlts[0].address === "info@austinspine.com" && leadAlts[0].type === "generic",
    lead.emailAlternates ?? "null",
  );
  check("lead source maps contacts, not checked", effectiveEmailSource(lead) === "maps_contacts" && lead.emailStatus === null && lead.emailCheckedAt === null);

  const noneLeadId = await promoteToLead(noneAfter.id, null, now);
  const noneLead = await prisma.lead.findUniqueOrThrow({ where: { id: noneLeadId } });
  check(
    "an email from elsewhere promotes as it stands",
    noneLead.email === "typed@noemaildisc.com" && noneLead.emailSource === null && effectiveEmailSource(noneLead) === "imported",
  );

  console.log("\nThe confirm dialog's price");
  check("9 terms × 20 results at $0.002/place = $0.36", fmtEstimate(mapsContactsCost(9, 20)) === "~$0.36", fmtEstimate(mapsContactsCost(9, 20)));
  check("1 term × 1 result reads as under a cent", fmtEstimate(mapsContactsCost(1, 1)) === "<$0.01");

  await clean();
  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
