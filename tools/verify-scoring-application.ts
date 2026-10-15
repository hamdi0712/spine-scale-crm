// Apply new scoring to existing records, and revert it, on a seeded set.
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-scoring-application.ts
//
// Seeds candidates, leads and one finished Compare scoring run, then prints the
// live counts the dashboard, Pipeline and Outreach read — before the apply,
// after it, and after the revert — and checks the revert lands back on the
// "before" numbers exactly. Then a second round: re-apply the same comparison,
// message a lead the apply created, revert, and check that lead is kept.
//
// Writes only to the database DATABASE_URL names. Point it at a scratch file.

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
  const { prisma } = await import("../src/lib/prisma");
  const { planApplication, applyScoring, revertScoring } = await import("../src/lib/scoringApplication");
  const W = await import("../src/lib/liveLeadWhere");
  const { qualifiedLeads } = await import("../src/lib/funnel");
  const { loadPipelineSettings, savePipelineSettings } = await import("../src/lib/pipelineSettingsStore");

  if (!/verify/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a scratch database with 'verify' in its name.");
  }

  // ─── Seed ────────────────────────────────────────────────────────────────
  await prisma.scoringApplicationItem.deleteMany();
  await prisma.scoringApplication.deleteMany();
  await prisma.scoringComparisonRun.deleteMany();
  await prisma.outreachMessage.deleteMany();
  await prisma.call.deleteMany();
  await prisma.discoveryCandidate.deleteMany();
  await prisma.lead.deleteMany();
  await savePipelineSettings({ ...(await loadPipelineSettings()), scoringModel: "v1" });

  // A-tier on the old scorecard, so it counts as a Qualified lead.
  const scoredA = {
    icpScoredAt: new Date("2026-09-01"),
    icpStaffSize: 2,
    icpPackageEconomics: 3,
    icpBudgetSignal: 2,
    icpGapBooking: true,
    icpGapReviews: true,
    icpGapRemarketing: true,
  };
  const lead = (clinicName: string, data: Record<string, unknown> = {}) =>
    prisma.lead.create({ data: { clinicName, stage: "NEW", estValue: 5000, ...scoredA, ...data } });
  const candidate = (clinicName: string, status: string, data: Record<string, unknown> = {}) =>
    prisma.discoveryCandidate.create({
      data: { clinicName, status, icpTotal: status === "PROMOTED" ? 7 : 3, icpTier: status === "PROMOTED" ? "B" : "C", scoringModel: "v1", disqualifiedReason: status === "REJECTED" ? "Scored C-tier: 3/10" : null, ...data },
    });

  const lPromoted = await lead("Peak Spine (promoted, now rejected)");
  const lReplied = await lead("Harbor Wellness (has a reply)", { stage: "CONTACTED", repliedAt: new Date("2026-10-01") });
  const lContacted = await lead("Cedar Chiro (contacted, rejected)", { stage: "CONTACTED" });
  const lDiscovery = await lead("Summit Rehab (discovery call booked)", { stage: "DISCOVERY" });
  const lCall = await lead("Oak Spine (call logged)");
  await prisma.call.create({ data: { leadId: lCall.id, type: "DISCOVERY", status: "COMPLETED", scheduledAt: new Date("2026-10-02") } });
  const lLost = await lead("Birch Clinic (lost)", { stage: "LOST" });
  await lead("Maple Health (unchanged)");
  const lMessaged = await lead("Aspen Chiro (messaged 5 days ago)", { stage: "CONTACTED" });
  await prisma.outreachMessage.create({
    data: { leadId: lMessaged.id, step: "FIRST_MESSAGE", content: "Thanks for connecting.", sentAt: new Date(Date.now() - 5 * 86_400_000) },
  });
  const lThinOld = await lead("Willow Wellness (thin evidence, old comparison)");
  const lFailed = await lead("Spruce Chiro (not enough evidence)");

  const cNew1 = await candidate("River Decompression (newly promoted)", "REJECTED");
  const cNew2 = await candidate("Lakeside Disc Center (newly promoted)", "REJECTED");
  const cRej = await candidate("Valley Chiro (newly rejected)", "PROMOTED");
  const cPeak = await candidate("Peak Spine (promoted, now rejected)", "PROMOTED", { promotedLeadId: lPromoted.id });
  const cHarbor = await candidate("Harbor Wellness (has a reply)", "PROMOTED", { promotedLeadId: lReplied.id });
  const cStale = await candidate("Pine Back Care (promoted by hand since)", "REJECTED");
  await candidate("Elm Chiro (unchanged)", "REJECTED");

  const run = await prisma.scoringComparisonRun.create({
    data: { icpName: "Primary ICP", threshold: 60, subjects: 12, estimatedUsd: 0, startedAt: new Date(Date.now() - 60_000), completedAt: new Date(Date.now() - 30_000) },
  });
  // Rows written exactly as Compare scoring writes them: the old standing as
  // its display label, with its score and tier, read off the record.
  const { candidateStanding, leadStanding, LEAD_SCORE_SELECT } = await import("../src/lib/scoringComparisonStore");
  const row = async (subjectKind: string, subjectId: string, clinicName: string, _old: string, newStatus: string, outcome: string, flipReason: string | null) => {
    const old =
      subjectKind === "candidate"
        ? candidateStanding(await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: subjectId } }))
        : leadStanding(await prisma.lead.findUniqueOrThrow({ where: { id: subjectId }, select: LEAD_SCORE_SELECT }));
    return prisma.scoringComparison.create({
      data: { runId: run.id, subjectKind, subjectId, clinicName, oldStatus: old.label, oldScore: old.score, oldMax: old.max, oldTier: old.tier, newStatus, outcome, flipReason, newScore: newStatus === "PROMOTED" ? 78 : 41, newTier: newStatus === "PROMOTED" ? "B" : "C" },
    });
  };
  await row("candidate", cNew1.id, cNew1.clinicName, "REJECTED", "PROMOTED", "newly_promoted", null);
  await row("candidate", cNew2.id, cNew2.clinicName, "REJECTED", "PROMOTED", "newly_promoted", null);
  await row("candidate", cRej.id, cRej.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Not a confirmed fit: no core service found.");
  await row("candidate", cPeak.id, cPeak.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Chiro without a real program (1 of 5 signals).");
  await row("candidate", cHarbor.id, cHarbor.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Not a confirmed fit.");
  await row("candidate", cStale.id, cStale.clinicName, "REJECTED", "PROMOTED", "newly_promoted", null);
  await row("lead", lContacted.id, lContacted.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Insurance-only practice.");
  await row("lead", lDiscovery.id, lDiscovery.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Not a confirmed fit.");
  await row("lead", lCall.id, lCall.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Not a confirmed fit.");
  await row("lead", lLost.id, lLost.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Out of region.");
  await row("lead", lMessaged.id, lMessaged.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Not a confirmed fit.");
  await row("lead", lFailed.id, lFailed.clinicName, "PROMOTED", "FAILED", "newly_failed", "Not enough evidence — nothing cited.");
  // A rejection stored by a comparison run before the thin-evidence rule: its
  // breakdown has nothing cited, so it re-judges to "Not enough evidence".
  {
    const { buildBreakdownV2, serializeBreakdownV2 } = await import("../src/lib/icpScoring");
    const { loadActiveIcp } = await import("../src/lib/icpDefinitionStore");
    const thin = buildBreakdownV2({
      icp: (await loadActiveIcp())!,
      evidence: { clinicName: lThinOld.clinicName, websiteNotes: "https://w.test/\nWelcome. Call us today.", websiteUrl: "https://w.test/", metaAdsSignal: null, reviewCount: null } as never,
      reply: null, precheck: null, threshold: 60, evidenceLabels: [], notes: [], now: new Date(),
    });
    const asOldRejection = { ...thin, verdict: { ...thin.verdict, status: "REJECTED" as const, kind: "not_a_fit" as const, reason: "Not a confirmed fit — fit 0/60." } };
    const created = await row("lead", lThinOld.id, lThinOld.clinicName, "PROMOTED", "REJECTED", "newly_rejected", "Not a confirmed fit.");
    await prisma.scoringComparison.update({ where: { id: created.id }, data: { breakdown: serializeBreakdownV2(asOldRejection) } });
  }
  // Promoted by hand after the comparison ran: stale.
  await prisma.discoveryCandidate.update({ where: { id: cStale.id }, data: { status: "PROMOTED" } });
  // Touched by an automatic write that changes nothing that matters (the
  // kind of write that moves updatedAt): not stale.
  await prisma.discoveryCandidate.update({ where: { id: cNew2.id }, data: { secondLookAt: new Date() } });
  await prisma.lead.update({ where: { id: lContacted.id }, data: { timeZone: "America/Chicago" } });

  // ─── The live numbers ────────────────────────────────────────────────────
  async function counts() {
    const open = await prisma.lead.findMany({ where: W.OPEN_LEADS_WHERE });
    const candidates = await prisma.discoveryCandidate.groupBy({ by: ["status"], _count: true });
    const by = Object.fromEntries(candidates.map((c) => [c.status, c._count]));
    return {
      "Qualified leads": qualifiedLeads(open).total,
      "Messages sent": await prisma.lead.count({ where: W.CONTACTED_LEADS_WHERE }),
      "Pipeline value": open.reduce((s, l) => s + (l.estValue ?? 0), 0),
      "Outreach queue": await prisma.lead.count({ where: W.OUTREACH_QUEUE_WHERE }),
      "Today's focus leads": open.length,
      "Pipeline (default view)": await prisma.lead.count({ where: W.PIPELINE_DEFAULT_WHERE }),
      "Rejected by new scoring": await prisma.lead.count({ where: W.PIPELINE_SCORING_REJECTED_WHERE }),
      "Candidates promoted": by.PROMOTED ?? 0,
      "Candidates rejected": by.REJECTED ?? 0,
      "Process Queue model": (await loadPipelineSettings()).scoringModel,
    };
  }
  type Counts = Awaited<ReturnType<typeof counts>>;
  const table = (cols: [string, Counts][]) => {
    const keys = Object.keys(cols[0][1]) as (keyof Counts)[];
    console.log(`\n  ${"".padEnd(26)}${cols.map(([h]) => h.padStart(16)).join("")}`);
    for (const k of keys) console.log(`  ${k.padEnd(26)}${cols.map(([, c]) => String(c[k]).padStart(16)).join("")}`);
    console.log("");
  };
  const same = (a: Counts, b: Counts) => JSON.stringify(a) === JSON.stringify(b);

  // ─── Round 1: apply, revert ──────────────────────────────────────────────
  console.log("\nRound 1 — apply, then revert untouched");
  const before = await counts();
  const planned = await planApplication();
  if (!planned.ok) throw new Error(planned.error);
  const p = planned.plan;
  console.log(`  Confirm screen: ${p.promote.length} promoted, ${p.reject.length} rejected, ${p.flag.length} leads flagged, ${p.protectedLeads.length} protected, ${p.stale.length} skipped (${Math.round(p.staleShare * 100)}% stale${p.staleWarning ? " — warning shown" : ""})`);
  check("confirm counts: 2 promoted, 1 rejected, 3 flagged, 4 protected, 2 not enough evidence, 1 stale",
    p.promote.length === 2 && p.reject.length === 1 && p.flag.length === 3 && p.protectedLeads.length === 4 && p.insufficient.length === 2 && p.stale.length === 1,
    `${p.promote.length}/${p.reject.length}/${p.flag.length}/${p.protectedLeads.length}/${p.insufficient.length}/${p.stale.length}`);
  check("a lead messaged in the last 30 days is protected", p.protectedLeads.some((e) => e.id === lMessaged.id && /last 30 days/.test(e.reason)));
  check("'not enough evidence' is its own group, never flagged",
    p.insufficient.some((e) => e.id === lFailed.id) && !p.flag.some((e) => e.leadId === lFailed.id));
  check("a thin-evidence rejection from an older comparison is re-judged as not enough evidence",
    p.insufficient.some((e) => e.id === lThinOld.id) && !p.flag.some((e) => e.leadId === lThinOld.id));
  check("the lead with a reply is protected, not flagged",
    p.protectedLeads.some((e) => e.id === lReplied.id) && !p.flag.some((e) => e.leadId === lReplied.id));
  check("discovery-call and call-logged leads are protected; Lost is not",
    p.protectedLeads.some((e) => e.id === lDiscovery.id) && p.protectedLeads.some((e) => e.id === lCall.id) && p.flag.some((e) => e.leadId === lLost.id));
  const staleHand = p.stale.find((e) => e.id === cStale.id);
  check("a candidate promoted by hand since the comparison is skipped, naming the field",
    staleHand?.clinicName === cStale.clinicName && staleHand.changes.some((c) => c.field === "status" && c.compared === "Rejected" && c.current === "Promoted" && c.at !== null),
    JSON.stringify(staleHand?.changes));
  check("a write that changes no scoring or status field is not stale", !p.stale.some((e) => e.id === cNew2.id || e.id === lContacted.id));
  check("1 stale of 11 is not over 10%, so no warning", !p.staleWarning);

  const applied = await applyScoring();
  if (!applied.ok) throw new Error(applied.error);
  const after = await counts();
  check("a second apply is refused while one is active", !(await applyScoring()).ok);
  check("the reply lead is untouched", (await prisma.lead.findUniqueOrThrow({ where: { id: lReplied.id } })).scoringRejectedAt === null);
  const reverted = await revertScoring(applied.applicationId);
  if (!reverted.ok) throw new Error(reverted.error);
  const afterRevert = await counts();
  table([["Before", before], ["After apply", after], ["After revert", afterRevert]]);
  check("after revert equals before, exactly", same(before, afterRevert));
  check("revert kept nothing back", reverted.kept.length === 0, JSON.stringify(reverted.kept));
  check("both leads the apply created were deleted", reverted.deletedLeads === 2);

  // ─── Round 2: re-apply, work on a created lead, revert ───────────────────
  console.log("\nRound 2 — re-apply the same comparison, message a lead it created, revert");
  const again = await applyScoring();
  if (!again.ok) throw new Error(again.error);
  check("re-apply after a revert uses the same comparison and the same counts",
    again.promoted === 2 && again.rejected === 1 && again.flagged === 3 && again.protected === 4);
  const river = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: cNew1.id } });
  await prisma.outreachMessage.create({
    data: { leadId: river.promotedLeadId!, step: "CONNECTION", content: "Hi, saw your decompression page.", sentAt: new Date(Date.now() + 1000) },
  });
  const afterApply2 = await counts();
  const reverted2 = await revertScoring(again.applicationId);
  if (!reverted2.ok) throw new Error(reverted2.error);
  const afterRevert2 = await counts();
  table([["Before", before], ["After re-apply", afterApply2], ["After revert", afterRevert2]]);
  console.log("  Kept on revert:");
  for (const k of reverted2.kept) console.log(`    ${k.clinicName}: ${k.reason}`);
  check("the lead messaged after applying is kept through the revert",
    reverted2.kept.some((k) => k.id === river.promotedLeadId) && (await prisma.lead.findUnique({ where: { id: river.promotedLeadId! } })) !== null);
  check("its candidate stays promoted, linked to it",
    (await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: cNew1.id } })).promotedLeadId === river.promotedLeadId);
  check("the other created lead is deleted", reverted2.deletedLeads === 1);
  const diff = (Object.keys(before) as (keyof Counts)[]).filter((k) => before[k] !== afterRevert2[k]);
  check(
    "every other number is back to before — only the kept lead's own counts differ",
    diff.every((k) => ["Pipeline value", "Outreach queue", "Today's focus leads", "Pipeline (default view)", "Candidates promoted", "Candidates rejected"].includes(k)) &&
      afterRevert2["Pipeline (default view)"] === before["Pipeline (default view)"] + 1 &&
      afterRevert2["Candidates promoted"] === before["Candidates promoted"] + 1,
    diff.join(", "),
  );
  check("no lead is left flagged after either revert", afterRevert2["Rejected by new scoring"] === 0);
  check("Process Queue is back on the old model", afterRevert2["Process Queue model"] === "v1");

  // A re-crawl after the comparison makes a record stale, and enough of them
  // trip the >10% warning.
  await prisma.discoveryCandidate.update({ where: { id: cRej.id }, data: { enrichedAt: new Date(), websiteNotes: "re-crawled" } });
  const p3 = await planApplication();
  if (!p3.ok) throw new Error(p3.error);
  const recrawled = p3.plan.stale.find((e) => e.id === cRej.id);
  check("a re-crawl after the comparison is stale, with the field and when",
    recrawled?.changes.some((c) => c.field.startsWith("website notes") && c.at !== null) === true, JSON.stringify(recrawled?.changes));
  check("more than 10% stale shows the warning", p3.plan.staleWarning, `${Math.round(p3.plan.staleShare * 100)}%`);
  console.log("\n  Skipped list as the confirm screen shows it:");
  for (const e of p3.plan.stale) console.log(`    ${e.clinicName} (${e.kind}): ${e.changes.map((c) => `${c.field} ${c.compared} → ${c.current}${c.at ? ` at ${c.at}` : ""}`).join("; ")}`);

  const history = await prisma.scoringApplication.findMany({ orderBy: { appliedAt: "asc" } });
  check("history keeps both applications, both reverted", history.length === 2 && history.every((h) => h.revertedAt !== null));

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
