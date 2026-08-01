// ICP scorecard — the lead qualification framework in one place.
//
// Layer 1 is a set of hard disqualifiers: any single "yes" stops the
// evaluation ("any yes = STOP"). A lead that clears Layer 1 scores out of 10
// across four categories, and the total maps to an A/B/C tier band.
//
//   A. Staff Size Fit .... 0–2
//   B. Package/Economics . 0–3
//   C. Budget Signal ..... 0–2
//   D. Automation Gap .... 0–3 (one point per gap found)
//                          ────
//                            10
//
// Total and tier are always derived from the stored answers — never persisted
// — so editing the bands below re-tiers every lead without a migration.

// ─── Layer 1: disqualifiers ────────────────────────────────────────────────

export const ICP_DISQUALIFIER_KEYS = [
  "icpDqNotDecisionMaker",
  "icpDqInsuranceOnly",
  "icpDqNoAdBudget",
  "icpDqAgencyLocked",
  "icpDqReputationRisk",
] as const;

export type IcpDisqualifierKey = (typeof ICP_DISQUALIFIER_KEYS)[number];

export interface IcpDisqualifier {
  key: IcpDisqualifierKey;
  label: string;
  signal: string;
}

export const ICP_DISQUALIFIERS: IcpDisqualifier[] = [
  {
    key: "icpDqNotDecisionMaker",
    label: "Not the decision-maker",
    signal:
      "The contact cannot sign — the owner is not in the conversation and will not be brought in.",
  },
  {
    key: "icpDqInsuranceOnly",
    label: "Insurance-only practice",
    signal:
      "No cash care plans of any kind. Every visit is billed to insurance, so there is no margin to fund acquisition.",
  },
  {
    key: "icpDqNoAdBudget",
    label: "No ad budget on top of retainer",
    signal:
      "Cannot fund monthly media spend in addition to the retainer, or expects the retainer to cover ad spend.",
  },
  {
    key: "icpDqAgencyLocked",
    label: "Locked into another agency",
    signal:
      "Under an active contract with a competing marketing agency, with no exit inside the sales cycle.",
  },
  {
    key: "icpDqReputationRisk",
    label: "Reputation or compliance risk",
    signal:
      "Sub-3.5 star average, an unresolved licensing or compliance issue, or anything that makes paid traffic unsafe to send.",
  },
];

// ─── Layers A–C: scored option groups ──────────────────────────────────────

export interface IcpScoreOption {
  points: number;
  label: string;
  signal: string;
}

export interface IcpCategory {
  key: IcpCategoryKey;
  letter: string;
  title: string;
  max: number;
  options: IcpScoreOption[];
}

export const ICP_CATEGORY_KEYS = [
  "icpStaffSize",
  "icpPackageEconomics",
  "icpBudgetSignal",
] as const;

export type IcpCategoryKey = (typeof ICP_CATEGORY_KEYS)[number];

export const ICP_CATEGORIES: IcpCategory[] = [
  {
    key: "icpStaffSize",
    letter: "A",
    title: "Staff Size Fit",
    max: 2,
    options: [
      {
        points: 2,
        label: "4+ staff or multi-provider",
        signal:
          "A dedicated front desk that can absorb inbound lead volume without the provider leaving the table.",
      },
      {
        points: 1,
        label: "2–3 staff",
        signal:
          "One provider plus front-desk support — can handle new leads, but speed-to-lead needs automation to hold up.",
      },
      {
        points: 0,
        label: "Solo operator, no front desk",
        signal:
          "The provider answers the phone between adjustments. Lead volume will be dropped no matter what we send.",
      },
    ],
  },
  {
    key: "icpPackageEconomics",
    letter: "B",
    title: "Package / Economics",
    max: 3,
    options: [
      {
        points: 3,
        label: "Care plans $2,500+",
        signal:
          "Packaged care plans priced high enough that a single conversion pays back a month of ad spend.",
      },
      {
        points: 2,
        label: "Care plans $1,200–$2,500",
        signal:
          "A real packaged offer with workable margin — profitable at target CPL, sensitive to show rate.",
      },
      {
        points: 1,
        label: "Under $1,200, or visit-by-visit cash",
        signal:
          "Cash pricing exists but is not packaged. Payback needs volume, so the margin is thin.",
      },
      {
        points: 0,
        label: "No packaged cash offer",
        signal:
          "Nothing to sell beyond individual insurance-rate visits. Economics do not support paid acquisition.",
      },
    ],
  },
  {
    key: "icpBudgetSignal",
    letter: "C",
    title: "Budget Signal",
    max: 2,
    options: [
      {
        points: 2,
        label: "Actively spending $2k+/mo on ads",
        signal:
          "Already committed to paid acquisition — the conversation is about performance, not about whether to spend.",
      },
      {
        points: 1,
        label: "Has spent before, currently paused or small",
        signal:
          "Prior marketing spend with a named budget. Understands the model but needs a reason to restart.",
      },
      {
        points: 0,
        label: "Never spent, no budget named",
        signal:
          "No paid acquisition history and no number on the table. Every objection will be a budget objection.",
      },
    ],
  },
];

