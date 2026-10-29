// Channels — which way a lead is worked — and the email channel's status.
//
// A lead is on exactly one channel (Lead.channel). The Pipeline page shows one
// channel at a time, picked by the toggle beside its title and remembered per
// browser in a cookie, so the server renders the right view on first paint.
//
// The email status is derived, never stored, the same way the ICP tier is:
// what it can say grows as the opener and the Instantly send are built, and a
// derived value moves with them without a backfill. All seven are defined now
// so the chips above the table are the final set; until those parts exist,
// emailLeadStatus only ever returns "no_email" or "needs_opener".
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

export const EMAIL_LEAD_STATUSES = [
  "needs_opener",
  "check_contact",
  "ready",
  "in_sequence",
  "replied",
  "no_email",
] as const;
export type EmailLeadStatus = (typeof EMAIL_LEAD_STATUSES)[number];
export const EMAIL_LEAD_STATUS_LABELS: Record<EmailLeadStatus, string> = {
  needs_opener: "Needs opener",
  check_contact: "Check contact",
  ready: "Ready",
  in_sequence: "In sequence",
  replied: "Replied",
  no_email: "No email",
};

// The one thing to do next, per status.
export const EMAIL_LEAD_NEXT: Record<EmailLeadStatus, string> = {
  needs_opener: "Write the opener",
  check_contact: "Check the contact",
  ready: "Send to Instantly",
  in_sequence: "Wait for a reply",
  replied: "Answer the reply",
  no_email: "Find an email",
};

export interface EmailLeadFields {
  email: string | null;
}

// For now: no address → No email; an address → Needs opener. The other five
// come in with the opener and the Instantly send.
export function emailLeadStatus(lead: EmailLeadFields): EmailLeadStatus {
  return (lead.email ?? "").trim() === "" ? "no_email" : "needs_opener";
}

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

// Where the lead is in its email sequence, e.g. "Email 2 of 2 · sent Oct 30".
// Nothing is sent yet, so every lead is "Not started"; the signature is the
// one the Instantly part will fill in.
export function emailSequenceLabel(sequence: {
  step: number;
  of: number;
  sentAt: Date | null;
} | null): string {
  if (!sequence) return "Not started";
  const sent = sequence.sentAt
    ? ` · sent ${sequence.sentAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "";
  return `Email ${sequence.step} of ${sequence.of}${sent}`;
}
