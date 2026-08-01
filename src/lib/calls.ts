// Calls — the log of scheduled and held calls that hangs off a lead or a
// client. Statuses and types are strings constrained here, the same way lead
// stages and checklist statuses are constrained in src/lib/constants.ts.

export const CALL_TYPES = [
  "CHECK_IN",
  "DISCOVERY",
  "KICKOFF",
  "OTHER",
] as const;

export type CallType = (typeof CALL_TYPES)[number];

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  CHECK_IN: "Check-in",
  DISCOVERY: "Discovery",
  KICKOFF: "Kickoff",
  OTHER: "Other",
};

export function callTypeLabel(type: string): string {
  return CALL_TYPE_LABELS[type as CallType] ?? type;
}

export const CALL_STATUSES = [
  "SCHEDULED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
};

// How far ahead the dashboard looks, matching the follow-up window.
export const CALL_REMINDER_DAYS = 7;

export interface CallLike {
  scheduledAt: Date;
  status: string;
}

// A call still marked Scheduled once its time has passed is overdue — the same
// rule the dashboard already applies to a lead's next follow-up date.
export function isCallOverdue(call: CallLike, now: Date = new Date()): boolean {
  return call.status === "SCHEDULED" && call.scheduledAt < now;
}

// Splits a record's calls into the two lists its Calls section shows: what is
// still on the books (soonest first, so overdue ones surface at the top) and
// what has already been closed out one way or another (most recent first).
export function groupCalls<T extends CallLike>(calls: T[]) {
  const upcoming = calls
    .filter((c) => c.status === "SCHEDULED")
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const logged = calls
    .filter((c) => c.status !== "SCHEDULED")
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
  return { upcoming, logged };
}
