// The one rule for writing a lead's stage.
//
// stageChangedAt is a record of when a lead actually moved, and it is only
// worth anything if nothing else can move it. That is a rule about writes
// rather than about the column, and a rule about writes has to live in one
// place or it is not a rule — there are five paths that set a stage (the
// detail form, the board's drag, the table's bulk move, conversion to a
// client, and promotion out of Discovery), and four of them would each have
// had to remember it.
//
// So every write of stage goes through here. The shape is deliberately a
// patch rather than a mutation: it returns the fields to write and touches
// nothing, which is what lets it be spread into an update that is also
// writing a dozen unrelated fields — the detail form's save, where the stage
// may or may not be part of what changed.
//
// Server-only by convention, like src/lib/dailyKpiStore.ts: it is pure, but
// it belongs to the write path and nothing in the browser has a reason for it.

import { LEAD_STAGES, LeadStage } from "@/lib/constants";

export function isLeadStage(value: unknown): value is LeadStage {
  return typeof value === "string" && LEAD_STAGES.includes(value as LeadStage);
}

// What to write for a stage that may or may not be a move.
//
// `next` is the stage being saved and `current` the one already stored. Three
// answers, and the middle one is the whole point of the module:
//
//   - not a stage at all → {}, so a form that posted junk changes nothing
//   - the same stage → { stage } and no timestamp, so re-saving a lead at
//     Contacted with a new phone number leaves its move where it was
//   - a different stage → both, stamped now
//
// The stage is written back even when it has not changed. It is a no-op
// against the row and it keeps the caller honest: the patch is the whole
// answer to "what does saving this stage mean", not half of it.
export function stageChangePatch(
  next: unknown,
  current: string,
  now: Date = new Date(),
): { stage?: LeadStage; stageChangedAt?: Date } {
  if (!isLeadStage(next)) return {};
  if (next === current) return { stage: next };
  return { stage: next, stageChangedAt: now };
}