// ─── Layer D: automation gaps (one point each) ─────────────────────────────

export const ICP_GAP_KEYS = [
  "icpGapBooking",
  "icpGapReviews",
  "icpGapRemarketing",
] as const;

export type IcpGapKey = (typeof ICP_GAP_KEYS)[number];

export interface IcpGap {
  key: IcpGapKey;
  label: string;
  signal: string;
}

export const ICP_GAP_MAX = ICP_GAP_KEYS.length;

export const ICP_GAPS: IcpGap[] = [
  {
    key: "icpGapBooking",
    label: "No booking widget",
    signal:
      "No online scheduler on the site — booking depends on someone picking up the phone during office hours.",
  },
  {
    key: "icpGapReviews",
    label: "Thin or stale review pattern",
    signal:
      "Few reviews, or the most recent cluster is months old — no post-visit request flow is running.",
  },
  {
    key: "icpGapRemarketing",
    label: "No remarketing running",
    signal:
      "No pixel-based retargeting or database reactivation — past traffic and dormant patients are never touched again.",
  },
];

export const ICP_MAX_SCORE =
  ICP_CATEGORIES.reduce((sum, c) => sum + c.max, 0) + ICP_GAP_MAX;

// ─── Tiers ─────────────────────────────────────────────────────────────────

export type IcpTier = "A" | "B" | "C" | "DISQUALIFIED";

export const ICP_TIER_LABELS: Record<IcpTier, string> = {
  A: "A-tier",
  B: "B-tier",
  C: "C-tier",
  DISQUALIFIED: "Disqualified",
};

// Best first, so ascending sorts read A → B → C → Disqualified → unscored.
export const ICP_TIER_ORDER: IcpTier[] = ["A", "B", "C", "DISQUALIFIED"];

// 8–10 A-tier · 5–7 B-tier · 0–4 C-tier.
export function tierForScore(total: number): IcpTier {
  if (total >= 8) return "A";
  if (total >= 5) return "B";
  return "C";
}

// Shown under the running total. Kept beside tierForScore so the bands are
// described in exactly one place.
export const ICP_TIER_BANDS = "8–10 A-tier · 5–7 B-tier · 0–4 C-tier";

// ─── Scoring ───────────────────────────────────────────────────────────────

// Every field the scorecard reads. Accepts the Prisma Lead row as-is.
export type IcpAnswers = Record<IcpDisqualifierKey, boolean> &
  Record<IcpGapKey, boolean> &
  Record<IcpCategoryKey, number | null> & {
    icpScoredAt?: Date | string | null;
  };

export interface IcpResult {
  disqualified: boolean;
  triggered: IcpDisqualifier[];
  categoryTotal: number;
  gapTotal: number;
  total: number;
  tier: IcpTier;
}

export function scoreIcp(answers: IcpAnswers): IcpResult {
  const triggered = ICP_DISQUALIFIERS.filter((d) => answers[d.key]);
  const categoryTotal = ICP_CATEGORIES.reduce(
    (sum, c) => sum + clampPoints(c, answers[c.key]),
    0,
  );
  const gapTotal = ICP_GAP_KEYS.filter((k) => answers[k]).length;
  const total = categoryTotal + gapTotal;
  return {
    disqualified: triggered.length > 0,
    triggered,
    categoryTotal,
    gapTotal,
    total,
    tier: triggered.length > 0 ? "DISQUALIFIED" : tierForScore(total),
  };
}

// A lead only carries a tier once it has actually been scored — an untouched
// lead is "not scored", not a C-tier.
export function leadTier(answers: IcpAnswers): IcpTier | null {
  if (!answers.icpScoredAt) return null;
  return scoreIcp(answers).tier;
}

// Guards against out-of-range values reaching the total (bad form post, or a
// category whose options changed after leads were scored).
function clampPoints(category: IcpCategory, value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return category.options.some((o) => o.points === value)
    ? value
    : Math.min(Math.max(Math.round(value), 0), category.max);
}

// The stored "which disqualifier triggered" summary, kept in sync on save.
export function triggeredSummary(answers: IcpAnswers): string | null {
  const triggered = ICP_DISQUALIFIERS.filter((d) => answers[d.key]);
  return triggered.length === 0
    ? null
    : triggered.map((d) => d.label).join(", ");
}
