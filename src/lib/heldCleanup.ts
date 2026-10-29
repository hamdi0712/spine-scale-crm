// The end of the Tier 2 chiro hold.
//
// The hold has been replaced by the real-program check: a chiropractic-first
// clinic that clears the fit floor and the bar is promoted with two or more of
// five cited signals, and rejected without them. A candidate the old rule left
// in HELD_CHIRO is re-judged here so none is stranded in a status nothing
// shows any more.
//
// No model call and no actor run: the five signals are read off the evidence
// already stored on the candidate, and the rest of its stored breakdown — the
// gate, Fit, Signals — stands as it was scored. Promotion goes through the one
// promotion path every other one uses.
//
// Server-only, not a "use server" module. Called on the way into Discovery,
// where it costs one count query on every load after the last held row is
// gone.

import { prisma } from "@/lib/prisma";
import { parseBreakdownV2, rejudgeChiroProgram, serializeBreakdownV2 } from "@/lib/icpScoring";
import { promoteToLead } from "@/lib/promoteLead";
import { findSuppression } from "@/lib/suppression";

// The status the hold wrote. No longer one of DISCOVERY_STATUSES; named here
// so this is the only place that still knows it.
export const RETIRED_HELD_STATUS = "HELD_CHIRO";

export interface HeldCleanupResult {
  promoted: string[];
  rejected: string[];
  requeued: string[];
}

export async function resolveHeldCandidates(now = new Date()): Promise<HeldCleanupResult> {
  const result: HeldCleanupResult = { promoted: [], rejected: [], requeued: [] };
  const held = await prisma.discoveryCandidate.findMany({
    // Talking on LinkedIn is never promoted, so it is not re-judged for it.
    where: { status: RETIRED_HELD_STATUS, linkedinConflictLeadId: null },
  });
  for (const c of held) {
    // On the suppression list: left as it is, never promoted.
    if (!c.promotedLeadId && (await findSuppression({ email: c.email, websiteUrl: c.websiteUrl }))) continue;
    if (c.promotedLeadId) {
      await prisma.discoveryCandidate.update({ where: { id: c.id }, data: { status: "PROMOTED" } });
      result.promoted.push(c.clinicName);
      continue;
    }
    const stored = parseBreakdownV2(c.icpBreakdown);
    if (!stored) {
      // Nothing to re-judge from: back into the queue, where the next run
      // scores it from the top under whichever model is applied.
      await prisma.discoveryCandidate.update({
        where: { id: c.id },
        data: { status: "PENDING", icpTotal: null, icpTier: null, icpBreakdown: null, scoringModel: null },
      });
      result.requeued.push(c.clinicName);
      continue;
    }
    const breakdown = rejudgeChiroProgram(stored, {
      clinicName: c.clinicName,
      websiteUrl: c.websiteUrl,
      websiteNotes: c.websiteNotes,
      websiteLinks: c.websiteLinks,
      metaAdsSignal: c.metaAdsSignal,
      reviewCount: c.reviewCount,
      staffCountRaw: c.staffCountRaw,
      location: c.location,
      contactName: c.contactName,
      contactTitle: c.contactTitle,
    });
    await prisma.discoveryCandidate.update({
      where: { id: c.id },
      data: {
        status: "SCORED",
        icpTotal: breakdown.total,
        icpTier: breakdown.tier,
        icpBreakdown: serializeBreakdownV2(breakdown),
      },
    });
    if (breakdown.verdict.status === "PROMOTED") {
      await promoteToLead(c.id, breakdown, now);
      result.promoted.push(c.clinicName);
    } else if (breakdown.verdict.status === "INSUFFICIENT") {
      await prisma.discoveryCandidate.update({
        where: { id: c.id },
        data: { status: "FAILED", failureReason: breakdown.verdict.reason, processedAt: now },
      });
      result.rejected.push(c.clinicName);
    } else {
      await prisma.discoveryCandidate.update({
        where: { id: c.id },
        data: { status: "REJECTED", disqualifiedReason: breakdown.verdict.reason, processedAt: now },
      });
      result.rejected.push(c.clinicName);
    }
  }
  return result;
}
