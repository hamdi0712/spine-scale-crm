// Promotion — a candidate becoming a lead, in one transaction.
//
// Lifted out of src/lib/actions/discovery.ts unchanged when the
// decision-maker stage arrived and needed to promote the same way. It is
// server-only and deliberately not a "use server" module: those may export
// nothing but server actions, and this is a helper the queue, the manual
// override and the decision-maker stage all call — not an endpoint the browser
// is allowed to reach on its own. Same split as src/lib/googleSearchRun.ts.
//
// One promotion path, so a lead created by the queue and a lead created after
// a decision maker turned up are the same record made the same way.

import { prisma } from "@/lib/prisma";
import { DiscoveryBreakdown, leadScorecardPrefill } from "@/lib/discovery";
import { isUsTimeZone } from "@/lib/timezones";

// The stage a promoted candidate's lead starts at. An import is the top of the
// funnel by definition, and passing through Discovery does not advance it —
// scoring says whether to talk to a clinic, not that anybody has.
export const PROMOTED_LEAD_STAGE = "NEW";

// Creates the lead and marks the candidate promoted, in one transaction: a
// lead with no candidate pointing at it would be re-created by the next run of
// the queue, and a candidate pointing at a lead that was never written would
// be worse.
//
// A breakdown of null is the honest case where a candidate is promoted before
// it was ever scored — the lead is created with its fields and an unscored
// card, which is exactly what it is.
export async function promoteToLead(
  candidateId: string,
  breakdown: DiscoveryBreakdown | null,
  now: Date,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.discoveryCandidate.findUniqueOrThrow({
      where: { id: candidateId },
    });

    const lead = await tx.lead.create({
      data: {
        clinicName: candidate.clinicName,
        contactName: candidate.contactName,
        // The role and the public profiles the decision-maker stage
        // established, carried across rather than re-found. Null on a
        // candidate that never went through that stage, which is every
        // person-first one.
        contactTitle: candidate.contactTitle,
        contactSocialUrls: candidate.contactSocialUrls,
        phone: candidate.phone,
        email: candidate.email,
        leadSource: candidate.source,
        stage: PROMOTED_LEAD_STAGE,
        estValue: candidate.estValue,
        linkedinUrl: candidate.linkedinUrl,
        companyLinkedinUrl: candidate.companyLinkedinUrl,
        websiteUrl: candidate.websiteUrl,
        facebookUrl: candidate.facebookUrl,
        location: candidate.location,
        // Blank is a real answer — a lead whose zone nobody knows — so a zone
        // outside the four stores as null rather than defaulting.
        timeZone: isUsTimeZone(candidate.timeZone) ? candidate.timeZone : null,
        staffCountRaw: candidate.staffCountRaw,
        // The enrichment comes across as-is. It was gathered against this
        // clinic and re-gathering it on the lead would spend four actor runs
        // to arrive at the same four values.
        metaAdsSignal: candidate.metaAdsSignal,
        reviewCount: candidate.reviewCount,
        websiteNotes: candidate.websiteNotes,
        enrichedAt: candidate.enrichedAt,
        // The review count's own date. The candidate keeps one date for the
        // whole run, so this is the closest honest reading of when that number
        // was taken.
        reviewsCheckedAt:
          candidate.reviewCount === null ? null : candidate.enrichedAt,
        ...(breakdown ? leadScorecardPrefill(breakdown, now) : {}),
      },
      select: { id: true },
    });

    await tx.discoveryCandidate.update({
      where: { id: candidateId },
      data: {
        status: "PROMOTED",
        promotedLeadId: lead.id,
        processedAt: now,
      },
    });

    return lead.id;
  });
}
