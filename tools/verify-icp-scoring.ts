// Does the ICP model judge fit first, cite everything, and change nothing while
// it is only being compared?
//
// This seeds a small set of clinics the way the queue would have left them —
// stored enrichment, an old-model (A–D, out of 10) verdict and breakdown — and
// runs the real Compare scoring actions against them: start, score each one,
// finish. It then checks what each clinic would become, that the evidence rules
// threw out the flags they exist to throw out, that no candidate or lead moved,
// and that "Apply new scoring" stayed locked until the run finished.
//
// The set is the brief's seven — a yoga studio, an education business, an
// insurance-only PT clinic, a hybrid clinic that lists its insurers, a
// 12-location PE-backed group, a general sports chiro, a spinal decompression
// clinic — plus three that exercise the paths those seven do not: a
// chiropractic-first clinic without a real program and one with (the chiro
// real-program check), a lead with
// a Maps listing and no website (the "No website" rule), and a lead nothing was
// ever gathered for (Failed, not Rejected).
//
// The model is scripted (tools/deepseek-json-stub.cjs) unless DEEPSEEK_API_KEY
// is set, and the scripted replies include the mistakes the guards exist for.
// Run it against a scratch database, never a real one — it deletes candidates
// and leads:
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-icp-scoring.ts

import Module from "node:module";
import path from "node:path";

const CACHE_STUB = path.join(__dirname, "next-cache-stub.cjs");
const DEEPSEEK_STUB = path.join(__dirname, "deepseek-json-stub.cjs");
const useRealModel = (process.env.DEEPSEEK_API_KEY ?? "").trim() !== "";

type Resolver = (request: string, ...args: unknown[]) => string;
const resolveFilename = (Module as unknown as { _resolveFilename: Resolver })._resolveFilename;
(Module as unknown as { _resolveFilename: Resolver })._resolveFilename = function (
  request: string,
  ...args: unknown[]
) {
  if (request === "next/cache") return CACHE_STUB;
  if (!useRealModel && request === "@/lib/deepseek") return DEEPSEEK_STUB;
  return resolveFilename.call(this, request, ...args);
};

let failures = 0;

// A breakdown with its fit entries changed, re-judged by finish().
function finishWith<B extends { fit: unknown[]; verdict: { threshold: number } }>(b: B, change: (fit: B["fit"]) => B["fit"]): B {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { finish } = require("../src/lib/icpScoring");
  return finish({ ...b, fit: change(b.fit) }, b.verdict.threshold);
}
function check(label: string, passed: boolean, detail = ""): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

// ─── The clinics ───────────────────────────────────────────────────────────

interface Seed {
  kind: "candidate" | "lead";
  clinicName: string;
  status?: "PROMOTED" | "REJECTED";
  websiteUrl: string | null;
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
  staffCountRaw: number | null;
  location: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  // The old model's verdict, as the queue would have stored it.
  old?: {
    packageEconomics: number | null;
    gaps: { icpGapBooking?: boolean; icpGapReviews?: boolean; icpGapRemarketing?: boolean };
    disqualifier?: { key: string; reason: string };
    summary: string;
  };
  reply?: Record<string, unknown> | null;
  expect: string;
  expectDiscarded?: RegExp;
}

const page = (url: string, text: string) => `${url}\n${text}`;

