// New-model tier bands: A 80–100, B 50–79, C 0–49.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy   (runs the re-band migration)
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-tier-bands.ts
//
// Checks the bands, that a stored scorecard is re-tiered when read (no
// re-scoring), that rule rejections keep their reason, that the candidate
// migration re-bands the stored column the same way, and that the Qualified
// Leads count and the Daily KPI's A/B count pick the new bands up.

import Module from "node:module";
import path from "node:path";
import fs from "node:fs";

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
  const { v2TierForScore, tierFor, parseBreakdownV2, buildBreakdownV2, finish, V2_TIER_BANDS } = await import("../src/lib/icpScoring");
  const { leadTier, leadVerdictBadge } = await import("../src/lib/leadScore");
  const { qualifiedLeads } = await import("../src/lib/funnel");
  const { loadActiveIcp } = await import("../src/lib/icpDefinitionStore");
  const { DEFAULT_V2_PROMOTION_THRESHOLD, FIT_FLOOR } = await import("../src/lib/icpWeights");

  console.log("\nThe bands");
  const cases: [number, string][] = [[100, "A"], [80, "A"], [79, "B"], [50, "B"], [49, "C"], [0, "C"]];
  for (const [score, tier] of cases) check(`${score} → ${tier}`, v2TierForScore(score) === tier, v2TierForScore(score));
  check("the legend reads A 80–100 · B 50–79 · C 0–49", V2_TIER_BANDS === "A 80–100 · B 50–79 · C 0–49", V2_TIER_BANDS);
  check("fit floor and default promotion bar unchanged", FIT_FLOOR === 35 && DEFAULT_V2_PROMOTION_THRESHOLD === 60);
  check("rule rejections stay C whatever the score", tierFor(85, "chiro_no_program", false) === "C" && tierFor(55, "not_a_fit", false) === "C");
  check("a disqualification stays disqualified", tierFor(70, "disqualified", true) === "DISQUALIFIED");

  // A breakdown stored under the old bands: 55/100, below the bar, saved as C.
  const icp = (await loadActiveIcp())!;
  const base = buildBreakdownV2({
    icp,
    evidence: { clinicName: "Banded Clinic", websiteNotes: "https://b.test/\nCare.", websiteUrl: "https://b.test/", metaAdsSignal: null, reviewCount: null } as never,
    reply: null, precheck: null, threshold: 60, evidenceLabels: [], notes: [], now: new Date(),
  });
  const cite = [{ quote: "Care.", source: "https://b.test/" }];
  const make = (fitPoints: (max: number) => number, chiro: boolean, signal: number) =>
    finish(
      {
        ...base,
        fit: base.fit.map((e) => ({ ...e, points: fitPoints(e.max), citations: cite, source: "assist" as const })),
        signals: base.signals.map((e, i) => ({ ...e, points: i === 0 ? signal : 0 })),
        primaryService: { ...base.primaryService, chiropractic: chiro },
      },
      60,
    );
  const below = make((m) => m, false, 0); // fit 60, total 60 → promoted at bar 60
  const fiftyFive = { ...below, total: 55, verdict: { ...below.verdict, status: "REJECTED" as const, kind: "below_threshold" as const }, tier: "C" as const };
  const chiro = make((m) => m, true, 20); // 80, chiro without program
  const storedOld = JSON.stringify(fiftyFive);

  console.log("\nStored scorecards re-tier when read — no re-scoring");
  check("a stored 55/100 'C' reads back as B", parseBreakdownV2(storedOld)?.tier === "B");
  const lead55 = await prisma.lead.create({ data: { clinicName: "Fifty-Five Spine", stage: "NEW", icpBreakdown: storedOld, icpBreakdownAt: new Date() } });
  const leadChiro = await prisma.lead.create({ data: { clinicName: "Eighty Chiro", stage: "NEW", icpBreakdown: JSON.stringify(chiro), icpBreakdownAt: new Date() } });
  check("the 55/100 lead's tier is B", leadTier(lead55) === "B");
  check("the 80/100 chiro-without-program lead still shows its reason, not a tier",
    leadVerdictBadge(leadChiro) === "80/100 · Rejected: chiro without a real program", leadVerdictBadge(leadChiro) ?? "none");
  check("the Qualified Leads count includes the re-tiered lead", qualifiedLeads([lead55, leadChiro]).total === 1);

  console.log("\nThe candidate migration re-bands the stored column");
  await prisma.discoveryCandidate.deleteMany();
  const cand = (name: string, b: unknown, tier: string, total: number) =>
    prisma.discoveryCandidate.create({
      data: { clinicName: name, status: "REJECTED", scoringModel: "v2", icpTotal: total, icpTier: tier, icpBreakdown: JSON.stringify(b), processedAt: new Date() },
    });
  const c55 = await cand("Cand 55", fiftyFive, "C", 55);
  const cChiro = await cand("Cand chiro", chiro, "C", 80);
  const c45 = await cand("Cand 45", { ...fiftyFive, total: 45 }, "C", 45);
  const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261024120000_tier_bands_80_50/migration.sql"), "utf8");
  await prisma.$executeRawUnsafe(sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"));
  const after = async (id: string) => (await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id } })).icpTier;
  check("a 55/100 candidate below the bar becomes B", (await after(c55.id)) === "B");
  check("a 45/100 candidate stays C", (await after(c45.id)) === "C");
  check("a rule-rejected candidate stays C", (await after(cChiro.id)) === "C");
  const kpiAB = await prisma.discoveryCandidate.count({ where: { processedAt: { gte: new Date(Date.now() - 86_400_000) }, icpTier: { in: ["A", "B"] } } });
  check("the Daily KPI's A/B count picks it up", kpiAB === 1, String(kpiAB));

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
