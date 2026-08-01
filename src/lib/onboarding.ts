// The client onboarding wizard — steps, the fields each one owns, and the
// mail/calendar drafts it hands off to Google.
//
// Nothing here sends anything. Every outbound action is a link that opens
// Gmail or Google Calendar in a new tab with the fields pre-filled; the user
// reviews and sends it themselves.

import { calendarDateRange } from "@/lib/timezones";

// ─── Steps ─────────────────────────────────────────────────────────────────

export interface OnboardingStep {
  n: number;
  title: string;
  blurb: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    n: 1,
    title: "Confirm details",
    blurb:
      "Check what carried over from the lead, set the package and fee, and pick the clinic's time zone.",
  },
  {
    n: 2,
    title: "Contract",
    blurb: "Track where the agreement stands and where the signed copy lives.",
  },
  {
    n: 3,
    title: "Invoice",
    blurb: "Log invoices as they go out and keep a running total collected.",
  },
  {
    n: 4,
    title: "Kickoff call",
    blurb: "Pick a time that works in both zones and put it on the calendar.",
  },
  {
    n: 5,
    title: "Handoff",
    blurb: "Onboarding done — over to the delivery checklist.",
  },
];

export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEPS.length;

// 0 means the wizard is not running: never started, skipped, or finished.
export const ONBOARDING_NOT_RUNNING = 0;
export const ONBOARDING_FIRST_STEP = 1;

export function isOnboarding(step: number): boolean {
  return step >= ONBOARDING_FIRST_STEP && step <= ONBOARDING_TOTAL_STEPS;
}

// Guards a step number arriving from a form post or a stale row.
export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return ONBOARDING_NOT_RUNNING;
  const n = Math.round(step);
  if (n < ONBOARDING_FIRST_STEP) return ONBOARDING_NOT_RUNNING;
  return Math.min(n, ONBOARDING_TOTAL_STEPS);
}

export function stepMeta(step: number): OnboardingStep {
  return ONBOARDING_STEPS[clampStep(step) - 1] ?? ONBOARDING_STEPS[0];
}

// ─── Contract ──────────────────────────────────────────────────────────────

export const CONTRACT_STATUSES = ["NOT_SENT", "SENT", "SIGNED"] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  NOT_SENT: "Not sent",
  SENT: "Sent",
  SIGNED: "Signed",
};

// ─── Invoices ──────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = ["UNPAID", "PAID"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
};

export interface InvoiceLike {
  amount: number;
  status: string;
}

// Collected = paid only. Outstanding is everything still unpaid.
export function invoiceTotals(invoices: InvoiceLike[]) {
  const collected = invoices
    .filter((i) => i.status === "PAID")
    .reduce((s, i) => s + i.amount, 0);
  const outstanding = invoices
    .filter((i) => i.status !== "PAID")
    .reduce((s, i) => s + i.amount, 0);
  return { collected, outstanding, billed: collected + outstanding };
}

// ─── Google hand-offs ──────────────────────────────────────────────────────

// Gmail's compose deep link. Opens a draft — it never sends.
export function gmailComposeUrl({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}): string {
  const params = new URLSearchParams({ view: "cm", to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

// Google Calendar's event-creation template link.
//
// Note: there is no reliable way to have this link attach a Google Meet
// conference — Calendar only adds one through its own interface. The event
// details therefore carry a reminder to click "Add Google Meet" after the
// draft opens.
export function calendarEventUrl({
  title,
  start,
  minutes,
  details,
}: {
  title: string;
  start: Date;
  minutes: number;
  details: string;
}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: calendarDateRange(start, minutes),
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export const KICKOFF_MINUTES = 30;

export const MEET_LIMITATION_NOTE =
  "Google Calendar only creates a Meet link from its own interface, so this link can't add one for you — click “Add Google Meet” in the draft event before saving.";

// ─── Draft templates ───────────────────────────────────────────────────────

// Starting points, not final copy. Both are editable in the wizard before the
// Gmail draft is opened.

export interface DraftFields {
  subject: string;
  body: string;
}

export interface ClientForDraft {
  clinicName: string;
  contactName: string | null;
  packageName: string | null;
  monthlyFee: number | null;
}

const SIGN_OFF = "Thanks,\nSpine Scale";

function greeting(client: ClientForDraft): string {
  return client.contactName ? `Hi ${client.contactName},` : "Hi there,";
}

function feeLine(client: ClientForDraft): string {
  const pkg = client.packageName ?? "the agreed scope of work";
  const fee =
    client.monthlyFee == null
      ? ""
      : ` at $${client.monthlyFee.toLocaleString("en-US")}/month`;
  return `${pkg}${fee}`;
}

export function contractDraft(client: ClientForDraft): DraftFields {
  return {
    subject: `Agreement for ${client.clinicName}`,
    body: [
      greeting(client),
      "",
      `Great to have ${client.clinicName} on board. Attached is the agreement covering ${feeLine(client)}.`,
      "",
      "Have a read through and send it back signed whenever you're ready — shout if anything needs adjusting first.",
      "",
      "Once it's signed I'll send the first invoice and we'll get a kickoff call in the diary.",
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}

export function invoiceDraft(
  client: ClientForDraft,
  amount: number | null,
): DraftFields {
  const amountText =
    amount == null ? "the first invoice" : `an invoice for $${amount.toLocaleString("en-US")}`;
  return {
    subject: `Invoice — ${client.clinicName}`,
    body: [
      greeting(client),
      "",
      `Attached is ${amountText} covering ${feeLine(client)}.`,
      "",
      "Payment details are on the invoice. Let me know if you need it billed to a different address or contact.",
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}

export function kickoffCalendarDetails(clinicName: string): string {
  return [
    `Kickoff call with ${clinicName} — Spine Scale onboarding.`,
    "",
    "Agenda: confirm goals and offer, walk through the delivery checklist, collect ad account and GHL access, agree on reporting cadence.",
    "",
    MEET_LIMITATION_NOTE,
  ].join("\n");
}
