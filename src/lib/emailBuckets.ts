// Where an email-channel lead lives: the Email queue (not ready yet), the
// Email pipeline (a usable address, and who it goes to settled: owner confirmed,
// email approved, or contact set or kept by hand), the Contact form list
// (nothing found, but the clinic has a form), the Call list (nothing found and
// no form), or waiting on a contact form already sent. Lost leads are hidden.
//
// One rule, read by every view, so a lead is only ever in one of them.
//
// Pure.

import { pickContactFormLink } from "@/lib/contactForm";
import { ownerEmailBlocker } from "@/lib/ownerFind";

export type EmailBucket = "hidden" | "queue" | "pipeline" | "contact_form" | "form_sent" | "call";

// How long after Mark form sent, with no reply, the lead shows on the Call
// list's Form follow-up section.
export const FORM_FOLLOW_UP_DAYS = 3;

export interface EmailBucketLead {
  stage: string;
  email: string | null;
  emailStatus: string | null;
  ownerStatus: string | null;
  ownerEmailAt: Date | null;
  emailRepliedAt: Date | null;
  suppressedAt: Date | null;
  // A person decided who the email goes to: the email approved, or the
  // contact set or kept by hand.
  emailApprovedAt: Date | null;
  contactNameByHand: boolean;
  contactConfirmedAt: Date | null;
  // What the owner-type address rule and Find owners' email step read.
  emailType: string | null;
  emailRiskyAcceptedAt: Date | null;
  emailRiskyAcceptedEmail: string | null;
  emailAlternates: string | null;
  ownerSource: string | null;
  websiteUrl: string | null;
  contactName: string | null;
}

// An owner-type address that checked valid, or a risky one accepted by hand
// (while it is still the lead's address). Enough for the Email pipeline on its
// own: Find owners has nothing left to do, and a missing or unconfirmed contact
// shows there as Check contact.
export function usableOwnerAddress(
  lead: Pick<EmailBucketLead, "email" | "emailType" | "emailStatus" | "emailRiskyAcceptedAt" | "emailRiskyAcceptedEmail">,
): boolean {
  const email = (lead.email ?? "").trim().toLowerCase();
  if (email === "" || lead.emailType !== "owner") return false;
  if (lead.emailStatus === "valid") return true;
  return lead.emailStatus === "risky" && lead.emailRiskyAcceptedAt !== null && (lead.emailRiskyAcceptedEmail ?? "").trim().toLowerCase() === email;
}

// Whether "Find this owner's email" would do nothing on this lead, run with
// force: the name step is a no-op only for an owner picked by hand, and the
// email step is blocked (src/lib/ownerFind.ts, the same rule it runs).
export function ownerRunWouldDoNothing(lead: EmailBucketLead): boolean {
  const nameStepNoop = lead.ownerStatus === "confirmed" && lead.ownerSource === "manual";
  return nameStepNoop && ownerEmailBlocker({ ...lead, channel: "email", ownerEmailAt: null }) !== null;
}

// The queue row's button: shown only when the run would do something. A pick
// waits on a person, not a run.
export function queueCanFind(lead: EmailBucketLead): boolean {
  return lead.ownerStatus !== "pick" && !ownerRunWouldDoNothing(lead);
}

// Who the email goes to is settled: Find owners confirmed the owner, the
// email was approved, or the contact was set or kept by hand.
export function recipientSettled(
  lead: Pick<EmailBucketLead, "ownerStatus" | "emailApprovedAt" | "contactNameByHand" | "contactConfirmedAt">,
): boolean {
  return lead.ownerStatus === "confirmed" || lead.emailApprovedAt !== null || lead.contactNameByHand || lead.contactConfirmedAt !== null;
}

export interface EmailBucketExtras {
  sendCount: number;
  // The clinic's contact page, or null when no stored link reads as one.
  contactFormUrl: string | null;
  // The latest Mark form sent, or null.
  formSentAt: Date | null;
}

// An address on file that checked valid or risky.
export function hasUsableEmail(lead: Pick<EmailBucketLead, "email" | "emailStatus">): boolean {
  return (lead.email ?? "").trim() !== "" && (lead.emailStatus === "valid" || lead.emailStatus === "risky");
}