const SEEDS: Seed[] = [
  {
    kind: "candidate",
    clinicName: "Lotus Flow Yoga Studio",
    status: "PROMOTED",
    websiteUrl: "https://lotusflowyoga.com",
    websiteNotes: page(
      "https://lotusflowyoga.com/",
      "Lotus Flow is a yoga and movement studio offering group classes, private sessions and our 200-hour Yoga Teacher Training. New students: 10-class pack for $150. Book a class online through our app. Located at 210 Pearl St, Boulder, CO 80302.",
    ),
    metaAdsSignal: "3 active ads, running 5mo",
    reviewCount: 61,
    staffCountRaw: 9,
    location: "Boulder, CO",
    old: {
      packageEconomics: 2,
      gaps: { icpGapReviews: true },
      summary: "A studio with class packs and active ads.",
    },
    reply: {
      disqualifiers: [
        {
          id: "dq4",
          quote: "Lotus Flow is a yoga and movement studio offering group classes, private sessions and our 200-hour Yoga Teacher Training",
          source: "https://lotusflowyoga.com/",
          reason: "The site describes a yoga studio and a teacher-training school, not a patient-facing clinic.",
        },
      ],
      coreService: null,
      adjacentService: null,
      spineProgram: null,
      primaryService: { service: "other", quote: "Lotus Flow is a yoga and movement studio", source: "https://lotusflowyoga.com/" },
      decisionMaker: null,
      location: { place: "Boulder, CO", quote: "210 Pearl St, Boulder, CO 80302", source: "https://lotusflowyoga.com/" },
      locationCount: { count: 1, quote: "Located at 210 Pearl St, Boulder, CO 80302", source: "https://lotusflowyoga.com/" },
      team: null,
      buyingTriggers: [],
      paymentModel: { model: "cash", quote: "10-class pack for $150", source: "https://lotusflowyoga.com/" },
      gapBooking: { checked: false, reason: "Classes are booked online through an app." },
      gapReviews: null,
      gapRemarketing: null,
      summary: "A yoga studio and teacher-training school, not a clinic.",
    },
    expect: "newly_rejected",
  },
  {
    kind: "candidate",
    clinicName: "Pathway Spine Academy",
    status: "PROMOTED",
    websiteUrl: "https://pathwayspineacademy.com",
    websiteNotes: page(
      "https://pathwayspineacademy.com/courses",
      "Pathway Spine Academy trains chiropractors and physical therapists in non-surgical spinal decompression. Our 12-hour certification course is approved for CE credit. Spinal Decompression Certification: $2,995. Seminars run monthly in Dallas, TX. We do not treat patients.",
    ),
    metaAdsSignal: "5 active ads, running 8mo",
    reviewCount: 14,
    staffCountRaw: 11,
    location: "Dallas, TX",
    old: {
      packageEconomics: 3,
      gaps: { icpGapBooking: true, icpGapReviews: true },
      summary: "Named certification program with visible pricing and active ads.",
    },
    reply: {
      disqualifiers: [
        {
          id: "dq4",
          quote: "Pathway Spine Academy trains chiropractors and physical therapists in non-surgical spinal decompression",
          source: "https://pathwayspineacademy.com/courses",
          reason: "The business sells training courses to practitioners and states it does not treat patients.",
        },
      ],
      coreService: { service: "spinal decompression", quote: "non-surgical spinal decompression", source: "https://pathwayspineacademy.com/courses" },
      adjacentService: null,
      spineProgram: null,
      primaryService: { service: "other", quote: "Our 12-hour certification course is approved for CE credit", source: "https://pathwayspineacademy.com/courses" },
      decisionMaker: null,
      location: { place: "Dallas, TX", quote: "Seminars run monthly in Dallas, TX", source: "https://pathwayspineacademy.com/courses" },
      locationCount: null,
      team: null,
      buyingTriggers: [],
      paymentModel: null,
      gapBooking: null,
      gapReviews: null,
      gapRemarketing: null,
      summary: "An education business for practitioners, not a clinic.",
    },
    expect: "newly_rejected",
  },
  {
    kind: "candidate",
    clinicName: "Riverbend Physical Therapy",
    status: "PROMOTED",
    websiteUrl: "https://riverbendpt.com",
    websiteNotes: page(
      "https://riverbendpt.com/insurance",
      "Riverbend Physical Therapy treats back pain, sports injuries and post-surgical rehab. We are in-network with all major insurance plans. We bill insurance only and do not offer self-pay or cash packages. Our team of six physical therapists works out of 88 Elm St, Columbus, OH 43215.",
    ),
    metaAdsSignal: "No active ads — 0 in the library",
    reviewCount: 40,
    staffCountRaw: 12,
    location: "Columbus, OH",
    old: {
      packageEconomics: 0,
      gaps: { icpGapBooking: true, icpGapRemarketing: true },
      summary: "Insurance-billed PT clinic with a solid team.",
    },
    reply: {
      disqualifiers: [
        {
          id: "dq6",
          quote: "We bill insurance only and do not offer self-pay or cash packages",
          source: "https://riverbendpt.com/insurance",
          reason: "The site states explicitly that it bills insurance only, with no self-pay or packages.",
        },
      ],
      coreService: null,
      adjacentService: { service: "physical therapy", quote: "Riverbend Physical Therapy treats back pain, sports injuries and post-surgical rehab", source: "https://riverbendpt.com/insurance" },
      spineProgram: null,
      primaryService: { service: "physical therapy", quote: "Riverbend Physical Therapy treats back pain", source: "https://riverbendpt.com/insurance" },
      decisionMaker: null,
      location: { place: "Columbus, OH", quote: "88 Elm St, Columbus, OH 43215", source: "https://riverbendpt.com/insurance" },
      locationCount: { count: 1, quote: "works out of 88 Elm St, Columbus, OH 43215", source: "https://riverbendpt.com/insurance" },
      team: { providers: 6, quote: "Our team of six physical therapists", source: "https://riverbendpt.com/insurance" },
      buyingTriggers: [],
      paymentModel: { model: "insurance", quote: "We bill insurance only and do not offer self-pay or cash packages", source: "https://riverbendpt.com/insurance" },
      gapBooking: { checked: true, reason: "Booking is by phone." },
      gapReviews: null,
      gapRemarketing: null,
      summary: "Insurance-only physical therapy.",
    },
    expect: "newly_rejected",
  },
  {
    kind: "candidate",
    clinicName: "Summit Spine & Wellness",
    status: "REJECTED",
    websiteUrl: "https://summitspineaustin.com",
    websiteNotes: [
      page(
        "https://summitspineaustin.com/",
        "Summit Spine & Wellness offers non-surgical spinal decompression and disc care in Austin. Dr. Maria Alvarez, DC, Clinic Director, founded Summit in 2014. Our team of three chiropractors and two physical therapists works from one office at 4410 Burnet Rd, Austin, TX 78756. Call (512) 555-0144 to schedule.",
      ),
      page(
        "https://summitspineaustin.com/insurance",
        "Insurance: We accept Blue Cross Blue Shield, Aetna, Cigna, United Healthcare and Medicare. Not using insurance? Ask about our Spinal Decompression Package, 20 sessions for $2,400, or our self-pay visit rate of $65.",
      ),
    ].join("\n\n"),
    metaAdsSignal: "2 active ads, running 3mo",
    reviewCount: 18,
    staffCountRaw: null,
    location: "Austin, TX",
    // The old model's characteristic miss: it read the insurer list as "pure
    // insurance-billed" and scored Package/Economics 0.
    old: {
      packageEconomics: 0,
      gaps: { icpGapBooking: true },
      summary: "Lists insurance plans; no headcount and few reviews.",
    },
    reply: {
      disqualifiers: [
        {
          id: "dq6",
          quote: "We accept Blue Cross Blue Shield, Aetna, Cigna, United Healthcare and Medicare",
          source: "https://summitspineaustin.com/insurance",
          reason: "The clinic bills the insurance plans it lists.",
        },
      ],
      coreService: { service: "spinal decompression", quote: "non-surgical spinal decompression and disc care in Austin", source: "https://summitspineaustin.com/" },
      adjacentService: { service: "chiropractic", quote: "Our team of three chiropractors and two physical therapists", source: "https://summitspineaustin.com/" },
      spineProgram: { quote: "Spinal Decompression Package, 20 sessions for $2,400", source: "https://summitspineaustin.com/insurance" },
      primaryService: { service: "spine and disc care", quote: "Summit Spine & Wellness offers non-surgical spinal decompression and disc care", source: "https://summitspineaustin.com/" },
      decisionMaker: { name: "Maria Alvarez", title: "Clinic Director", quote: "Dr. Maria Alvarez, DC, Clinic Director, founded Summit in 2014", source: "https://summitspineaustin.com/" },
      location: { place: "Austin, TX", quote: "4410 Burnet Rd, Austin, TX 78756", source: "https://summitspineaustin.com/" },
      locationCount: { count: 1, quote: "works from one office at 4410 Burnet Rd, Austin, TX 78756", source: "https://summitspineaustin.com/" },
      team: { providers: 5, quote: "Our team of three chiropractors and two physical therapists", source: "https://summitspineaustin.com/" },
      buyingTriggers: [],
      paymentModel: { model: "hybrid", quote: "Not using insurance? Ask about our Spinal Decompression Package, 20 sessions for $2,400, or our self-pay visit rate of $65", source: "https://summitspineaustin.com/insurance", reason: "Insurers are accepted and a cash package and self-pay rate are offered." },
      gapBooking: { checked: true, reason: "Booking is by phone only — no scheduling widget is described." },
      gapReviews: { checked: true, reason: "18 reviews is thin for a clinic founded in 2014 with five clinicians." },
      gapRemarketing: null,
      summary: "A hybrid decompression clinic with a named cash package; a strong fit.",
    },
    expect: "newly_promoted",
    expectDiscarded: /insurers|insurance-only/i,
  },
  {
    kind: "candidate",
    clinicName: "Apex Spine Partners",
    status: "PROMOTED",
    websiteUrl: "https://apexspinepartners.com",
    websiteNotes: page(
      "https://apexspinepartners.com/about",
      "With 12 locations across Texas and Oklahoma, Apex Spine Partners delivers non-surgical spine care. Apex Spine Partners is a portfolio company of Crestline Health Partners. Centralized scheduling for every clinic: book online 24/7.",
    ),
    metaAdsSignal: "14 active ads, running 11mo",
    reviewCount: 520,
    staffCountRaw: 140,
    location: "Plano, TX",
    old: {
      packageEconomics: 2,
      gaps: { icpGapRemarketing: true },
      summary: "Large group with heavy ad spend.",
    },
    reply: {
      disqualifiers: [
        {
          id: "dq7",
          quote: "Apex Spine Partners is a portfolio company of Crestline Health Partners",
          source: "https://apexspinepartners.com/about",
          reason: "The site names a private-equity owner, and it has 12 locations with centralized scheduling.",
        },
      ],
      coreService: { service: "non-surgical spine care", quote: "Apex Spine Partners delivers non-surgical spine care", source: "https://apexspinepartners.com/about" },
      adjacentService: null,
      spineProgram: null,
      primaryService: { service: "spine and disc care", quote: "delivers non-surgical spine care", source: "https://apexspinepartners.com/about" },
      decisionMaker: null,
      location: { place: "Texas and Oklahoma", quote: "12 locations across Texas and Oklahoma", source: "https://apexspinepartners.com/about" },
      locationCount: { count: 12, quote: "With 12 locations across Texas and Oklahoma", source: "https://apexspinepartners.com/about" },
      team: null,
      buyingTriggers: [],
      paymentModel: null,
      gapBooking: { checked: false, reason: "Online booking 24/7 is offered." },
      gapReviews: null,
      gapRemarketing: null,
      summary: "A PE-backed 12-location group with centralized marketing.",
    },
    expect: "newly_rejected",
  },
  {
    kind: "candidate",
    clinicName: "Peak Performance Sports Chiropractic",
    status: "PROMOTED",
    websiteUrl: "https://peakperformancechiro.com",
    websiteNotes: page(
      "https://peakperformancechiro.com/",
      "Sports chiropractic, Active Release Technique and performance care for athletes in Boulder. Dr. Jake Moreno, DC, founded Peak Performance after a decade with collegiate teams. Ask about our athlete care plans. 1550 Canyon Blvd, Boulder, CO 80302.",
    ),
    metaAdsSignal: "No active ads — 2 in the library, last ended 6mo ago",
    reviewCount: 30,
    staffCountRaw: 4,
    location: "Boulder, CO",
    old: {
      packageEconomics: 2,
      gaps: { icpGapBooking: true, icpGapReviews: true },
      summary: "A small sports chiro with care plans.",
    },
    reply: {
      disqualifiers: [
        {
          id: "dq9",
          quote: "Dr. Jake Moreno, DC, founded Peak Performance after a decade with collegiate teams",
          source: "https://peakperformancechiro.com/",
          reason: "Only one chiropractor is named on the site.",
        },
      ],
      coreService: null,
      adjacentService: { service: "chiropractic", quote: "Sports chiropractic, Active Release Technique and performance care for athletes in Boulder", source: "https://peakperformancechiro.com/" },
      spineProgram: null,
      primaryService: { service: "chiropractic", quote: "Sports chiropractic, Active Release Technique and performance care for athletes", source: "https://peakperformancechiro.com/" },
      decisionMaker: { name: "Jake Moreno", title: "DC", quote: "Dr. Jake Moreno, DC, founded Peak Performance", source: "https://peakperformancechiro.com/" },
      location: { place: "Boulder, CO", quote: "1550 Canyon Blvd, Boulder, CO 80302", source: "https://peakperformancechiro.com/" },
      locationCount: { count: 1, quote: "1550 Canyon Blvd, Boulder, CO 80302", source: "https://peakperformancechiro.com/" },
      team: null,
      buyingTriggers: [],
      paymentModel: null,
      gapBooking: { checked: true, reason: "No online booking is described." },
      gapReviews: null,
      gapRemarketing: null,
      summary: "A general sports chiropractic clinic with no spine or disc program.",
    },
    expect: "newly_rejected",
    expectDiscarded: /LinkedIn company page reports 4 staff/,
  },
  {
    kind: "candidate",
    clinicName: "Lakeside Spinal Decompression Center",
    status: "PROMOTED",
    websiteUrl: "https://lakesidedecompression.com",
    websiteNotes: page(
      "https://lakesidedecompression.com/",
      "Lakeside Spinal Decompression Center specializes in non-surgical spinal decompression for herniated discs, sciatica and chronic back pain. Owner and clinic director Dr. Priya Shah leads a team of two doctors and three patient coordinators at 900 Lake Ave, Madison, WI 53703. Our 6-week Disc Relief Program is $1,800, paid in full or in three installments. Call to request your consultation.",
    ),
    metaAdsSignal: "4 active ads, running 7mo",
    reviewCount: 22,
    staffCountRaw: 7,
    location: "Madison, WI",
    old: {
      packageEconomics: 3,
      gaps: { icpGapBooking: true, icpGapReviews: true, icpGapRemarketing: false },
      summary: "A cash-pay decompression clinic with a named program and ads.",
    },
    reply: {
      disqualifiers: [
        {
          id: "dq2",
          quote: "Lakeside is part of the Mercy Health System network",
          source: "https://lakesidedecompression.com/",
          reason: "The clinic is affiliated with a health system.",
        },
      ],
      coreService: { service: "spinal decompression", quote: "specializes in non-surgical spinal decompression for herniated discs, sciatica and chronic back pain", source: "https://lakesidedecompression.com/" },
      adjacentService: null,
      spineProgram: null,
      primaryService: { service: "spine and disc care", quote: "Lakeside Spinal Decompression Center specializes in non-surgical spinal decompression", source: "https://lakesidedecompression.com/" },
      decisionMaker: { name: "Priya Shah", title: "Owner and clinic director", quote: "Owner and clinic director Dr. Priya Shah leads a team", source: "https://lakesidedecompression.com/" },
      location: { place: "Madison, WI", quote: "900 Lake Ave, Madison, WI 53703", source: "https://lakesidedecompression.com/" },
      locationCount: { count: 1, quote: "at 900 Lake Ave, Madison, WI 53703", source: "https://lakesidedecompression.com/" },
      team: { providers: 2, quote: "leads a team of two doctors and three patient coordinators", source: "https://lakesidedecompression.com/" },
      buyingTriggers: [],
      paymentModel: { model: "cash", quote: "Our 6-week Disc Relief Program is $1,800, paid in full or in three installments", source: "https://lakesidedecompression.com/" },
      gapBooking: { checked: true, reason: "Consultations are requested by phone." },
      gapReviews: { checked: true, reason: "22 reviews is thin for a clinic with an active ad program." },
      gapRemarketing: { checked: true, reason: "No lead magnet, newsletter or follow-up offer appears on the site." },
      summary: "A cash-pay spinal decompression clinic — the core of the ICP.",
    },
    expect: "unchanged",
    expectDiscarded: /not in the stored evidence word for word/,
  },
  {
    kind: "candidate",
    clinicName: "Harbor Chiropractic & Disc Center",
    status: "REJECTED",
    websiteUrl: "https://harborchirodisc.com",
    websiteNotes: page(
      "https://harborchirodisc.com/",
      "Harbor Chiropractic & Disc Center has served Tampa families since 2009. Non-surgical disc treatment for herniated and bulging discs, alongside family chiropractic care. Dr. Ken Okafor, DC, and our associate doctors see patients at 77 Bayshore Blvd, Tampa, FL 33606. We accept most major insurance and offer affordable cash plans.",
    ),
    metaAdsSignal: null,
    reviewCount: 48,
    staffCountRaw: null,
    location: "Tampa, FL",
    old: {
      packageEconomics: 2,
      gaps: { icpGapBooking: true },
      summary: "Family chiro with a disc focus; no headcount gathered.",
    },
    reply: {
      disqualifiers: [
        {
          id: "dq8",
          quote: "Harbor Chiropractic & Disc Center has served Tampa families since 2009",
          source: "https://harborchirodisc.com/",
          reason: "The clinic may be part of a franchise network.",
        },
      ],
      coreService: { service: "disc treatment", quote: "Non-surgical disc treatment for herniated and bulging discs", source: "https://harborchirodisc.com/" },
      adjacentService: { service: "chiropractic", quote: "alongside family chiropractic care", source: "https://harborchirodisc.com/" },
      spineProgram: { quote: "Non-surgical disc treatment for herniated and bulging discs", source: "https://harborchirodisc.com/" },
      primaryService: { service: "chiropractic", quote: "Harbor Chiropractic & Disc Center has served Tampa families since 2009", source: "https://harborchirodisc.com/" },
      decisionMaker: { name: "Ken Okafor", title: "DC", quote: "Dr. Ken Okafor, DC, and our associate doctors", source: "https://harborchirodisc.com/" },
      location: { place: "Tampa, FL", quote: "77 Bayshore Blvd, Tampa, FL 33606", source: "https://harborchirodisc.com/" },
      locationCount: { count: 1, quote: "see patients at 77 Bayshore Blvd, Tampa, FL 33606", source: "https://harborchirodisc.com/" },
      team: { providers: 2, quote: "Dr. Ken Okafor, DC, and our associate doctors", source: "https://harborchirodisc.com/" },
      buyingTriggers: [],
      paymentModel: { model: "hybrid", quote: "We accept most major insurance and offer affordable cash plans", source: "https://harborchirodisc.com/" },
      gapBooking: { checked: true, reason: "No online scheduling is described." },
      gapReviews: null,
      gapRemarketing: null,
      summary: "A chiropractic-first clinic with a real disc program.",
    },
    // Chiro-first and over the bar, but no dedicated page, no equipment, no
    // consult offer, one named doctor and no ads: 0 of 5 signals.
    expect: "unchanged",
    expectDiscarded: /absence or a hedge/,
  },
  // A chiropractic-first clinic with a real program behind it: a page of its
  // own, named equipment, a consult offer — three of five signals.
  {
    kind: "candidate",
    clinicName: "Ridgeline Chiropractic",
    status: "REJECTED",
    websiteUrl: "https://ridgelinechiro.com",
    websiteNotes: [
      page(
        "https://ridgelinechiro.com/",
        "Ridgeline Chiropractic is a family chiropractic office in Fort Collins. Dr. Sara Lund, DC, owner, sees patients at 310 College Ave, Fort Collins, CO 80524. Call today to schedule your free consultation.",
      ),
      page(
        "https://ridgelinechiro.com/spinal-decompression",
        "Non-surgical spinal decompression for herniated and bulging discs. We use the DRX9000 decompression table. See if you qualify for our 20-visit decompression program.",
      ),
    ].join("\n\n"),
    metaAdsSignal: null,
    reviewCount: 64,
    staffCountRaw: null,
    location: "Fort Collins, CO",
    old: {
      packageEconomics: 1,
      gaps: { icpGapBooking: true },
      summary: "Family chiro.",
    },
    reply: {
      disqualifiers: [],
      coreService: { service: "spinal decompression", quote: "Non-surgical spinal decompression for herniated and bulging discs", source: "https://ridgelinechiro.com/spinal-decompression" },
      adjacentService: { service: "chiropractic", quote: "a family chiropractic office in Fort Collins", source: "https://ridgelinechiro.com/" },
      spineProgram: null,
      primaryService: { service: "chiropractic", quote: "Ridgeline Chiropractic is a family chiropractic office in Fort Collins", source: "https://ridgelinechiro.com/" },
      decisionMaker: { name: "Sara Lund", title: "owner", quote: "Dr. Sara Lund, DC, owner, sees patients", source: "https://ridgelinechiro.com/" },
      location: { place: "Fort Collins, CO", quote: "310 College Ave, Fort Collins, CO 80524", source: "https://ridgelinechiro.com/" },
      locationCount: null,
      team: null,
      buyingTriggers: [],
      paymentModel: null,
      gapBooking: { checked: true, reason: "Booking is by phone." },
      gapReviews: null,
      gapRemarketing: null,
      summary: "A chiropractic office with a dedicated decompression page, the DRX9000 and a free consultation offer.",
    },
    expect: "newly_promoted",
  },
  // Modelled on two real Compare results, to pin the tuning they prompted.
  // The site copy is written to match the cases as described, not scraped;
  // the scripted replies reproduce the misses the real run made.
  {
    kind: "candidate",
    clinicName: "Hands On Wellness Center",
    status: "PROMOTED",
    websiteUrl: "https://handsonwellnesscenter.com",
    websiteNotes: page(
      "https://handsonwellnesscenter.com/services",
      "Our Services\nChiropractic Care\nMassage Therapy\nDecompression\nAcupuncture\nIV Nutrition\nMedical Weight Loss\nDr. Amy Harris, DC, and our front desk team welcome you at 1220 Main St, Lancaster, PA 17601.",
    ),
    metaAdsSignal: "1 active ad, running 2mo",
    reviewCount: 31,
    staffCountRaw: null,
    location: "Lancaster, PA",
    old: {
      packageEconomics: 2,
      gaps: { icpGapBooking: true, icpGapReviews: true },
      summary: "A wellness center offering chiropractic and decompression.",
    },
    reply: {
      disqualifiers: [],
      coreService: null,
      adjacentService: { service: "chiropractic", quote: "Chiropractic Care", source: "https://handsonwellnesscenter.com/services" },
      spineProgram: null,
      primaryService: { service: "other", quote: "Massage Therapy", source: "https://handsonwellnesscenter.com/services" },
      decisionMaker: null,
      location: { place: "Lancaster, PA", quote: "1220 Main St, Lancaster, PA 17601", source: "https://handsonwellnesscenter.com/services" },
      locationCount: null,
      team: null,
      buyingTriggers: [],
      paymentModel: null,
      gapBooking: { checked: true, reason: "No online scheduling is described." },
      gapReviews: null,
      gapRemarketing: null,
      summary: "A single location wellness center that offers chiropractic care and decompression alongside massage, acupuncture and IV nutrition.",
    },
    expect: "unchanged",
  },
  {
    kind: "candidate",
    clinicName: "360 Rehab & Chiropractic",
    status: "PROMOTED",
    websiteUrl: "https://360rehabchiro.com",
    websiteNotes: page(
      "https://360rehabchiro.com/",
      "360 Rehab & Chiropractic provides chiropractic adjustments, rehab exercise and massage. If you suffer from back pain or a spinal condition, we can help you feel better. Dr. Mark Welty, DC sees patients at 455 Oak Ave, Springfield, MO 65804.",
    ),
    metaAdsSignal: null,
    reviewCount: 52,
    staffCountRaw: null,
    location: "Springfield, MO",
    old: {
      packageEconomics: 2,
      gaps: { icpGapBooking: true },
      summary: "Chiro and rehab clinic.",
    },
    reply: {
      disqualifiers: [],
      coreService: null,
      adjacentService: { service: "chiropractic", quote: "provides chiropractic adjustments, rehab exercise and massage", source: "https://360rehabchiro.com/" },
      spineProgram: { quote: "If you suffer from back pain or a spinal condition, we can help you feel better", source: "https://360rehabchiro.com/" },
      primaryService: { service: "chiropractic", quote: "360 Rehab & Chiropractic provides chiropractic adjustments", source: "https://360rehabchiro.com/" },
      decisionMaker: null,
      location: { place: "Springfield, MO", quote: "455 Oak Ave, Springfield, MO 65804", source: "https://360rehabchiro.com/" },
      locationCount: { count: 1, quote: "455 Oak Ave, Springfield, MO 65804", source: "https://360rehabchiro.com/" },
      team: null,
      buyingTriggers: [],
      paymentModel: null,
      gapBooking: { checked: true, reason: "No online scheduling is described." },
      gapReviews: null,
      gapRemarketing: null,
      summary: "A single location chiropractic and rehab clinic run by Dr. Mark Welty, with general back-pain copy but no named spine program.",
    },
    expect: "newly_rejected",
  },
  {
    kind: "lead",
    clinicName: "Main Street Back Clinic",
    websiteUrl: null,
    websiteNotes: null,
    metaAdsSignal: null,
    reviewCount: 12,
    staffCountRaw: null,
    location: "Dayton, OH",
    reply: null,
    expect: "newly_rejected",
  },
  {
    kind: "lead",
    clinicName: "Oakridge Pain Relief",
    websiteUrl: null,
    websiteNotes: null,
    metaAdsSignal: null,
    reviewCount: null,
    staffCountRaw: null,
    location: null,
    reply: null,
    expect: "newly_failed",
  },
];

