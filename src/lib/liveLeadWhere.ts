// The lead filters behind the live views and counts, in one place so a lead
// flagged "Rejected by new scoring" drops out of every one of them together
// — and comes back to every one together when the flag is cleared on revert.
//
// Daily KPI history is not read through these: past days stay as they were.

import { CONTACTED_STAGES, OPEN_STAGES } from "@/lib/constants";

export const NOT_SCORING_REJECTED = { scoringRejectedAt: null } as const;

// Dashboard: Qualified leads, Pipeline value and Today's Focus.
export const OPEN_LEADS_WHERE = {
  archived: false,
  stage: { in: [...OPEN_STAGES] },
  ...NOT_SCORING_REJECTED,
};

// Dashboard: Messages sent (leads at Contacted or past it, archived included).
export const CONTACTED_LEADS_WHERE = {
  stage: { in: [...CONTACTED_STAGES] },
  ...NOT_SCORING_REJECTED,
};

// Outreach Queue.
export const OUTREACH_QUEUE_WHERE = {
  archived: false,
  stage: "NEW",
  ...NOT_SCORING_REJECTED,
};

// Pipeline: the default view, and the filter that finds the flagged ones.
export const PIPELINE_DEFAULT_WHERE = { archived: false, ...NOT_SCORING_REJECTED };
export const PIPELINE_SCORING_REJECTED_WHERE = { archived: false, scoringRejectedAt: { not: null } };
