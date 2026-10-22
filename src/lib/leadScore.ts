// A lead's ICP tier and score, whichever model scored it.
//
// A lead can carry two scorecards: the old A–D answers in their own columns
// (src/lib/icp.ts), and the ICP model's breakdown on Lead.icpBreakdown
// (src/lib/icpScoring.ts). The new one wins wherever it exists — it is the
// card the lead page shows and edits — and a lead with only the old answers
// keeps exactly the tier they give it, so nothing already scored moves when
// the new model arrives.
//
// Every view that badges, filters or counts leads by tier reads it from here.
// The input type requires icpBreakdown, so a query that forgot to select it
// does not compile rather than quietly tiering a new-model lead on old answers.

import { ICP_MAX_SCORE, IcpAnswers, IcpTier, scoreIcp } from "@/lib/icp";
import { IcpBreakdownV2, isV2BreakdownJson, parseBreakdownV2 } from "@/lib/icpScoring";
import { V2_MAX_SCORE } from "@/lib/icpWeights";

export type LeadScoreInput = IcpAnswers & { icpBreakdown: string | null };

export interface LeadScore {
  model: "v1" | "v2";
  total: number;
  max: number;
  tier: IcpTier;
}

export function leadBreakdownV2(lead: { icpBreakdown: string | null }): IcpBreakdownV2 | null {
  return isV2BreakdownJson(lead.icpBreakdown) ? parseBreakdownV2(lead.icpBreakdown) : null;
}

export function leadScore(lead: LeadScoreInput): LeadScore | null {
  const v2 = leadBreakdownV2(lead);
  if (v2) return { model: "v2", total: v2.total, max: V2_MAX_SCORE, tier: v2.tier };
  // A clinic only carries a tier once it has actually been scored — an
  // untouched lead is "not scored", not a C-tier.
  if (!lead.icpScoredAt) return null;
  const old = scoreIcp(lead);
  return { model: "v1", total: old.total, max: ICP_MAX_SCORE, tier: old.tier };
}

export function leadTier(lead: LeadScoreInput): IcpTier | null {
  return leadScore(lead)?.tier ?? null;
}

// "72 of 100", "6 of 10", or null for a lead nobody has scored.
export function leadScoreText(lead: LeadScoreInput): string | null {
  const score = leadScore(lead);
  return score ? `${score.total} of ${score.max}` : null;
}

// When the new model rejected a clinic by a rule rather than by its score —
// chiro without a real program, or short of the fit floor — its tier is C
// whatever it scored, and "C-tier" beside 80/100 reads as a contradiction.
// This is what to show instead. Null for every other case, including a plain
// below-the-bar C and a disqualification (which has its own tier).
export function ruleVerdictLabel(b: IcpBreakdownV2 | null | undefined): string | null {
  if (!b || b.tier !== "C") return null;
  switch (b.verdict.kind) {
    case "chiro_no_program":
      return "Rejected: chiro without a real program";
    case "not_a_fit":
      return "Rejected: not a confirmed fit";
    case "insufficient_evidence":
      return "Not enough evidence";
    default:
      return null;
  }
}

export function leadRuleVerdict(lead: { icpBreakdown: string | null }): string | null {
  return ruleVerdictLabel(leadBreakdownV2(lead));
}

// The badge text for a rule rejection, score first: "80/100 · Rejected: chiro
// without a real program". Null when the tier badge should show as usual.
export function leadVerdictBadge(lead: LeadScoreInput): string | null {
  const verdict = leadRuleVerdict(lead);
  if (!verdict) return null;
  const score = leadScore(lead);
  return score ? `${score.total}/${score.max} · ${verdict}` : verdict;
}
