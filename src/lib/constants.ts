// The pipeline in order, with the one stage that is not part of it on the end.
//
// No Contact is a holding status, not an outcome. A lead lands in it when
// there is no way to reach anybody — no email, no LinkedIn, no phone — which
// is a fact about what we know rather than a decision about the clinic. It is
// deliberately not Lost: Lost means we pursued this one and it went nowhere,
// and a lead nobody could write to has not been pursued at all. It is worth
// coming back to the moment somebody finds a contact, and coming back is an
// ordinary stage change — see ACTIVE_LEAD_STAGES for what it is kept out of.
//
// Last in the list because this order is the pipeline's own: the board draws
// its columns in it and the table sorts on it, and a holding bucket belongs
// after the stages a lead actually moves through rather than in the middle
// of them.
export const LEAD_STAGES = [
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATING",
  "WON",
  "LOST",
  "NO_CONTACT",
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
  NO_CONTACT: "No Contact",
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
  // Already two short words, so the short form is the long one.
  NO_CONTACT: "No Contact",
};

// The pipeline as it is looked at by default: every stage except the holding
// one. This is what the board draws columns for and what the table's stage
// filter opens on, so a lead with no way to reach it stops taking up room in
// the views used to decide what to do today — without being archived, deleted,
// or filed as Lost. Both views can still be pointed at it: the table has "No
// Contact" in its stage filter, and the board brings the column back as soon
// as there is anything in it.
export const ACTIVE_LEAD_STAGES: LeadStage[] = LEAD_STAGES.filter(
  (s) => s !== "NO_CONTACT",
);

// Stages that mean a message went out: Contacted itself, and everything the
// pipeline only reaches by passing through it. This is what "Messages Sent"
// counts — the lead was approached, whether or not anybody remembered to tick
// a field on it afterwards.
//
// Lost is deliberately not in the list. A lead can be marked Lost straight
// from New — disqualified before anybody wrote to it — and nothing on the
// record says which of the two happened, so counting it would inflate the
// number with clinics that were never messaged. No Contact is out for the same
// reason and more plainly still: it is the status for a lead nobody could
// write to.
export const CONTACTED_STAGES: LeadStage[] = [
  "CONTACTED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATING",
  "WON",
];

// Stages that count toward open pipeline value. No Contact is not among them:
// a lead with no way to reach it is not value in play, and counting it would
// put money on the dashboard that nobody can work towards today.
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
