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

// ─── The two chip groups ───────────────────────────────────────────────────
//
// Contact (who the email goes to): All, Owner, Front desk, Contact form — one
// at a time, All being none. Status (where it stands): Due today, Ready,
// Needs work, In sequence, Done, Lost — one at a time, or none. One of each
// can be active together: Owner + Needs work is the owner leads that need work.
//
// Every count is visibleRows() for that chip, beside whatever else is active —
// the other group's chip, the tiers, the inbox, the search — so a count is
// always exactly the list pressing it would show.

export type ContactChip = "all" | "owner" | "desk" | "form";
export type StatusChip = "due" | "ready" | "work" | "sequence" | "done" | "lost";
export interface Selection {
  contact: ContactChip;
  status: StatusChip | null;
}
export const NO_SELECTION: Selection = { contact: "all", status: null };

export const CONTACT_TABS: [ContactChip, string][] = [
  ["all", "All"],
  ["owner", "Owner"],
  ["desk", "Front desk"],
  ["form", "Contact form"],
];
export const STATUS_TABS: [StatusChip, string][] = [
  ["due", "Due today"],
  ["ready", "Ready"],
  ["work", "Needs work"],
  ["sequence", "In sequence"],
  ["done", "Done"],
  ["lost", "Lost"],
];

const isContact = (f: string): f is ContactChip => CONTACT_TABS.some(([k]) => k === f);
const isStatus = (f: string): f is StatusChip => STATUS_TABS.some(([k]) => k === f);

export interface ViewFilters {
  tiers: string[];
  inbox: string;
  query: string;
}

export interface VisibleRow extends FilterRow {
  clinicName: string;
  contactName: string | null;
  location: string | null;
  email: string | null;
  icpTier: string | null;
  inbox: string | null;
}

function chipMatch(row: VisibleRow, sel: Selection): boolean {
  // Lost leads are under Lost and nowhere else.
  if (isLost(row.stage) !== (sel.status === "lost")) return false;
  const c = sel.contact;
  if (c === "owner" && row.contactStatus !== "owner_email") return false;
  if (c === "desk" && row.contactStatus !== "front_desk") return false;
  if (c === "form" && row.contactStatus !== "contact_form") return false;
  if (sel.status && sel.status !== "lost" && !matchesFilter(row, sel.status)) return false;
  return true;
}

// The list: the chips, then the tiers, the inbox and the search. A search by
// name also finds a Lost lead whatever the status chip.
export function visibleRows<T extends VisibleRow>(rows: T[], sel: Selection, v: ViewFilters): T[] {
  const q = v.query.trim().toLowerCase();
  return rows.filter((r) => {
    const byName = q !== "" && isLost(r.stage) && r.clinicName.toLowerCase().includes(q);
    const chips = chipMatch(r, sel) || (byName && chipMatch(r, { ...sel, status: "lost" }));
    return (
      chips &&
      (v.tiers.length === 0 || (r.icpTier !== null && v.tiers.includes(r.icpTier))) &&
      (v.inbox === "" || r.inbox === v.inbox) &&
      (q === "" || [r.clinicName, r.contactName, r.location, r.email].some((x) => (x ?? "").toLowerCase().includes(q)))
    );
  });
}

// The selection a chip would make: it replaces its own group's chip and keeps
// the other group's. Pressing the active status chip again clears it.
export function pressChip(sel: Selection, chip: Filter): Selection {
  if (isContact(chip)) return { ...sel, contact: chip };
  if (isStatus(chip)) return { ...sel, status: sel.status === chip ? null : chip };
  return sel;
}

// What the chip's count shows: the rows it would list (its own group's chip
// replaced, never cleared, so the active chip counts what is shown now).
export function chipCount<T extends VisibleRow>(rows: T[], sel: Selection, chip: Filter, v: ViewFilters): number {
  const next = isContact(chip) ? { ...sel, contact: chip } : isStatus(chip) ? { ...sel, status: chip } : sel;
  return visibleRows(rows, next, v).length;
}

export function chipOn(sel: Selection, chip: Filter): boolean {
  return isContact(chip) ? sel.contact === chip : sel.status === chip;
}

// Remembered as "owner,work" (or one chip from a ?tab= link, or a list saved
// by the earlier multi-chip version): the first chip of each group wins.
export function readSelection(v: unknown): Selection | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const parts = v.split(",").map((x) => x.trim());
  const contact = parts.find(isContact) ?? null;
  const status = parts.find(isStatus) ?? null;
  if (!contact && !status) return null;
  return { contact: contact ?? "all", status };
}

export function writeSelection(sel: Selection): string {
  return [sel.contact, ...(sel.status ? [sel.status] : [])].join(",");
}
