export const LEAD_STAGES = [
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATING",
  "WON",
  "LOST",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  DISCOVERY: "Discovery Call Booked",
  PROPOSAL: "Proposal Sent",
  NEGOTIATING: "Negotiating",
  WON: "Won",
  LOST: "Lost",
};

// Short forms for tight spaces — chart legends, mostly, where "Discovery Call
// Booked" would wrap or truncate.
export const LEAD_STAGE_SHORT_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  DISCOVERY: "Discovery",
  PROPOSAL: "Proposal",
  NEGOTIATING: "Negotiating",
  WON: "Won",
  LOST: "Lost",
};

// Stages that count toward open pipeline value.
export const OPEN_STAGES: LeadStage[] = [
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATING",
];

export const CLIENT_STATUSES = [
  "ONBOARDING",
  "ACTIVE",
  "PAUSED",
  "CHURNED",
] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  PAUSED: "Paused",
  CHURNED: "Churned",
};

// Shared so the confirmation reads the same from the client detail page and
// the clients table.
export function clientDeleteMessage(clinicName: string): string {
  return `Are you sure you want to delete ${clinicName}? This will also delete its checklist and weekly reporting history.`;
}

export const CHECKLIST_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "DONE"] as const;

export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

// Items that gate going live: no ads can responsibly run until each of these
// is done, so they carry the blocking flag and the dashboard lifts them above
// the rest of the checklist. Seeded onto new clients and toggleable per item
// afterwards — the flag lives on the row, not on the title, so renaming an
// item keeps it.
export const LAUNCH_BLOCKING_CHECKLIST: string[] = [
  "Funnel + embedded calendar built",
  "Speed-to-lead automation live",
  "Meta ad campaign launched",
  "Privacy policy published",
  "Cookie policy published",
  "Consent language present on all forms",
];

// Default delivery checklist seeded onto every new client. Editable per client.
export const DEFAULT_CHECKLIST: string[] = [
  "Funnel + embedded calendar built",
  "Speed-to-lead automation live",
  "Reminder sequence T-24h live",
  "Reminder sequence T-3h live",
  "Reminder sequence T-45m live",
  "No-show recovery sequence live",
  "Missed-call text-back live",
  "Post-visit review request flow live",
  "Meta ad campaign launched",
  "Privacy policy published",
  "Cookie policy published",
  "Consent language present on all forms",
  "Client reporting dashboard set up",
];

// The rows to create for a brand-new client's checklist, blocking flags and
// all. Used by both ways a client comes into existence — added by hand, or
// converted from a won lead.
export function seedChecklist(): {
  title: string;
  sortOrder: number;
  blocking: boolean;
}[] {
  return DEFAULT_CHECKLIST.map((title, i) => ({
    title,
    sortOrder: i,
    blocking: LAUNCH_BLOCKING_CHECKLIST.includes(title),
  }));
}

// ─── PHI / HIPAA approach ──────────────────────────────────────────────────
//
// Which of the two compliance postures an engagement runs under. Path A is the
// default: nothing the funnels or automations collect touches symptoms or
// conditions, so no PHI ever exists and no HIPAA add-on is required. Path B
// takes intake detail, which is PHI the moment it is collected — that needs the
// HIPAA add-on on the tooling and a signed BAA in place before launch, which is
// why choosing it puts HIPAA_CHECKLIST_ITEM on the client's checklist.
export const PHI_APPROACHES = ["PATH_A", "PATH_B"] as const;

export type PhiApproach = (typeof PHI_APPROACHES)[number];

export const PHI_APPROACH_LABELS: Record<PhiApproach, string> = {
  PATH_A: "Path A (symptom-agnostic)",
  PATH_B: "Path B (intake forms, requires HIPAA add-on + BAA)",
};

// Added to a client's checklist when they move to Path B, and matched on the
// title so switching back and forth never creates a second copy. It gates going
// live for the same reason the policy items do, so it is seeded blocking.
export const HIPAA_CHECKLIST_ITEM = "HIPAA add-on + signed BAA in place";

export const LIBRARY_CATEGORIES = [
  "AUTOMATION_FLOW_COPY",
  "AD_COPY",
  "ONBOARDING_EMAILS",
  "COMPLIANCE_TEMPLATES",
  "REPORTING_TEMPLATES",
] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export const LIBRARY_CATEGORY_LABELS: Record<LibraryCategory, string> = {
  AUTOMATION_FLOW_COPY: "Automation Flow Copy",
  AD_COPY: "Ad Copy",
  ONBOARDING_EMAILS: "Onboarding Emails",
  COMPLIANCE_TEMPLATES: "Compliance Templates",
  REPORTING_TEMPLATES: "Reporting Templates",
};
