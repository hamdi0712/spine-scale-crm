// The internal activity feed — what counts as an event, and how one reads.
//
// The list of kinds below is the whole contract: an event is logged when one
// of these six things happens to an engagement and at no other time. Routine
// field edits (renaming a clinic, fixing a phone number, moving a checklist
// item along) are not events. Keeping the list short is what makes the feed
// worth reading — a log of everything is a log of nothing.

export const ACTIVITY_KINDS = [
  "LEAD_CONVERTED",
  "REPORT_GENERATED",
  "CONTRACT_SIGNED",
  "INVOICE_PAID",
  "HEALTH_CHANGED",
  "ONBOARDING_COMPLETED",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

// Icon per kind, from the set in src/components/Icons.tsx.
export const ACTIVITY_ICONS: Record<ActivityKind, string> = {
  LEAD_CONVERTED: "clients",
  REPORT_GENERATED: "doc",
  CONTRACT_SIGNED: "signed",
  INVOICE_PAID: "dollar",
  HEALTH_CHANGED: "pulse",
  ONBOARDING_COMPLETED: "check",
};

export function activityIcon(kind: string): string {
  return ACTIVITY_ICONS[kind as ActivityKind] ?? "doc";
}

// ─── Relative timestamps ───────────────────────────────────────────────────

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// "just now" · "8m ago" · "2h ago" · "3d ago" · "5w ago"
export function fmtRelative(at: Date, now: Date = new Date()): string {
  const ms = now.getTime() - at.getTime();
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  const days = Math.floor(ms / DAY);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