const OLD_DQ_KEYS = [
  "icpDqSurgicalPractice",
  "icpDqSoloNoStaff",
  "icpDqFranchiseLocked",
  "icpDqSystemComplete",
  "icpDqOutOfRegion",
] as const;

async function main(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const discovery = await import("@/lib/discovery");
  const { serializeBreakdown, buildBreakdown, staffSizeScore, budgetSignalScore, rejectionReason } = discovery;
  const { startScoringComparison, compareOneSubject, finishScoringComparison } = await import(
    "@/lib/actions/scoringComparison"
  );
  const { setScoringModel } = await import("@/lib/actions/pipelineSettings");
  const { loadPipelineSettings } = await import("@/lib/pipelineSettingsStore");
  const { loadActiveIcp } = await import("@/lib/icpDefinitionStore");
  const { parseBreakdownV2 } = await import("@/lib/icpScoring");
  const { promoteToLead } = await import("@/lib/promoteLead");
  const { leadTier } = await import("@/lib/leadScore");
  const { saveIcpScorecardV2 } = await import("@/lib/actions/icpScorecardV2");
  const { computedFlag } = await import("@/lib/secondLook");
  const { buildStepPrompt, buildFirstMessageFallbackPrompt } = await import("@/lib/outreachSequence");

  const stub = useRealModel
    ? null
    : (require(DEEPSEEK_STUB) as {
        setReplies: (m: Record<string, unknown>) => void;
        prompts: () => { system: string; user: string }[];
      });

  // ─── Reset and seed ────────────────────────────────────────────────────
  await prisma.scoringComparisonRun.deleteMany({});
  await prisma.copilotAction.deleteMany({});
  await prisma.discoveryCandidate.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.pipelineSettings.deleteMany({});

  const icp = await loadActiveIcp();
  console.log("\nThe seeded ICP");
  check("Primary ICP is seeded and active", icp?.name === "Primary ICP", icp?.name ?? "none");
  check(
    "its tags are normalised",
    JSON.stringify(icp?.targetTitles) ===
      JSON.stringify(["owner", "clinic director", "practice manager", "medical director", "dc"]),
    JSON.stringify(icp?.targetTitles),
  );
  check("11 disqualifiers, one per line", icp?.disqualifiers.split("\n").length === 11);
  check("pain points and buying triggers are blank", icp?.painPoints === "" && icp?.buyingTriggers === "");

  const now = new Date("2026-09-01T12:00:00Z");
  for (const seed of SEEDS) {
    const evidence = {
      clinicName: seed.clinicName,
      websiteUrl: seed.websiteUrl,
      websiteNotes: seed.websiteNotes,
      metaAdsSignal: seed.metaAdsSignal,
      reviewCount: seed.reviewCount,
      staffCountRaw: seed.staffCountRaw,
      location: seed.location,
      contactName: seed.contactName ?? null,
      contactTitle: seed.contactTitle ?? null,
      enrichedAt: now,
    };
    if (seed.kind === "lead") {
      await prisma.lead.create({ data: { ...evidence, stage: "NEW" } });
      continue;
    }
    const old = seed.old!;
    const breakdown = buildBreakdown(
      {
        staffSize: staffSizeScore(seed.staffCountRaw),
        budgetSignal: budgetSignalScore(seed.metaAdsSignal, seed.reviewCount),
        packageEconomics:
          old.packageEconomics === null
            ? null
            : { points: old.packageEconomics, reason: "Read off the website notes." },
        gaps: Object.fromEntries(
          Object.entries(old.gaps).map(([k, v]) => [k, { checked: v === true, reason: "Read off the website notes." }]),
        ),
        disqualifiers: old.disqualifier
          ? { [old.disqualifier.key]: { triggered: true, reason: old.disqualifier.reason } }
          : {},
        summary: old.summary,
        evidence: ["Website notes"],
        notes: [],
      },
      now,
    );
    const created = await prisma.discoveryCandidate.create({
      data: {
        ...evidence,
        status: "SCORED",
        icpTotal: breakdown.total,
        icpTier: breakdown.tier,
        icpBreakdown: serializeBreakdown(breakdown),
        scoringModel: "v1",
        disqualified: breakdown.tier === "DISQUALIFIED",
      },
    });
    if (seed.status === "PROMOTED") {
      await promoteToLead(created.id, breakdown, now);
    } else {
      await prisma.discoveryCandidate.update({
        where: { id: created.id },
        data: { status: "REJECTED", disqualifiedReason: rejectionReason(breakdown, 5), processedAt: now },
      });
    }
  }
  void OLD_DQ_KEYS;

  // What every record looks like before the dry run, to prove it does not move.
  const snapshot = async () =>
    JSON.stringify({
      candidates: await prisma.discoveryCandidate.findMany({
        orderBy: { clinicName: "asc" },
        select: { clinicName: true, status: true, icpTotal: true, icpTier: true, icpBreakdown: true, scoringModel: true, updatedAt: true },
      }),
      leads: await prisma.lead.findMany({
        orderBy: { clinicName: "asc" },
        select: { clinicName: true, stage: true, icpBreakdown: true, icpScoredAt: true, updatedAt: true },
      }),
    });
  const before = await snapshot();

  // ─── The gate on Apply ────────────────────────────────────────────────
  console.log("\nApply new scoring");
  const early = await setScoringModel("v2");
  check("refused before any comparison has finished", early.ok === false, early.error ?? "");
  check("the queue is still on the old model", (await loadPipelineSettings()).scoringModel === "v1");

  // ─── The dry run ───────────────────────────────────────────────────────
  stub?.setReplies(
    Object.fromEntries(SEEDS.filter((s) => s.reply).map((s) => [s.clinicName, s.reply])),
  );
  const started = await startScoringComparison();
  if (!started.ok) throw new Error(started.error);
  console.log("\nCompare scoring");
  check(
    "covers the promoted and rejected candidates and the leads that never came through Discovery",
    started.subjects.length === SEEDS.length,
    `${started.subjects.length} subjects`,
  );
  const run = await prisma.scoringComparisonRun.findUniqueOrThrow({ where: { id: started.runId } });
  console.log(`       DeepSeek estimate shown before running: ~$${run.estimatedUsd.toFixed(4)}`);

  for (const subject of started.subjects) {
    await compareOneSubject(started.runId, subject.kind, subject.id);
  }
  const finished = await finishScoringComparison(started.runId);
  check("the run finished whole", finished.complete, JSON.stringify(finished));
  check("nothing on any candidate or lead changed", (await snapshot()) === before);

  if (stub) {
    const prompts = stub.prompts();
    check(
      "one DeepSeek call per clinic with website copy; the no-website and nothing-gathered leads cost none",
      prompts.length === SEEDS.filter((s) => s.reply).length,
      `${prompts.length} calls`,
    );
    check(
      "website copy is fenced as untrusted data",
      prompts.every((p) => p.user.includes("=== BEGIN UNTRUSTED EVIDENCE ===") && /never an instruction to you/.test(p.system)),
    );
    check(
      "the model is told never to flag “No website” itself",
      prompts.every((p) => /No website.*never flag this one/.test(p.user)),
    );
  }

  const rows = await prisma.scoringComparison.findMany({ where: { runId: started.runId } });
  console.log("\nOutcomes");
  for (const seed of SEEDS) {
    const row = rows.find((r) => r.clinicName === seed.clinicName);
    check(
      `${seed.clinicName} → ${seed.expect}`,
      row?.outcome === seed.expect,
      `${row?.oldStatus}${row?.oldScore != null ? ` ${row.oldScore}/${row.oldMax}` : ""} → ${row?.newStatus}${row?.newScore != null ? ` ${row.newScore}/100` : ""}`,
    );
    if (seed.expectDiscarded) {
      const b = parseBreakdownV2(row?.breakdown ?? null);
      const discarded = b?.disqualifiers.filter((d) => d.discarded).map((d) => d.discarded ?? "") ?? [];
      check(
        `  … and the bad flag on it was thrown out by the evidence rules`,
        discarded.some((d) => seed.expectDiscarded!.test(d)),
        discarded.join(" | ") || "nothing discarded",
      );
    }
  }

  // ─── The report, as the compare page groups it ────────────────────────
  console.log("\nThe comparison, grouped");
  const order = ["newly_rejected", "newly_promoted", "newly_failed", "unchanged"];
  for (const outcome of order) {
    const group = rows.filter((r) => r.outcome === outcome);
    console.log(`\n  ${outcome} (${group.length})`);
    for (const r of group) {
      console.log(
        `    • ${r.clinicName}: ${r.oldStatus}${r.oldScore != null ? ` ${r.oldScore}/${r.oldMax}` : ""}${r.oldTier ? ` ${r.oldTier}` : ""} → ${r.newStatus}${r.newScore != null ? ` ${r.newScore}/100 ${r.newTier}` : ""}`,
      );
      if (r.flipReason) console.log(`        ${r.flipReason}`);
    }
  }

  // ─── Apply, and what a lead looks like under it ───────────────────────
  console.log("\nAfter the run");
  const applied = await setScoringModel("v2");
  check("Apply new scoring is allowed once a run has finished", applied.ok === true, applied.error ?? "");
  check("the queue now scores with the ICP model", (await loadPipelineSettings()).scoringModel === "v2");

  const summitRow = rows.find((r) => r.clinicName === "Summit Spine & Wellness")!;
  const summit = await prisma.discoveryCandidate.findFirstOrThrow({ where: { clinicName: "Summit Spine & Wellness" } });
  const summitBreakdown = parseBreakdownV2(summitRow.breakdown)!;
  const leadId = await promoteToLead(summit.id, summitBreakdown, new Date());
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  check("a promotion under the ICP model carries its breakdown onto the lead", lead.icpBreakdown !== null);
  check("…and leaves the old answer columns untouched", lead.icpScoredAt === null);
  check("the lead is tiered off the new card", leadTier(lead) === summitBreakdown.tier, `${leadTier(lead)}`);

  // An override on the lead's card: tick a disqualifier by hand.
  const form = new FormData();
  form.set("base", summitRow.breakdown!);
  for (const e of [...summitBreakdown.fit, ...summitBreakdown.signals]) form.set(`points_${e.key}`, String(e.points));
  form.set("dq_dq1", "on");
  form.set("overrideNote", "The site links to a surgical partner page.");
  await saveIcpScorecardV2(leadId, form);
  const overridden = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const ob = parseBreakdownV2(overridden.icpBreakdown)!;
  check(
    "an override saved on the card re-judges it by the same rules",
    ob.tier === "DISQUALIFIED" && ob.total === 0 && ob.disqualifiers[0].scoredTriggered === false,
    `${ob.total}/100 ${ob.tier}`,
  );
  // …and clearing it again puts the card back exactly as the run left it.
  const back = new FormData();
  back.set("base", overridden.icpBreakdown!);
  for (const e of [...ob.fit, ...ob.signals]) back.set(`points_${e.key}`, String(e.points));
  await saveIcpScorecardV2(leadId, back);
  const reverted = parseBreakdownV2((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).icpBreakdown)!;
  check(
    "clearing the override restores the run's verdict, source and reason",
    reverted.total === summitBreakdown.total &&
      reverted.disqualifiers[0].scoredTriggered === undefined &&
      reverted.disqualifiers[0].reason === summitBreakdown.disqualifiers[0].reason,
    `${reverted.total}/100 ${reverted.tier}`,
  );
  check("the old model's answers are still there to read", overridden.icpScoredAt === null && lead.icpNotes === overridden.icpNotes);

  // Second look on the new scale.
  const peakRow = rows.find((r) => r.clinicName === "Peak Performance Sports Chiropractic")!;
  const peak = parseBreakdownV2(peakRow.breakdown)!;
  const flag = computedFlag(
    {
      id: "x",
      clinicName: peakRow.clinicName,
      disqualified: false,
      icpTotal: peak.total,
      disqualifiedReason: peak.verdict.reason,
      scoringModel: "v2",
      breakdown: null,
      breakdownV2: peak,
    },
    { v1: 5, v2: 60 },
  );
  check("the second-look sweep reads a v2 rejection on its own scale", flag === null, `fit ${peak.fitTotal}/60 is not a near miss of the floor`);

  // ─── The retired hold: nothing left stranded ──────────────────────────
  console.log("\nRetired Tier 2 chiro hold");
  const { resolveHeldCandidates, RETIRED_HELD_STATUS } = await import("@/lib/heldCleanup");
  const ridgeRow = rows.find((r) => r.clinicName === "Ridgeline Chiropractic")!;
  const harborRow = rows.find((r) => r.clinicName === "Harbor Chiropractic & Disc Center")!;
  // Two candidates left in HELD_CHIRO by the old rule, each carrying a
  // breakdown the hold wrote — the shape a real stranded row has.
  const asHeld = (raw: string) => {
    const b = JSON.parse(raw);
    b.verdict = { ...b.verdict, status: "HELD_CHIRO", kind: "held_chiro", reason: "Held — Tier 2 chiro" };
    delete b.chiroProgram;
    return JSON.stringify(b);
  };
  for (const row of [ridgeRow, harborRow]) {
    await prisma.discoveryCandidate.update({
      where: { id: row.subjectId },
      data: { status: RETIRED_HELD_STATUS, icpBreakdown: asHeld(row.breakdown!), scoringModel: "v2" },
    });
  }
  const cleaned = await resolveHeldCandidates();
  check(
    "held candidates are re-judged under the real-program check, none left held",
    (await prisma.discoveryCandidate.count({ where: { status: RETIRED_HELD_STATUS } })) === 0,
    JSON.stringify(cleaned),
  );
  const ridge = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: ridgeRow.subjectId } });
  const harbor = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: harborRow.subjectId } });
  check("…a chiro with a real program is promoted", ridge.status === "PROMOTED" && ridge.promotedLeadId !== null);
  check(
    "…and one without is rejected, with the signals counted (its name, '& Disc Center', is signal 1 — still short of 2)",
    harbor.status === "REJECTED" && /Chiro without a real program \(1 of 5 signals\)/.test(harbor.disqualifiedReason ?? ""),
    harbor.disqualifiedReason ?? "",
  );

  // The tuning rules, directly.
  const { isSpecificSpineProgram, summaryConsistency, emptyBreakdownV2 } = await import("@/lib/icpScoring");
  check(
    "generic back-pain copy is not a spine program",
    !isSpecificSpineProgram({ quote: "If you suffer from back pain or a spinal condition, we can help", source: "https://x.com/" }),
  );
  check(
    "a named program, a modality or a dedicated page is",
    isSpecificSpineProgram({ quote: "Our 6-week Disc Relief Program", source: "https://x.com/" }) &&
      isSpecificSpineProgram({ quote: "Flexion-distraction for sciatica", source: "https://x.com/" }) &&
      isSpecificSpineProgram({ quote: "We can help you feel better", source: "https://x.com/conditions/sciatica" }),
  );
  const blankFit = emptyBreakdownV2(icp!, 60, new Date()).fit;
  const consistencyNotes: string[] = [];
  const checked = summaryConsistency(
    "A single location clinic that offers decompression, run by Dr. Lee.",
    blankFit,
    icp!,
    consistencyNotes,
  );
  check(
    "a fact the summary states cannot sit at “no evidence”",
    ["service", "size", "title"].every((k) => checked.find((e) => e.key === k)?.source === "assist") &&
      consistencyNotes.length === 3,
    consistencyNotes.join(" | "),
  );
  for (const name of ["Hands On Wellness Center", "360 Rehab & Chiropractic"]) {
    const b = parseBreakdownV2(rows.find((r) => r.clinicName === name)?.breakdown ?? null)!;
    console.log(`       ${name}: fit ${b.fitTotal}/60 — ${b.fit.map((e) => `${e.label} ${e.points} (${e.source})`).join(", ")}`);
  }

  // Links: read off the crawler's markdown, chosen to follow, and counted for
  // the chiro "dedicated page" signal when that page itself was not crawled.
  {
    const { linksFromMarkdown, choosePagesToFollow, isProgramLink, serializeLinks } = await import("../src/lib/websiteCrawl");
    const { chiroProgramCheck, evidenceDocs } = await import("../src/lib/icpScoring");
    const home = "https://ridgechiro.com/";
    const md = [
      "[Home](/) [About Us](/about) [Spinal Decompression](/spinal-decompression) [Blog](/blog)",
      "[Discount plans](/discount) [Discover more](/discover) ![logo](/logo.png)",
      "[Sciatica Relief](https://ridgechiro.com/sciatica/) [Facebook](https://facebook.com/ridge) [Brochure](/b.pdf)",
      "© 2026 Ridge Chiropractic · [Privacy](/privacy)",
    ].join("\n");
    const links = linksFromMarkdown(md, home);
    check("links come out of markdown with absolute URLs", links.some((l) => l.text === "Spinal Decompression" && l.url === "https://ridgechiro.com/spinal-decompression"));
    check("an image is not a link", !links.some((l) => l.url.endsWith("/logo.png")));
    const follow = choosePagesToFollow(links, home, 3);
    check(
      "priority links are followed first, off-site and files skipped",
      follow[0] === "https://ridgechiro.com/spinal-decompression" && follow[1] === "https://ridgechiro.com/sciatica/" && !follow.some((u) => u.includes("facebook") || u.endsWith(".pdf")),
      follow.join(", "),
    );
    check("'discount' and 'discover' are not 'disc'", !isProgramLink({ text: "Discount plans", url: "https://x.com/discount" }) && !isProgramLink({ text: "Discover more", url: "https://x.com/discover" }));
    check("'avoid surgery' and a /disc-herniation URL are program links", isProgramLink({ text: "Avoid Surgery", url: "https://x.com/a" }) && isProgramLink({ text: "Learn", url: "https://x.com/disc-herniation" }));

    const evidence = {
      clinicName: "Ridge Chiropractic",
      websiteNotes: "[https://ridgechiro.com/]\nWelcome to Ridge Chiropractic, family care in Boise.",
      websiteLinks: serializeLinks(links),
      metaAdsSignal: null,
      reviewCount: null,
    };
    const docs = evidenceDocs(evidence as Parameters<typeof evidenceDocs>[0]);
    const viaLink = chiroProgramCheck(evidence as Parameters<typeof chiroProgramCheck>[0], null, docs).signals.find((x) => x.key === "page");
    check(
      "a program page linked in the nav but never crawled counts for signal 1",
      viaLink?.found === true && viaLink.citations[0]?.source === "https://ridgechiro.com/spinal-decompression",
      viaLink?.reason ?? "",
    );
    const { programLinks, providerNameFromLink } = await import("../src/lib/websiteCrawl");
    const { withoutSharedChrome } = await import("../src/lib/leadEnrich");
    const junk = programLinks([
      { text: "Skip to main content", url: "https://x.com/spinal-decompression#main", page: "https://x.com/" },
      { text: "Learn more", url: "https://x.com/disc-herniation/", page: "https://x.com/" },
      { text: "–", url: "https://x.com/sciatica/", page: "https://x.com/" },
      { text: "Spinal Decompression", url: "https://x.com/spinal-decompression/", page: "https://x.com/spinal-decompression/" },
      { text: "Spinal Decompression", url: "https://x.com/spinal-decompression/", page: "https://x.com/" },
    ]);
    check("generic-text and self links are ignored for signal 1", junk.length === 1 && junk[0].page === "https://x.com/", JSON.stringify(junk));
    check(
      "a provider's name is read from a doctor-page URL",
      providerNameFromLink({ url: "https://x.com/doctors/dr-trista-shelton/" }) === "Dr. Trista Shelton" &&
        providerNameFromLink({ url: "https://x.com/our-team/jane-doe-dc" }) === "Jane Doe" &&
        providerNameFromLink({ url: "https://x.com/doctors/" }) === null,
    );
    const teamEvidence = {
      ...evidence,
      websiteNotes: "[https://ridgechiro.com/]\nMeet Dr. Shelton, our lead chiropractor.",
      websiteLinks: JSON.stringify([
        { text: "Dr. Trista Shelton", url: "https://ridgechiro.com/doctors/dr-trista-shelton/", page: home },
        { text: "Learn more", url: "https://ridgechiro.com/doctors/dr-ken-ortiz/", page: home },
      ]),
    };
    const team = chiroProgramCheck(teamEvidence as Parameters<typeof chiroProgramCheck>[0], null, evidenceDocs(teamEvidence as Parameters<typeof evidenceDocs>[0])).signals.find((x) => x.key === "team");
    check(
      "doctor-page links count as team evidence, one person counted once",
      team?.found === true && team.citations.some((c) => c.source.endsWith("/dr-ken-ortiz/") && c.quote === "Dr. Ken Ortiz"),
      JSON.stringify(team?.citations),
    );
    const oneDoc = chiroProgramCheck({ ...teamEvidence, websiteLinks: JSON.stringify([{ text: "Dr. Trista Shelton", url: "https://ridgechiro.com/doctors/dr-trista-shelton/", page: home }]) } as Parameters<typeof chiroProgramCheck>[0], null, evidenceDocs(teamEvidence as Parameters<typeof evidenceDocs>[0])).signals.find((x) => x.key === "team");
    check("…and 'Dr. Shelton' in copy plus her own page link is still one provider", oneDoc?.found === false);
    const { websitePages } = await import("../src/lib/icpScoring");
    const split = websitePages(
      "https://www.handson.test/\nMeet our doctors\nhttps://www.youtube.com/watch?v=hu3AB9ZKoFI\nDr. Trista Shelton and Dr. Ken Ortiz\n\nhttps://handson.test/about/\nAbout us",
      "Clinic website",
    );
    check(
      "a bare YouTube line inside a page is not a new page source",
      split.length === 2 && split[0].source === "https://www.handson.test/" && split[0].text.includes("Dr. Trista Shelton") && split[1].source === "https://handson.test/about/",
      JSON.stringify(split.map((p) => p.source)),
    );
    const offerEvidence = {
      clinicName: "Hands On",
      websiteNotes: "https://handson.test/\nClaim our $75 New Patient Special today.\nWe treat pain with a deep tissue laser and spinal care.",
      websiteLinks: null,
      metaAdsSignal: null,
      reviewCount: null,
    };
    const offer = chiroProgramCheck(offerEvidence as Parameters<typeof chiroProgramCheck>[0], null, evidenceDocs(offerEvidence as Parameters<typeof evidenceDocs>[0])).signals;
    check("'$75 New Patient Special' counts as a consult offer", offer.find((x) => x.key === "consult")?.found === true);
    check("'deep tissue laser' counts as named equipment", offer.find((x) => x.key === "equipment")?.found === true);
    const stripped = withoutSharedChrome([
      { url: "https://x.com/", text: "Home\nServices\nWelcome to the clinic." },
      { url: "https://x.com/a", text: "Home\nServices\nAbout page copy." },
    ]);
    check("menu lines repeated across pages are kept once", stripped[0].text.includes("Services") && stripped[1].text === "About page copy.");
    const noLinks = chiroProgramCheck({ ...evidence, websiteLinks: null } as Parameters<typeof chiroProgramCheck>[0], null, docs).signals.find((x) => x.key === "page");
    check("…and without stored links it does not", noLinks?.found === false);
  }

  // Buying triggers: strength tags, dates on time-based triggers, no ads.
  {
    const { parseBuyingTrigger, showsRecency } = await import("../src/lib/icpDefinition");
    const { triggersEntry, evidenceDocs, triggerId } = await import("../src/lib/icpScoring");
    const { choosePagesToFollow } = await import("../src/lib/websiteCrawl");
    const strong = parseBuyingTrigger("Hiring a new associate doctor [strong]");
    check("[strong] is 10, tag removed from the label", strong.points === 10 && strong.label === "Hiring a new associate doctor" && strong.timeBased);
    check("[medium] and untagged are 5", parseBuyingTrigger("[medium] Opened a new location").points === 5 && parseBuyingTrigger("Cash-pay pricing posted").points === 5);
    check("an ads trigger is recognised as one", parseBuyingTrigger("Running Facebook ads [strong]").aboutAds);
    check("dates and newness read as recency", showsRecency("Seminar on March 12, 2026") && showsRecency("Now hiring a front desk") && showsRecency("Coming soon: DRX9000") && showsRecency("Workshop 11/04/26"));
    check("…a bare mention does not", !showsRecency("We hold seminars for the community") && !showsRecency("Join our team of caring staff"));

    const icp = {
      buyingTriggers: [
        "Hiring front desk or associate [strong]",
        "Hosts back pain seminars [medium]",
        "New decompression device [strong]",
        "Running Meta ads [strong]",
        "Posts cash-pay pricing",
      ].join("\n"),
    };
    const ev = {
      clinicName: "Trigger Test",
      websiteNotes: [
        "https://tt.test/",
        "Now hiring: front desk coordinator and associate chiropractor.",
        "We host back pain seminars for the community.",
        "Our decompression table helps patients.",
        "Initial visit $75, packages from $900.",
      ].join("\n"),
      metaAdsSignal: "Active ads: 3 running since 2026-09-01",
      reviewCount: null,
    };
    const docs = evidenceDocs(ev as Parameters<typeof evidenceDocs>[0]);
    const claim = (i: number, quote: string, source = "https://tt.test/") => ({ id: triggerId(i), quote, source, reason: "x" });
    const reply = {
      buyingTriggers: [
        claim(0, "Now hiring: front desk coordinator and associate chiropractor."),
        claim(1, "We host back pain seminars for the community."),
        claim(2, "Our decompression table helps patients."),
        claim(3, "Active ads: 3 running since 2026-09-01", "Meta ads signal"),
        claim(4, "Initial visit $75, packages from $900."),
      ],
    };
    const t = triggersEntry(icp as never, reply as never, docs);
    const labels = (t.parts ?? []).map((p) => `${p.label}=${p.points}`);
    check(
      "hiring with 'now' scores 10, undated seminar and device 0, ads 0, untagged 5 → 15",
      t.points === 15 && labels.length === 2 && labels.includes("Hiring front desk or associate=10") && labels.includes("Posts cash-pay pricing=5"),
      `${t.points}: ${labels.join(", ")}`,
    );
    const capped = triggersEntry(
      { buyingTriggers: "A [strong]\nB [strong]\nC [strong]" } as never,
      { buyingTriggers: [claim(0, "Now hiring: front desk coordinator and associate chiropractor."), claim(1, "We host back pain seminars for the community."), claim(2, "Initial visit $75, packages from $900.")] } as never,
      docs,
    );
    check("triggers still cap at 20", capped.points === 20, `${capped.points}`);

    const home = "https://tt.test/";
    const L = (text: string, path: string) => ({ text, url: `https://tt.test${path}`, page: home });
    const menu = [
      L("About Us", "/about/"),
      L("Services", "/services/"),
      L("Spinal Decompression", "/spinal-decompression/"),
      L("Sciatica", "/sciatica/"),
      L("Disc Herniation", "/disc-herniation/"),
      L("Back Pain", "/back-pain/"),
      L("Spine Care", "/spine/"),
      L("Careers", "/careers/"),
      L("Contact", "/contact/"),
    ];
    const five = choosePagesToFollow(menu, home, 5);
    check(
      "one of the five follow slots goes to a careers/about page; program pages take the rest",
      five.length === 5 && five[4] === "https://tt.test/about/" && five.slice(0, 4).every((u) => /decompression|sciatica|disc|back-pain/.test(u)),
      five.join(", "),
    );
    check("with one slot, the program page keeps it", choosePagesToFollow(menu, home, 1)[0] === "https://tt.test/spinal-decompression/");
    check("no trigger page linked, no slot held", choosePagesToFollow(menu.filter((l) => !/about|careers/.test(l.url)), home, 5).length === 5);
  }

  // Step 2 reads the pain points as background, and only when there are some.
  const ctx = {
    evidence: { clinicName: "Summit", websiteNotes: "x", metaAdsSignal: null, reviewCount: null },
    contactName: null,
    contactTitle: null,
    loomUrl: null,
    priorMessages: [],
    replyText: null,
  };
  const without = buildStepPrompt("FIRST_MESSAGE", ctx).user;
  const withPain = buildStepPrompt("FIRST_MESSAGE", { ...ctx, icpPainPoints: "No-shows after the first consult." }).user;
  check("step 2's prompt is unchanged when the ICP has no pain points", !without.includes("PAIN POINTS"));
  check(
    "step 2's prompt carries them as background when it does",
    withPain.includes("No-shows after the first consult.") && withPain.includes("not evidence about this clinic"),
  );
  check(
    "no other step reads them",
    !buildStepPrompt("CONNECTION", { ...ctx, icpPainPoints: "No-shows" }).user.includes("PAIN POINTS"),
  );

  // Step 2 pain points: ads-only lines, one evidenced pain, internal cost text,
  // no staff blame, asked not stated, and the templates without invented stats.
  {
    const { painEvidenceHints } = await import("../src/lib/outreachSequence");
    const pains = [
      "Paid leads go cold before a consult - $2k a lead wasted (only if ads are running)",
      "No-shows after the first consult - roughly 3 cases a month",
      "Slow replies to web enquiries",
    ].join("\n");
    const base = { contactName: null, contactTitle: null, loomUrl: null, priorMessages: [], replyText: null, icpPainPoints: pains };
    const clinic = (name: string, websiteNotes: string, metaAdsSignal: string | null, reviewCount: number | null) => ({
      ...base,
      evidence: { clinicName: name, websiteNotes, metaAdsSignal, reviewCount },
    });
    const withAds = clinic("Ads Clinic", "https://a.test/\nBook online with Jane. Text reminders before every visit.", "2 active ads, running 3mo", 80);
    const noAds = clinic("Quiet Clinic", "https://q.test/\nBook online with Jane. Text reminders before every visit.", null, 80);
    const slow = clinic("Form Clinic", "https://f.test/\nSend us a message and we'll reply within 24-48 hours. Book online anytime. We send text reminders.", null, 80);
    const none = clinic("Blank Clinic", "https://b.test/\nBook online with Jane. Text reminders before every visit.", null, null);

    const pAds = buildStepPrompt("FIRST_MESSAGE", withAds as never).user;
    const pNoAds = buildStepPrompt("FIRST_MESSAGE", noAds as never).user;
    const pSlow = buildStepPrompt("FIRST_MESSAGE", slow as never).user;
    const pNone = buildStepPrompt("FIRST_MESSAGE", none as never).user;

    check("ads clinic: the ads-only pain is shown, marker removed", pAds.includes("Paid leads go cold before a consult") && !/only if ads/i.test(pAds));
    check("ads clinic: active ads is its evidence hint", painEvidenceHints(withAds.evidence).some((h) => h.startsWith("Active Meta ads")));
    check("no-ads clinic: the ads-only pain is gone from the prompt entirely", !pNoAds.includes("Paid leads go cold"));
    check("24-48 hours note: shown as the clinic's hint, quoted", pSlow.includes('reply within 24-48 hours'));
    check("no-evidence clinic: told no pain has evidence", pNone.includes("Nothing. No pain above has evidence on this clinic."), painEvidenceHints(none.evidence).join(" | "));
    check("cost text is labelled internal and never-to-quote", pAds.includes("INTERNAL BACKGROUND, never quote or paraphrase: roughly 3 cases a month"));
    check("exactly one evidenced pain, asked as a question, no staff blame", pAds.includes("Pick exactly ONE pain") && pAds.includes("Raise the pain as a question") && pAds.includes("front desk's plate"));
    check("review count only as a plain number, never compared", pAds.includes("review count, as a plain number, never compared"));
    check("Variant B and C stats are gone", !/2-6k|ad spend itself|1-2 cases|clinics your size lose/.test(pAds), "");
    const fb = buildFirstMessageFallbackPrompt(noAds as never).user;
    check("the curiosity fallback gets the same filtered list", !fb.includes("Paid leads go cold") && fb.includes("No-shows after the first consult"));
  }

  // The invented-stats gate on generated step 2 messages.
  {
    const { inventedStatsReason, curiosityProcessNote, curiosityPainSignalNote } = await import("../src/lib/outreachSequence");
    const ev = {
      clinicName: "360 Rehab & Chiropractic",
      websiteNotes: "https://r.test/\nWe reply to every message within 24-48 hours. Open 7 days.",
      reviewCount: 18,
    };
    const bad: [string, string][] = [
      ["percent", "Noticed you run ads. Around 30% of those leads never book, worth a look?"],
      ["dollar", "At $3k a case, is follow-up on your radar?"],
      ["k figure", "That's 2-6k a case, already handled?"],
      ["most clinics", "Most clinics lose a few here. Already handled?"],
      ["usually", "That's usually where leads slip. Worth a look?"],
      ["on average", "On average that step drops leads. Worth a look?"],
      ["typically", "Typically that step drops leads. Worth a look?"],
      ["clinics your size", "Clinics your size see this a lot. Already handled?"],
      ["stray number", "Do 2 or 3 of those leads end up on the schedule?"],
      ["unquoted site number", "You reply within 24-48 hours, is that the front desk?"],
    ];
    for (const [label, msg] of bad) check(`gate rejects: ${label}`, inventedStatsReason(msg, ev) !== null, inventedStatsReason(msg, ev) ?? "passed");
    const good: [string, string][] = [
      ["review count", "Saw 360 Rehab & Chiropractic has 18 Google reviews. Is asking for reviews something that runs automatically?"],
      ["quoted site text", "Saw the contact page says “We reply to every message within 24-48 hours.” With a lot on the front desk's plate, is that hard to keep up?"],
      ["Variant A shape", "Thanks for connecting, Dr. Lee. Noticed 360 Rehab & Chiropractic is running ads to the decompression page, and the booking step looks form-only, no calendar. Curious, do most of those leads end up on the schedule, or is that something worth a second look?"],
      ["curiosity process", curiosityProcessNote({ address: "Dr. Lee", detail: "decompression and laser care" }) ?? ""],
      ["curiosity pain signal", curiosityPainSignalNote({ address: "Dr. Lee", clinicName: ev.clinicName })],
    ];
    for (const [label, msg] of good) check(`gate passes: ${label}`, inventedStatsReason(msg, ev) === null, inventedStatsReason(msg, ev) ?? "");
    const prompt = buildStepPrompt("FIRST_MESSAGE", { evidence: { ...ev, metaAdsSignal: "2 active ads, running 3mo" }, contactName: null, contactTitle: null, loomUrl: null, priorMessages: [], replyText: null } as never).user;
    check("Variant A is a question with no 'usually' claim", !prompt.includes("chunk of paid leads") && prompt.includes("end up on the schedule"));
  }

  // Service match from the clinic's name, and thin evidence is not a rejection.
  {
    const { buildBreakdownV2, coreServiceInName } = await import("../src/lib/icpScoring");
    const icpNow = (await loadActiveIcp())!;
    for (const name of ["HOH Spinal Decompression", "Renton Spinal Decompression @ Clark Chiropractic", "West Valley Auto Injury Disc and Spine"]) {
      check(`'${name}' names a core service`, coreServiceInName(name) !== null, coreServiceInName(name) ?? "none");
    }
    check("'Spine' alone does not", coreServiceInName("Northwest Spine Center") === null && coreServiceInName("Discovery Chiropractic") === null);

    const build = (clinicName: string, websiteNotes: string | null) =>
      buildBreakdownV2({
        icp: icpNow,
        evidence: { clinicName, websiteNotes, websiteUrl: websiteNotes ? "https://x.test/" : null, metaAdsSignal: null, reviewCount: null } as never,
        reply: null,
        precheck: null,
        threshold: 60,
        evidenceLabels: [],
        notes: [],
        now: new Date(),
      });
    const hoh = build("HOH Spinal Decompression", null);
    const service = hoh.fit.find((e) => e.key === "service");
    check(
      "a name with 'Spinal Decompression' is a cited core-service match, citing the name",
      service?.points === 35 && service.citations[0]?.source === "Clinic name" && service.citations[0]?.quote === "HOH Spinal Decompression",
      `${service?.points} ${JSON.stringify(service?.citations)}`,
    );

    const thin = build("Northwest Spine Center", "https://x.test/\nWelcome to our clinic. Call us today.");
    check(
      "nothing found → 'Not enough evidence', not rejected",
      thin.verdict.status === "INSUFFICIENT" && thin.verdict.kind === "insufficient_evidence",
      thin.verdict.reason,
    );
    // A cited non-fit (general chiropractic, cited, with no program) is a rejection.
    const general = finishWith(thin, (fit) =>
      fit.map((e) => (e.key === "service" ? { ...e, points: 0, citations: [{ quote: "Family chiropractic care for all ages", source: "https://x.test/services" }], source: "assist" as const } : e)),
    );
    check("a cited non-fit is still rejected", general.verdict.status === "REJECTED" && general.verdict.kind === "not_a_fit", general.verdict.reason);
  }

  // Review fixes: name as program signal, negated quotes, PI as the main business.
  {
    const { buildBreakdownV2, chiroProgramCheck, evidenceDocs, dqId } = await import("../src/lib/icpScoring");
    const { disqualifierLines } = await import("../src/lib/icpDefinition");
    const icpNow = (await loadActiveIcp())!;
    const piIndex = disqualifierLines(icpNow).findIndex((l) => /lien/i.test(l));
    check("the seeded ICP has a PI/lien disqualifier", piIndex !== -1, disqualifierLines(icpNow)[piIndex] ?? "none");

    for (const name of ["HOH Spinal Decompression", "Renton Spinal Decompression @ Clark Chiropractic", "Non-Surgical Spine Care Center"]) {
      const ev = { clinicName: name, websiteNotes: "https://x.test/\nWelcome to our clinic.", websiteLinks: null, metaAdsSignal: null, reviewCount: null };
      const page = chiroProgramCheck(ev as never, null, evidenceDocs(ev as never)).signals.find((x) => x.key === "page");
      check(`'${name}' counts as the dedicated-program signal, citing the name`,
        page?.found === true && page.citations[0]?.source === "Clinic name" && page.citations[0]?.quote === name, page?.reason);
    }

    const pi = (quote: string, clinicName: string) => {
      const notes = `https://x.test/\n${quote}\nWe offer chiropractic adjustments and spinal decompression.`;
      const b = buildBreakdownV2({
        icp: icpNow,
        evidence: { clinicName, websiteNotes: notes, websiteUrl: "https://x.test/", metaAdsSignal: null, reviewCount: null } as never,
        reply: {
          disqualifiers: [{ id: dqId(piIndex), quote, source: "https://x.test/", reason: "The clinic is PI/lien based." }],
          coreService: null, adjacentService: null, spineProgram: null, primaryService: null, decisionMaker: null,
          location: null, locationCount: null, team: null, buyingTriggers: [], paymentModel: null, gaps: {}, summary: "",
        } as never,
        precheck: null, threshold: 60, evidenceLabels: [], notes: [], now: new Date(),
      });
      return b.disqualifiers[piIndex];
    };
    const buffalo = pi("No MedPay auto claim processing.", "Buffalo Spine & Sport");
    check("Buffalo: 'No MedPay auto claim processing.' does not trigger PI/lien", buffalo.triggered === false, buffalo.discarded ?? "");
    const milpitas = pi("We accept liens and work with attorneys.", "Milpitas Spine");
    check("Milpitas: accepting liens beside regular care does not trigger PI/lien", milpitas.triggered === false, milpitas.discarded ?? "");
    const pa = pi("We also treat personal injury patients and work with your attorney.", "PA Pain & Rehab");
    check("PA Pain & Rehab: PI as one option does not trigger", pa.triggered === false, pa.discarded ?? "");
    const real = pi("We are a personal injury chiropractic clinic — we only treat auto accident injuries.", "Crash Injury Chiro");
    check("PI stated as the main business still triggers", real.triggered === true, real.reason);
  }

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
