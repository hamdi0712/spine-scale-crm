// The Email view's filter chips and what the view remembers between visits.
// Pure; read by src/components/EmailLeadTable.tsx and the verify scripts.

import type { EmailLeadStatus } from "@/lib/emailChannel";

// Owner and Front desk are where the contact finder routed the lead
// (contactStatus). The rest group the email statuses by what the work is.
export type Filter = "all" | "owner" | "desk" | "form" | "due" | "ready" | "work" | "sequence" | "done" | "lost";

export const FILTER_TABS: [Filter, string][] = [
  ["all", "All"],
  ["owner", "Owner"],
  ["desk", "Front desk"],
  ["form", "Contact form"],
  ["due", "Due today"],
  ["ready", "Ready"],
  ["work", "Needs work"],
  ["sequence", "In sequence"],
  ["done", "Done"],
  ["lost", "Lost"],
];

const FILTERS = FILTER_TABS.map(([f]) => f);

// A remembered or linked chip that no longer exists (Has email, No email,
// Risky) reads as nothing, and the view falls back to its default.
export function readFilter(v: unknown): Filter | null {
  return (FILTERS as unknown[]).includes(v) ? (v as Filter) : null;
}

const FILTER_STATUSES: Record<"ready" | "form" | "work" | "sequence" | "done", EmailLeadStatus[]> = {
  ready: ["ready"],
  form: ["contact_form", "form_sent"],
  work: ["needs_opener", "needs_manual_opener", "check_email", "check_contact", "check_clinic_name", "no_email"],
  sequence: ["in_sequence"],
  done: ["replied", "stopped", "not_ab"],
};

export interface FilterRow {
  status: EmailLeadStatus;
  stage: string;
  followUpDueToday: boolean;
  contactStatus: string | null;
}

export const isLost = (stage: string) => stage === "LOST";

// Lost leads are in the Lost chip and no other: every other chip, and its
// count, leaves them out.
export function matchesFilter(row: FilterRow, filter: Filter): boolean {
  if (filter === "lost") return isLost(row.stage);
  if (isLost(row.stage)) return false;
  if (filter === "all") return true;
  if (filter === "due") return row.followUpDueToday;
  if (filter === "owner") return row.contactStatus === "owner_email";
  if (filter === "desk") return row.contactStatus === "front_desk";
  return FILTER_STATUSES[filter].includes(row.status);
}

// ─── Remembered between visits ─────────────────────────────────────────────
//
// The tiers, the sort, the search and the inbox, kept for the browser tab
// (sessionStorage) so coming back from a lead's page finds the view as it was.
// The chip has its own cookie (rememberPipelineFilter); a ?tab= link wins.

export const VIEW_STATE_KEY = "pipeline-email-state";
export type Sort = "updated" | "score" | "name";

export interface ViewState {
  tiers: string[];
  sort: Sort;
  query: string;
  inbox: string;
}

export function serializeViewState(s: ViewState): string {
  return JSON.stringify(s);
}

export function parseViewState(raw: string | null | undefined): ViewState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ViewState>;
    return {
      tiers: Array.isArray(v.tiers) ? v.tiers.filter((t): t is string => t === "A" || t === "B" || t === "C") : [],
      sort: v.sort === "score" || v.sort === "name" ? v.sort : "updated",
      query: typeof v.query === "string" ? v.query.slice(0, 200) : "",
      inbox: typeof v.inbox === "string" ? v.inbox : "",
    };
  } catch {
    return null;
  }
}
