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

// ─── More than one chip ────────────────────────────────────────────────────
//
// Chips come in two groups: who the email goes to (Owner, Front desk) and
// where it stands (Contact form, Due today, Ready, Needs work, In sequence,
// Done, Lost). Picked from different groups they narrow each other — Owner +
// Needs work is the owner leads that need work. Picked from the same group
// either will do — Ready + Due today is both. All (or nothing) is every lead.

export type FilterGroup = "who" | "what";
export function filterGroup(f: Filter): FilterGroup | null {
  if (f === "all") return null;
  return f === "owner" || f === "desk" ? "who" : "what";
}

export function matchesSelection(row: FilterRow, sel: Filter[]): boolean {
  const picked = sel.filter((f) => f !== "all");
  if (picked.length === 0) return matchesFilter(row, "all");
  const who = picked.filter((f) => filterGroup(f) === "who");
  const what = picked.filter((f) => filterGroup(f) === "what");
  // Lost leads show only when Lost is picked (matchesFilter leaves them out of every other chip).
  if (isLost(row.stage) && !what.includes("lost")) return false;
  const whoOk = who.length === 0 || who.some((f) => matchesFilter({ ...row, stage: "NEW" }, f));
  const whatOk = what.length === 0 || what.some((f) => matchesFilter(row, f));
  return whoOk && whatOk;
}

// A chip pressed: All clears the rest; any other is added or taken away.
export function toggleFilter(sel: Filter[], f: Filter): Filter[] {
  if (f === "all") return [];
  return sel.includes(f) ? sel.filter((x) => x !== f) : [...sel.filter((x) => x !== "all"), f];
}

// What a chip's count shows: the leads it would show beside the chips
// already picked in the other group.
export function chipCount(rows: FilterRow[], sel: Filter[], f: Filter): number {
  const g = filterGroup(f);
  const base = g === null ? [] : [...sel.filter((x) => x !== "all" && filterGroup(x) !== g), f];
  return rows.filter((r) => matchesSelection(r, base)).length;
}

// "owner,work" ↔ ["owner", "work"]; unknown chips dropped.
export function readSelection(v: unknown): Filter[] | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const out = v.split(",").map(readFilter).filter((f): f is Filter => f !== null && f !== "all");
  return v.split(",").includes("all") ? [] : out.length > 0 ? Array.from(new Set(out)) : null;
}