// Find owners and the email lookup are both done, and no usable address came
// of it: the owner's email step ran (ownerEmailAt), or it never can because
// Find owners found no owner. An unchecked address waits in the queue until
// it is checked; an invalid one is no address at all.
export function nothingFound(lead: EmailBucketLead): boolean {
  if (hasUsableEmail(lead)) return false;
  const hasAddress = (lead.email ?? "").trim() !== "";
  if (hasAddress && lead.emailStatus === null) return false;
  // A run of Find owners could add nothing: the same as having run.
  return lead.ownerEmailAt !== null || lead.ownerStatus === "not_found" || ownerRunWouldDoNothing(lead);
}

// The two contact-form buckets, which live in the Email pipeline with a status
// of their own, or null for every other lead.
export type FormBucket = "contact_form" | "form_sent";
export function formBucketOf(
  lead: EmailBucketLead & { websiteLinks: string | null; websiteUrl: string | null },
  sendCount: number,
  formSentAt: Date | null,
): FormBucket | null {
  const b = emailBucket(lead, { sendCount, contactFormUrl: pickContactFormLink(lead.websiteLinks, lead.websiteUrl), formSentAt });
  return b === "contact_form" || b === "form_sent" ? b : null;
}

// The buckets the Email pipeline shows.
export function inEmailPipeline(b: EmailBucket): boolean {
  return b === "pipeline" || b === "contact_form" || b === "form_sent";
}

export function emailBucket(lead: EmailBucketLead, x: EmailBucketExtras): EmailBucket {
  if (lead.stage === "LOST") return "hidden";
  // Already written to, answered or stopped: the pipeline keeps its history.
  if (x.sendCount > 0 || lead.emailRepliedAt || lead.suppressedAt) return "pipeline";
  if (hasUsableEmail(lead) && (recipientSettled(lead) || usableOwnerAddress(lead))) return "pipeline";
  if (nothingFound(lead)) {
    if (x.formSentAt) return "form_sent";
    if (x.contactFormUrl) return "contact_form";
    return "call";
  }
  return "queue";
}

// Why a lead is still in the queue, in a few words.
export function queueReason(lead: EmailBucketLead): string {
  if (lead.ownerStatus === "pick") return "Pick the owner";
  if (lead.ownerStatus === "not_found") return "No owner found";
  if (lead.ownerStatus !== "confirmed") return "Owner not looked up yet";
  if ((lead.email ?? "").trim() === "") return "No email yet";
  if (lead.emailStatus === null) return "Email not checked yet";
  if (lead.emailStatus === "invalid") return "Email invalid";
  return "Email unverified";
}

// A form sent this long ago with no reply is due a call.
export function formFollowUpDue(formSentAt: Date | null, now: Date): boolean {
  return formSentAt !== null && now.getTime() - formSentAt.getTime() >= FORM_FOLLOW_UP_DAYS * 86_400_000;
}

// ─── The Call list ─────────────────────────────────────────────────────────

export type CallSection = "warm" | "form_follow_up" | "last_resort";

export interface CallListLead extends EmailBucketLead {
  channel: string;
  emailReplyType: string | null;
  // LinkedIn reply.
  repliedAt: Date | null;
  notes: string[];
}

export function watchedLoom(notes: string[]): boolean {
  return notes.some((n) => /loom/i.test(n) && /watch/i.test(n));
}

// Which Call list section a lead is in, with the reason shown on its row, or
// null when it is not on the list. Warm wins over everything else.
export function callSection(
  lead: CallListLead,
  x: EmailBucketExtras,
  now: Date,
): { section: CallSection; why: string } | null {
  if (lead.stage === "LOST" || lead.suppressedAt) return null;
  if (lead.emailRepliedAt && lead.emailReplyType !== "not_interested") {
    return { section: "warm", why: lead.emailReplyType === "interested" ? "Replied — interested" : "Replied to email" };
  }
  if (lead.repliedAt) return { section: "warm", why: "Replied on LinkedIn" };
  if (watchedLoom(lead.notes)) return { section: "warm", why: "Watched the Loom" };
  if (lead.channel === "call") return { section: "last_resort", why: "Call-channel lead" };
  if (lead.channel !== "email") return null;
  const bucket = emailBucket(lead, x);
  if (bucket === "form_sent" && formFollowUpDue(x.formSentAt, now)) {
    return { section: "form_follow_up", why: `Contact form sent ${FORM_FOLLOW_UP_DAYS}+ days ago, no reply` };
  }
  if (bucket === "call") return { section: "last_resort", why: "No email and no contact form" };
  return null;
}
