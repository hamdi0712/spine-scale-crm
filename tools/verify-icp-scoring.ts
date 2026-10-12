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
// chiropractic-first clinic with a disc program (the Tier 2 hold), a lead with
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
    expect: "newly_held",
    expectDiscarded: /absence or a hedge/,
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
  const { buildStepPrompt } = await import("@/lib/outreachSequence");

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
  const order = ["newly_rejected", "newly_promoted", "newly_held", "newly_failed", "unchanged"];
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
  check("the second-look sweep reads a v2 rejection on its own scale", flag === null, `fit ${peak.fitTotal}/60 is not a near miss of 40`);

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

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
