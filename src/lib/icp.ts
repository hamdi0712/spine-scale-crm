// ICP scorecard — the Spine Scale Clinic Qualification Scorecard in one place.
//
// Layer 1 is a set of hard disqualifiers: any single "yes" stops the
// evaluation ("any yes = STOP"). A clinic that clears Layer 1 scores out of 10
// across four categories, and the total maps to an A/B/C tier band.
//
//   A. Staff Size Fit ............ 0–2
//   B. Package / Consult Economics 0–3
//   C. Budget Signal ............. 0–2
//   D. Automation Gap ............ 0–3 (one point per gap found)
//                                  ────
//                                    10
//
// All copy below is the framework text verbatim. Total and tier are always
// derived from the stored answers — never persisted — so editing the bands
// below re-tiers every clinic without a migration.

// The rule that governs the whole exercise, shown above the card.
export const ICP_SCORING_RULE =
  "Score first, decide second. Do not adjust a category's meaning to justify a clinic you already like.";

// ─── Layer 1: hard disqualifiers ───────────────────────────────────────────

export const ICP_DISQUALIFIER_KEYS = [
  "icpDqSurgicalPractice",
  "icpDqSoloNoStaff",
  "icpDqFranchiseLocked",
  "icpDqSystemComplete",
  "icpDqOutOfRegion",
] as const;

export type IcpDisqualifierKey = (typeof ICP_DISQUALIFIER_KEYS)[number];

export interface IcpDisqualifier {
  key: IcpDisqualifierKey;
  label: string;
  signal?: string;
}

export const ICP_DISQUALIFIER_RULE =
  "Any single yes = STOP. Do not proceed to scoring. This clinic is not a fit right now regardless of how it would score below.";

export const ICP_DISQUALIFIERS: IcpDisqualifier[] = [
  {
    key: "icpDqSurgicalPractice",
    label: "Primarily a surgical practice / surgeons",
    signal: "Not a non-surgical, conservative-care model.",
  },
  {
    key: "icpDqSoloNoStaff",
    label: "Solo practitioner with no support staff",
    signal:
      "No one to execute intake, fulfillment, or follow-through on your systems.",
  },
  {
    key: "icpDqFranchiseLocked",
    label:
      "Franchise or corporate-owned location locked into a national marketing contract",
    signal: "Can't independently hire an agency.",
  },
  {
    key: "icpDqSystemComplete",
    label: "Already has a complete, working system live",
    signal:
      "Paid ads AND booking automation AND no-show/review systems all functioning — with no visible gap.",
  },
  {
    key: "icpDqOutOfRegion",
    label:
      "Outside your serviceable language, time zone, or legal/regulatory region",
  },
];

// ─── Layer 2, A–C: scored option groups ────────────────────────────────────

export interface IcpScoreOption {
  points: number;
  label: string;
  signal?: string;
}

export interface IcpCategory {
  key: IcpCategoryKey;
  letter: string;
  title: string;
  max: number;
  guidance: string; // where to look, from the research protocol
  note?: string; // scoring caveat called out by the framework
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
    guidance:
      "Check: “Meet the Team” page, Google Business Profile staff photos, LinkedIn company page.",
    options: [
      { points: 2, label: "3–15 total staff (clinical + admin)" },
      { points: 1, label: "Borderline — 2 staff, or 16–20" },
      { points: 0, label: "1 staff, or 20+ / large multi-location group" },
    ],
  },
  {
    key: "icpPackageEconomics",
    letter: "B",
    title: "Package / Consult Economics",
    max: 3,
    guidance:
      "Highest weight — the strongest signal that they can afford and will value your retainer. Check: services/pricing page, “programs” or “plans” language.",
    options: [
      {
        points: 3,
        label:
          "Explicit named treatment program with visible or inquire-for pricing",
        signal: "e.g. “12-Week Non-Surgical Spine Program”.",
      },
      {
        points: 2,
        label:
          "Language implies a package/plan structure but no clear name or pricing",
        signal: "“Treatment plans,” “care packages.”",
      },
      {
        points: 1,
        label: "Only itemized per-visit services, no package framing at all",
        signal: "Single adjustments, single PT sessions.",
      },
      {
        points: 0,
        label: "Pure insurance-billed, no cash-pay component visible anywhere",
      },
    ],
  },
  {
    key: "icpBudgetSignal",
    letter: "C",
    title: "Budget Signal — Ad Spend or Ad Capacity",
    max: 2,
    guidance:
      "Check: Meta Ad Library (facebook.com/ads/library), years established, number of locations, review velocity.",
    note: "No visible ads is not automatically bad — it can mean “no incumbent vendor to displace.” Only score 0 if there's also no evidence of capacity to spend.",
    options: [
      {
        points: 2,
        label:
          "Active or recent ads found in Meta Ad Library or visible Google Ads",
      },
      {
        points: 1,
        label: "No active ads currently, but capacity signals present",
        signal:
          "Multiple locations, 5+ years established, premium package pricing, steady recent review velocity implying healthy patient volume.",
      },
      {
        points: 0,
        label: "No ad evidence AND no capacity signals",
        signal: "Small, new, thin/stale reviews.",
      },
    ],
  },
];

// A raw headcount read onto category A's bands, for leads imported with a
// staff count attached (src/lib/leadImport.ts). It is only ever a suggestion:
// the scorecard pre-selects it, and nothing is stored until someone opens the
// card and saves it — scoring is a decision, not a side effect of an import.
//
// 16–20 is read as the borderline band, so a clinic on exactly 20 scores 1
// rather than falling into "20+".
export function suggestedStaffSizeScore(
  staff: number | null | undefined,
): number | null {
  if (staff == null || !Number.isFinite(staff) || staff < 1) return null;
  if (staff >= 3 && staff <= 15) return 2;
  if (staff === 2 || (staff >= 16 && staff <= 20)) return 1;
  return 0; // a single-hand operation, or a group too big for the model
}

// ─── Layer 2, D: automation gaps (one point each) ──────────────────────────

export const ICP_GAP_KEYS = [
  "icpGapBooking",
  "icpGapReviews",
  "icpGapRemarketing",
] as const;

export type IcpGapKey = (typeof ICP_GAP_KEYS)[number];

export interface IcpGap {
  key: IcpGapKey;
  label: string;
  signal?: string;
}

export const ICP_GAP_MAX = ICP_GAP_KEYS.length;

export const ICP_GAP_GUIDANCE =
  "Inverted — more gaps = better fit. Check one point for each gap present, max 3. This is the space Spine Scale exists to fill.";

export const ICP_GAPS: IcpGap[] = [
  {
    key: "icpGapBooking",
    label: "No real-time online booking widget",
    signal: "Phone-only, or a plain contact form.",
  },
  {
    key: "icpGapReviews",
    label: "No visible automated review-request pattern",
    signal:
      "Review count/velocity doesn't match years in business or apparent patient volume.",
  },
  {
    key: "icpGapRemarketing",
    label: "No visible follow-up/remarketing evidence",
    signal:
      "No retargeting pixel/tag detectable, no recurring “book your consult” ad creative, front-desk phone call is the only path to booking.",
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

// What to do with a clinic once it lands in a tier. Disqualified has no
// action — the Layer 1 banner already says not to proceed.
export const ICP_TIER_ACTIONS: Record<IcpTier, string | null> = {
  A: "Pursue now — prioritize outreach this week",
  B: "Warm list — revisit in 30–60 days or if a warm intro surfaces",
  C: "Deprioritize — do not spend outreach time on this one now",
  DISQUALIFIED: null,
};

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

// A clinic only carries a tier once it has actually been scored — an untouched
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
