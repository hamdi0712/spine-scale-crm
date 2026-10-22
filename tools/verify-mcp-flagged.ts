// The connector's lead lookups after "Apply new scoring", through
// runCopilotTool — the entry point the MCP server calls:
//
//   1. Leads flagged "Rejected by new scoring" are left out of getPipelineLeads
//      and searchLeads (and the live lists) unless includeRejectedByNewScoring
//      is passed, exactly like the app's default Pipeline view.
//   2. A lead rejected by a rule rather than its score shows the reason, not
//      "C-tier": "80/100 · Rejected: chiro without a real program".
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-mcp-flagged.ts

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

type Lead = { id: string; clinicName: string; icpTier: string; icpScore: string | null; rejectedByNewScoring?: boolean };

async function main(): Promise<void> {
  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }
  const { prisma } = await import("../src/lib/prisma");
  const { runCopilotTool } = await import("../src/lib/copilotLookups");
  const { buildBreakdownV2, finish, serializeBreakdownV2 } = await import("../src/lib/icpScoring");
  const { loadActiveIcp } = await import("../src/lib/icpDefinitionStore");
  const { leadVerdictBadge } = await import("../src/lib/leadScore");

  await prisma.lead.deleteMany();
  const icp = (await loadActiveIcp())!;

  // A chiro clinic that scores 80 but has no real program: tier C by rule.
  const base = buildBreakdownV2({
    icp,
    evidence: { clinicName: "Highscore Chiro", websiteNotes: "https://h.test/\nChiropractic care.", websiteUrl: "https://h.test/", metaAdsSignal: null, reviewCount: null } as never,
    reply: null, precheck: null, threshold: 60, evidenceLabels: [], notes: [], now: new Date(),
  });
  const cite = [{ quote: "Chiropractic care.", source: "https://h.test/" }];
  const chiro = finish(
    {
      ...base,
      fit: base.fit.map((e) => ({ ...e, points: e.max, citations: cite, source: "assist" as const })),
      signals: base.signals.map((e, i) => ({ ...e, points: i === 0 ? 20 : 0 })),
      primaryService: { ...base.primaryService, chiropractic: true },
    },
    60,
  );
  console.log(`  seeded chiro breakdown: ${chiro.total}/100, tier ${chiro.tier}, verdict ${chiro.verdict.kind}`);

  const normal = await prisma.lead.create({ data: { clinicName: "Normal Spine", stage: "NEW" } });
  const flagged = await prisma.lead.create({
    data: { clinicName: "Flagged Spine", stage: "NEW", scoringRejectedAt: new Date(), scoringRejectedReason: "Not a confirmed fit." },
  });
  const ruled = await prisma.lead.create({
    data: { clinicName: "Highscore Chiro", stage: "NEW", icpBreakdown: serializeBreakdownV2(chiro), icpBreakdownAt: new Date() },
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await runCopilotTool(name, JSON.stringify(args));
    if (!r.ok) throw new Error(`${name}: ${r.message}`);
    return r.data as Record<string, unknown>;
  };

  console.log("\n1. Flagged leads hidden unless asked for");
  const pl = await call("getPipelineLeads", {});
  const plLeads = pl.leads as Lead[];
  check("getPipelineLeads leaves the flagged lead out by default", !plLeads.some((l) => l.id === flagged.id) && plLeads.some((l) => l.id === normal.id));
  check("…and says how many it left out", pl.leftOutRejectedByNewScoring === 1, String(pl.leftOutRejectedByNewScoring));
  const plAll = (await call("getPipelineLeads", { includeRejectedByNewScoring: true })).leads as Lead[];
  const f = plAll.find((l) => l.id === flagged.id);
  check("with includeRejectedByNewScoring it is there, marked with its reason", f?.rejectedByNewScoring === true);

  const sl = (await call("searchLeads", { query: "Flagged" })).leads as Lead[] | undefined;
  check("searchLeads does not find it by default", !(sl ?? []).some((l) => l.id === flagged.id));
  const slAll = (await call("searchLeads", { query: "Flagged", includeRejectedByNewScoring: true })).leads as Lead[];
  check("…and finds it when asked", slAll.some((l) => l.id === flagged.id && l.rejectedByNewScoring === true));

  const detail = await call("getLeadDetail", { id: flagged.id });
  const icpBlock = detail.icp as Record<string, unknown>;
  check("getLeadDetail on the lead itself says it is flagged, with the reason",
    icpBlock.rejectedByNewScoring === true && icpBlock.rejectedByNewScoringReason === "Not a confirmed fit.");

  console.log("\n2. A rule rejection shows its reason, not C-tier");
  const r = ((await call("getPipelineLeads", {})).leads as Lead[]).find((l) => l.id === ruled.id);
  check("the connector reads 'Rejected: chiro without a real program', not C-tier",
    r?.icpTier === "Rejected: chiro without a real program", `${r?.icpScore} · ${r?.icpTier}`);
  const badge = leadVerdictBadge(await prisma.lead.findUniqueOrThrow({ where: { id: ruled.id } }));
  check("the Pipeline badge reads '80/100 · Rejected: chiro without a real program'",
    badge === `${chiro.total}/100 · Rejected: chiro without a real program`, badge ?? "none");
  check("a lead with no rule rejection keeps its usual tier badge", leadVerdictBadge(normal) === null);

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
