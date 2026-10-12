// Reading what Compare scoring compares, and what it found.
//
// Server-only and not a "use server" module: the compare page reads it to
// quote its estimate and draw its results, and the comparison actions read it
// to score one record at a time. Neither should be an endpoint the browser can
// call with a record list of its own.

import { prisma } from "@/lib/prisma";
import { IcpTier } from "@/lib/icp";
import { leadScore } from "@/lib/leadScore";
import { maxScoreFor, readScoringModel } from "@/lib/storedBreakdown";
import {
  ComparisonSubject,
  OldStanding,
  SubjectKind,
  storedEvidence,
} from "@/lib/scoringComparison";
import { ScoringEvidence } from "@/lib/icpScoring";

export interface LoadedSubject extends ComparisonSubject {
  evidence: ScoringEvidence;
  old: OldStanding;
}

const EVIDENCE_SELECT = {
  id: true,
  clinicName: true,
  websiteUrl: true,
  websiteNotes: true,
  websiteLinks: true,
  metaAdsSignal: true,
  reviewCount: true,
  staffCountRaw: true,
  location: true,
  contactName: true,
  contactTitle: true,
} as const;

// Promoted and Rejected candidates, and open leads that never came through
// Discovery. A lead that was promoted from a candidate is compared once, as
// that candidate — it is the same clinic on the same evidence.
const CANDIDATE_WHERE = { status: { in: ["PROMOTED", "REJECTED"] } };
const LEAD_WHERE = { archived: false, candidate: { is: null } };

function candidateStanding(c: {
  status: string;
  icpTotal: number | null;
  icpTier: string | null;
  scoringModel: string | null;
  disqualifiedReason: string | null;
}): OldStanding {
  const promoted = c.status === "PROMOTED";
  const model = readScoringModel(c.scoringModel);
  return {
    status: promoted ? "PROMOTED" : "REJECTED",
    label: `${promoted ? "Promoted" : "Rejected"}${model === "v2" ? " (ICP model)" : ""}`,
    score: c.icpTotal,
    max: c.icpTotal === null ? null : maxScoreFor(model),
    tier: (c.icpTier as IcpTier | null) ?? null,
    reason: promoted ? null : c.disqualifiedReason,
  };
}

function leadStanding(lead: Parameters<typeof leadScore>[0]): OldStanding {
  const score = leadScore(lead);
  return {
    status: "PROMOTED",
    label: score ? `In the pipeline (${score.tier === "DISQUALIFIED" ? "disqualified" : `${score.tier}-tier`})` : "In the pipeline (unscored)",
    score: score?.total ?? null,
    max: score?.max ?? null,
    tier: score?.tier ?? null,
    reason: null,
  };
}

const LEAD_SCORE_SELECT = {
  icpScoredAt: true,
  icpBreakdown: true,
  icpDqSurgicalPractice: true,
  icpDqSoloNoStaff: true,
  icpDqFranchiseLocked: true,
  icpDqSystemComplete: true,
  icpDqOutOfRegion: true,
  icpStaffSize: true,
  icpPackageEconomics: true,
  icpBudgetSignal: true,
  icpGapBooking: true,
  icpGapReviews: true,
  icpGapRemarketing: true,
} as const;

export async function loadComparisonSubjects(): Promise<LoadedSubject[]> {
  const [candidates, leads] = await Promise.all([
    prisma.discoveryCandidate.findMany({
      where: CANDIDATE_WHERE,
      orderBy: { createdAt: "asc" },
      select: {
        ...EVIDENCE_SELECT,
        status: true,
        icpTotal: true,
        icpTier: true,
        scoringModel: true,
        disqualifiedReason: true,
      },
    }),
    prisma.lead.findMany({
      where: LEAD_WHERE,
      orderBy: { createdAt: "asc" },
      select: { ...EVIDENCE_SELECT, ...LEAD_SCORE_SELECT },
    }),
  ]);
  return [
    ...candidates.map((c) => ({
      kind: "candidate" as const,
      id: c.id,
      clinicName: c.clinicName,
      evidence: storedEvidence(c),
      old: candidateStanding(c),
    })),
    ...leads.map((l) => ({
      kind: "lead" as const,
      id: l.id,
      clinicName: l.clinicName,
      evidence: storedEvidence(l),
      old: leadStanding(l),
    })),
  ];
}

// One subject, re-read and re-checked against the scope — an id from the
// browser is only ever matched against a record that belongs in the run.
export async function loadComparisonSubject(
  kind: SubjectKind,
  id: string,
): Promise<LoadedSubject | null> {
  if (kind === "candidate") {
    const c = await prisma.discoveryCandidate.findFirst({
      where: { id, ...CANDIDATE_WHERE },
      select: {
        ...EVIDENCE_SELECT,
        status: true,
        icpTotal: true,
        icpTier: true,
        scoringModel: true,
        disqualifiedReason: true,
      },
    });
    return c
      ? { kind, id: c.id, clinicName: c.clinicName, evidence: storedEvidence(c), old: candidateStanding(c) }
      : null;
  }
  const l = await prisma.lead.findFirst({
    where: { id, ...LEAD_WHERE },
    select: { ...EVIDENCE_SELECT, ...LEAD_SCORE_SELECT },
  });
  return l
    ? { kind, id: l.id, clinicName: l.clinicName, evidence: storedEvidence(l), old: leadStanding(l) }
    : null;
}

export async function latestComparisonRun() {
  return prisma.scoringComparisonRun.findFirst({
    orderBy: { startedAt: "desc" },
    include: { rows: { orderBy: { clinicName: "asc" } } },
  });
}

export async function hasCompletedComparison(): Promise<boolean> {
  const run = await prisma.scoringComparisonRun.findFirst({
    where: { completedAt: { not: null } },
    select: { id: true },
  });
  return run !== null;
}
