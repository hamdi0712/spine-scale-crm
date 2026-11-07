// The outreach playbook rules (src/lib/emailRules.ts), on their own — no
// database, no model.
//
//   npx tsx tools/verify-email-playbook.ts

import {
  cleanClinicName,
  contactOrDoctor,
  inboxNameMismatch,
  openerReason,
  preSendCheck,
  validateContact,
  ContactLead,
} from "../src/lib/emailRules";
import { DEFAULT_EMAIL_SETTINGS, nextFollowUp } from "../src/lib/emailWorkflow";

let failures = 0;
function check(label: string, passed: boolean, detail = ""): void {
  if (!passed) failures++;
  console.log(`  ${passed ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nShort clinic name");
const short = (n: string) => cleanClinicName(n);
const worell = short("Kyle F. Worell D.C. PC Chiropractor | Spine Care, Sports Rehab & More");
check("Kyle F. Worell D.C. PC Chiropractor | … → Worell Chiropractic", worell.name === "Worell Chiropractic", JSON.stringify(worell));
check("Health for Life Spine & Disc Center → Health for Life", short("Health for Life Spine & Disc Center").name === "Health for Life", short("Health for Life Spine & Disc Center").name);
check("Ultra Spine Chiropractic- Houston Heights → Ultra Spine Chiropractic", short("Ultra Spine Chiropractic- Houston Heights").name === "Ultra Spine Chiropractic", short("Ultra Spine Chiropractic- Houston Heights").name);
check("legal suffixes go: Back in Motion Chiropractic, PLLC → Back in Motion", short("Back in Motion Chiropractic, PLLC").name === "Back in Motion", short("Back in Motion Chiropractic, PLLC").name);
check("a tagline after a colon goes (one distinctive word keeps its descriptor)", short("Align Wellness: Spine & Disc Care").name === "Align Wellness", short("Align Wellness: Spine & Disc Care").name);
check("nothing distinctive left is flagged", short("Chiropractic Center").flagged);

console.log("\nContact validation");
const base: ContactLead = {
  clinicName: "X",
  contactName: null,
  email: null,
  emailType: "generic",
  scorecardName: null,
  npiOfficialName: null,
  ownerStatus: null,
  ownerSource: null,
  contactNameByHand: false,
  contactConfirmedAt: null,
};
const v = (patch: Partial<ContactLead>) => validateContact({ ...base, ...patch });
check("blank contact → flagged", v({}).issues.length === 1);
check("…and {contactOrDoctor} is “the doctor”", contactOrDoctor(v({})) === "the doctor");
check("Dr. Megan (one name, nothing confirms it) → flagged", v({ contactName: "Dr. Megan" }).issues.length === 1);
check("Dr. Oswald, confirmed by the NPI owner → OK, Dr. Oswald",
  v({ contactName: "Dr. Oswald", npiOfficialName: "Peter Oswald" }).issues.length === 0 && contactOrDoctor(v({ contactName: "Dr. Oswald", npiOfficialName: "Peter Oswald" })) === "Dr. Oswald");
check("Dr. Oswald, confirmed by the scorecard → OK", v({ contactName: "Dr. Oswald", scorecardName: "Dr. Ann Oswald" }).issues.length === 0);
check("Dr. Oswald, confirmed by the email → OK", v({ contactName: "Dr. Oswald", email: "droswald@x.com", emailType: "owner" }).issues.length === 0);
check("Dr. Oswald, kept by hand → OK", v({ contactName: "Dr. Oswald", contactConfirmedAt: new Date() }).issues.length === 0);
check("a full name passes: Dr. David Hadden → Dr. Hadden", contactOrDoctor(v({ contactName: "Dr. David Hadden, DC" })) === "Dr. Hadden");
const hadden = v({ contactName: "David Hadden", email: "drottomeyer@clinic.com", emailType: "owner", npiOfficialName: "David Hadden", ownerSource: "npi" });
check("David Hadden with drottomeyer@ is flagged even though NPI-confirmed", hadden.issues.length === 1 && contactOrDoctor(hadden) === "the doctor", hadden.issues.join(" "));
check("…and even when kept by hand", v({ contactName: "David Hadden", email: "drottomeyer@clinic.com", emailType: "owner", contactConfirmedAt: new Date() }).issues.length === 1);
check("dhadden@ / drhadden@ / david@ are his", ["dhadden@x.com", "drhadden@x.com", "david@x.com"].every((e) => v({ contactName: "David Hadden", email: e, emailType: "owner" }).issues.length === 0));
check("info@ on an owner-type address is not a mismatch", v({ contactName: "David Hadden", email: "info@x.com", emailType: "owner" }).issues.length === 0);
check("a generic address is never checked for a mismatch", v({ contactName: "David Hadden", email: "drottomeyer@x.com", emailType: "generic" }).issues.length === 0);

console.log("\nThe opener screen");
const src = "Decompression: \"We offer spinal decompression on the DRX9000 and the X3-Laser.\" (Clinic website)";
const r = (o: string) => openerReason(o, { clinicName: "Health for Life Spine & Disc Center", sourceText: src });
check("a clean two-sentence opener passes", r("Your decompression page names the DRX9000, and booking is by phone only. Anyone ready to start has to call during office hours.") === null,
  r("Your decompression page names the DRX9000, and booking is by phone only. Anyone ready to start has to call during office hours.") ?? "");
check("X3-Laser from the site passes", r("Your site lists the X3-Laser, and new patients book by request form. Anyone ready to start waits to hear back.") === null);
check("a product name not on the site is rejected (DRX7000)", r("Your site lists the DRX7000. Anyone ready to start has to call.") !== null);
check("a bare number is rejected", r("Your ad has run for 30 days. Anyone clicking lands on your homepage.") !== null);
check("a percentage is rejected", r("Your homepage loses 30% of visitors.") !== null);
check("a question mark is rejected", r("Your site only takes calls. Is that on purpose?") !== null);
check("“I noticed” is rejected", r("I noticed your ad sends people to your homepage.") !== null);
check("“Quick question” is rejected", r("Quick question about your booking page.") !== null);
check("a banned phrase is rejected (more patients)", r("Your ad could bring in more patients with a booking page.") !== null);
check("a compliment is rejected", r("Your reviews are great. Patients love the team.") !== null);
check("the full clinic name is rejected", r("Health for Life Spine & Disc Center only books by phone.") !== null);
check("an internal process we can't see is rejected", r("Your site has no follow-up sequence. People slip away.") !== null);
check("“most clinics” is rejected", r("Your site books by phone, like most clinics.") !== null);
check("three sentences are rejected", r("Your ad runs. It goes to your homepage. People leave.") !== null);
check("over 40 words is rejected", r(`Your ad ${"sends people somewhere ".repeat(20)}.`) !== null);

console.log("\nThe pre-send check");
const opt = "If this isn’t relevant, just reply “no” and I won’t email again.";
const ctx = { optOutLine: opt, clinicName: "Health for Life Spine & Disc Center" };
const good = `Hi Dr. Smith,\n\nYour ad sends people to your homepage. Anyone ready to book has to go looking.\n\nI wrote down a few things I’d change on the new patient side. Already on top of it, or want me to send them?\n\n${opt}\n\n{sender}\nSpine Scale`;
check("the playbook email passes", preSendCheck("new patient booking", good, ctx).length === 0, preSendCheck("new patient booking", good, ctx).join(" "));
check("digits never block it (DRX9000, a postal code in the sign-off)", preSendCheck("new patient booking", good.replace("Your ad", "Your DRX9000 ad") + "\nManila 1004", ctx).length === 0);
check("two question marks fail", preSendCheck("s", good.replace("looking.", "looking?"), ctx).some((x) => /2 question marks/.test(x)));
check("no question mark fails", preSendCheck("s", good.replace("send them?", "send them."), ctx).some((x) => /0 question marks/.test(x)));
check("over 80 words fails", preSendCheck("s", good.replace("Anyone", "word ".repeat(70) + "Anyone"), ctx).some((x) => /words/.test(x)));
check("an unfilled placeholder fails", preSendCheck("s", good.replace("Dr. Smith", "{contactOrDoctor}"), ctx).some((x) => /Unfilled/.test(x)));
check("{sender} in the sign-off is not counted", !preSendCheck("s", good, ctx).some((x) => /sender/.test(x)));
check("a banned phrase fails", preSendCheck("s", good.replace("I wrote down", "I help clinics. I wrote down"), ctx).some((x) => /banned/.test(x)));
check("the full clinic name twice fails", preSendCheck("s", good.replace("Your ad", `${ctx.clinicName} and ${ctx.clinicName}`), ctx).some((x) => /full name/.test(x)));
check("subject with a colon fails", preSendCheck("Re: booking", good, ctx).length > 0);
check("subject with quotes fails", preSendCheck("“booking”", good, ctx).length > 0);
check("subject starting Re fails", preSendCheck("RE booking", good, ctx).length > 0);
check("an apostrophe in the subject is fine", preSendCheck("doctor’s booking", good, ctx).length === 0);

console.log("\nFollow-up timing");
const s = { ...DEFAULT_EMAIL_SETTINGS, followUpTemplates: ["a", "b"], followUpDelaysDays: [3, 5] };
const t0 = new Date("2026-11-01T10:00:00Z");
const day = (n: number) => new Date(t0.getTime() + n * 86_400_000);
check("follow-up 1 is due 3 days after Email 1", nextFollowUp([{ step: 0, sentAt: t0 }], s)?.dueAt.getTime() === day(3).getTime());
check("follow-up 2 is due 5 days after follow-up 1 (day 8)", nextFollowUp([{ step: 0, sentAt: t0 }, { step: 1, sentAt: day(3) }], s)?.dueAt.getTime() === day(8).getTime());

console.log("\nInbox display name");
check("amer@ vs Hamdi Domangcag warns", inboxNameMismatch("amer@spinescale.co", "Hamdi Domangcag"));
check("hamdi@ vs Hamdi Domangcag is fine", !inboxNameMismatch("hamdi@spinescale.co", "Hamdi Domangcag"));
check("hdomangcag@ is fine", !inboxNameMismatch("hdomangcag@spinescale.co", "Hamdi Domangcag"));
check("team@ never warns", !inboxNameMismatch("team@spinescale.co", "Hamdi Domangcag"));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
