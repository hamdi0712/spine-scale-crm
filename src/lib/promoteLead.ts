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

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DiscoveryBreakdown, leadScorecardPrefill } from "@/lib/discovery";
import { IcpBreakdownV2, serializeBreakdownV2 } from "@/lib/icpScoring";
import { isUsTimeZone } from "@/lib/timezones";
import { repickMapsEmails } from "@/lib/emailFind";
import { TALKING_ON_LINKEDIN_BLOCK, readLeadChannel } from "@/lib/emailChannel";

// The stage a promoted candidate's lead starts at. An import is the top of the
// funnel by definition, and passing through Discovery does not advance it —
// scoring says whether to talk to a clinic, not that anybody has.
export const PROMOTED_LEAD_STAGE = "NEW";

export class TalkingOnLinkedinError extends Error {
  constructor(clinicName: string) {
    super(`${clinicName}: ${TALKING_ON_LINKEDIN_BLOCK}`);
    this.name = "TalkingOnLinkedinError";
  }
}

// Creates the lead and marks the candidate promoted, in one transaction: a
// lead with no candidate pointing at it would be re-created by the next run of
// the queue, and a candidate pointing at a lead that was never written would
// be worse.
//
// A breakdown of null is the honest case where a candidate is promoted before
// it was ever scored — the lead is created with its fields and an unscored
// card, which is exactly what it is.
//
// Which card the lead gets follows which model scored the candidate. An old
// breakdown fills the old answer columns, as it always did; a new-model one
// is stored whole on Lead.icpBreakdown and fills none of them, so the lead's
// card opens on the Fit / Signals view with every citation the run made.
export async function promoteToLead(
  candidateId: string,
  breakdown: DiscoveryBreakdown | IcpBreakdownV2 | null,
  now: Date,
): Promise<string> {
  return prisma.$transaction((tx) => promoteWithin(tx, candidateId, breakdown, now));
}

// The same promotion inside a transaction somebody else opened — the apply in
// src/lib/scoringApplication.ts, which promotes many candidates and snapshots
// them in one transaction.
export async function promoteWithin(
  tx: Prisma.TransactionClient,
  candidateId: string,
  breakdown: DiscoveryBreakdown | IcpBreakdownV2 | null,
  now: Date,
): Promise<string> {
  {
    const candidate = await tx.discoveryCandidate.findUniqueOrThrow({
      where: { id: candidateId },
    });
    // The backstop behind every promotion path: a clinic already talking to
    // us on LinkedIn is never put into the email pipeline. Each path skips
    // these before it gets here; this makes sure none can.
    if (candidate.linkedinConflictLeadId !== null) {
      throw new TalkingOnLinkedinError(candidate.clinicName);
    }

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
        // The email and what is known about it. Addresses the Maps search
        // found are ranked again against whoever the candidate now names, so
        // an owner's address found before the owner was is labelled theirs.
        ...repickMapsEmails(candidate),
        leadSource: candidate.source,
        // Onto the candidate's own channel and no other: an email candidate
        // becomes an email lead, everything else a LinkedIn one. Not how it
        // was found — a Clinic-first candidate from before Discovery had
        // channels is a LinkedIn candidate and promotes as one.
        channel: readLeadChannel(candidate.channel) === "email" ? "email" : "linkedin",
        stage: PROMOTED_LEAD_STAGE,
        // Stamped with the promotion's own instant rather than left to the
        // column's now() default, so the lead, its scorecard and the
        // candidate it came from all carry the one time this transaction
        // happened. A lead created at a stage reached it by being made at it,
        // which is a stage change like any other.
        stageChangedAt: now,
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
        websiteLinks: candidate.websiteLinks,
        enrichedAt: candidate.enrichedAt,
        // The review count's own date. The candidate keeps one date for the
        // whole run, so this is the closest honest reading of when that number
        // was taken.
        reviewsCheckedAt:
          candidate.reviewCount === null ? null : candidate.enrichedAt,
        ...(breakdown === null
          ? {}
          : "model" in breakdown && breakdown.model === "v2"
            ? {
                icpBreakdown: serializeBreakdownV2(breakdown),
                icpBreakdownAt: now,
              }
            : leadScorecardPrefill(breakdown as DiscoveryBreakdown, now)),
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
  }
}
