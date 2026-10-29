// Channels — which way a lead is worked — and the email channel's status.
//
// A lead is on exactly one channel (Lead.channel). The Pipeline page shows one
// channel at a time, picked by the toggle beside its title and remembered per
// browser in a cookie, so the server renders the right view on first paint.
//
// The email status is derived, never stored, the same way the ICP tier is —
// see emailWorkflowStatus in src/lib/emailWorkflow.ts.
//
// Pure.

import {
  EMAIL_STATUS_LABELS,
  readEmailStatus,
  readEmailType,
} from "@/lib/emailFind";

// ─── Channels ──────────────────────────────────────────────────────────────

export const LEAD_CHANNELS = ["email", "linkedin", "call"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];
export const LEAD_CHANNEL_LABELS: Record<LeadChannel, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  call: "Call",
};

export function readLeadChannel(v: unknown): LeadChannel | null {
  return typeof v === "string" && (LEAD_CHANNELS as readonly string[]).includes(v)
    ? (v as LeadChannel)
    : null;
}

// The channels the Pipeline page can show today. Call is on the toggle,
// greyed out, until it is built.
export const PIPELINE_VIEWABLE_CHANNELS = ["email", "linkedin"] as const;
export type PipelineChannel = (typeof PIPELINE_VIEWABLE_CHANNELS)[number];
export const DEFAULT_PIPELINE_CHANNEL: PipelineChannel = "email";
export const PIPELINE_CHANNEL_COOKIE = "pipeline-channel";

export function readPipelineChannel(v: unknown): PipelineChannel {
  return v === "linkedin" ? "linkedin" : DEFAULT_PIPELINE_CHANNEL;
}

// Discovery is split the same way and read with readPipelineChannel, but its
// toggle is remembered separately from Pipeline's.
export const DISCOVERY_CHANNEL_COOKIE = "discovery-channel";

// ─── Talking on LinkedIn ───────────────────────────────────────────────────

// The stages that mean a LinkedIn conversation is under way: Discovery Call
// Booked and everything the pipeline only reaches through it. Lost and No
// Contact come after it in LEAD_STAGES but are not live conversations; a lost
// lead that had accepted or replied is still caught by those two fields.
export const LINKEDIN_ENGAGED_STAGES = ["DISCOVERY", "PROPOSAL", "NEGOTIATING", "WON"] as const;

// A LinkedIn lead that is already talking to us: accepted the connection,
// replied, or reached Discovery Call Booked or later. An email candidate for
// the same clinic is still created, but tagged and never promoted, so nobody
// emails a clinic mid-conversation on LinkedIn.
export function isTalkingOnLinkedin(lead: {
  channel: string;
  stage: string;
  connectionAcceptedAt: Date | null;
  repliedAt: Date | null;
}): boolean {
  return (
    lead.channel === "linkedin" &&
    (lead.connectionAcceptedAt !== null ||
      lead.repliedAt !== null ||
      (LINKEDIN_ENGAGED_STAGES as readonly string[]).includes(lead.stage))
  );
}

export const TALKING_ON_LINKEDIN_LABEL = "Talking on LinkedIn";
export const TALKING_ON_LINKEDIN_BLOCK =
  "Not promoted: this clinic is already talking to us on LinkedIn. Carry on there.";

// ─── Email status ──────────────────────────────────────────────────────────

// The statuses are worked out by emailWorkflowStatus in
// src/lib/emailWorkflow.ts, from the rules there; this is their names, the
// order the chips run in (the way the work flows, left to right), and the one
// thing to do next for each.
export const EMAIL_LEAD_STATUSES = [
  "needs_opener",
  "check_email",
  "check_contact",
  "not_ab",
  "ready",
  "in_sequence",
  "replied",
  "stopped",
  "no_email",
] as const;
export type EmailLeadStatus = (typeof EMAIL_LEAD_STATUSES)[number];
export const EMAIL_LEAD_STATUS_LABELS: Record<EmailLeadStatus, string> = {
  needs_opener: "Needs opener",
  check_email: "Check email",
  check_contact: "Check contact",
  not_ab: "Not A/B",
  ready: "Ready",
  in_sequence: "In sequence",
  replied: "Replied",
  stopped: "Stopped",
  no_email: "No email",
};

export const EMAIL_LEAD_NEXT: Record<EmailLeadStatus, string> = {
  needs_opener: "Draft and approve the email",
  check_email: "Check the address",
  check_contact: "Pick the contact",
  not_ab: "Not sent to — below A/B",
  ready: "Send Email 1",
  in_sequence: "Wait, or send the follow-up",
  replied: "Answer the reply",
  stopped: "Nothing — suppressed",
  no_email: "Find an email",
};

// The line under the address: whose inbox it is, and whether it was checked.
// "Front desk" rather than "Generic inbox" — at a clinic, that is who reads it.
export function emailDetailLine(lead: {
  email: string | null;
  emailType: string | null;
  emailStatus: string | null;
}): string | null {
  if ((lead.email ?? "").trim() === "") return null;
  const type = readEmailType(lead.emailType);
  const who = type === "owner" ? "Owner" : type === "generic" ? "Front desk" : null;
  const checked = EMAIL_STATUS_LABELS[readEmailStatus(lead.emailStatus) ?? "unchecked"];
  return [who, checked].filter(Boolean).join(" · ");
}
