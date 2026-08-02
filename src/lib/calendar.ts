// The calendar — one month view over dates that already live on other
// records. Nothing is created here: a call is scheduled from a lead or a
// client, a follow-up date is set on the lead, a due date is set on the
// invoice. This module turns those three sources into a single list of events
// and lays out the grid they sit in.
//
// Days are identified by a "YYYY-MM-DD" key rather than a Date, so cells,
// event buckets and today all compare as plain strings and no cell can drift
// by a zone offset. Date-only fields (nextFollowUp, dueDate) are stored as UTC
// midnight — the same reading fmtDate() gives them — so their key is just the
// front of the ISO string. A call is the exception: it happens at an instant,
// and which day that lands on is only knowable in the viewer's own zone, which
// is why placeEvents() below re-buckets calls once the browser has said so.

import { callTypeLabel, CALL_STATUS_LABELS, CallStatus } from "@/lib/calls";
import { LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { fmtMoney } from "@/lib/format";
import { INVOICE_STATUS_LABELS, InvoiceStatus } from "@/lib/onboarding";

// ─── Kinds and their colours ───────────────────────────────────────────────

export const CALENDAR_KINDS = ["CALL", "FOLLOW_UP", "INVOICE_DUE"] as const;

export type CalendarKind = (typeof CALENDAR_KINDS)[number];

// Calls take the brand blue and follow-ups the teal accent — the two colours
// the app already uses to tell one thing from another. Invoice due dates need
// a third, and it has to be categorical rather than evaluative: violet is
// already in the badge palette (it carries the Contacted stage), and unlike
// amber or red it reads as "a different kind of thing" rather than "something
// is wrong". A due date arriving is not a problem by itself — being *late* is,
// and that is what the overdue treatment is for.
export interface CalendarKindStyle {
  label: string; // legend and agenda wording
  icon: string; // from the in-house icon set
  dot: string; // the grid's indicator
  text: string; // agenda icon tint
  soft: string; // agenda icon backing
}

export const CALENDAR_KIND_STYLES: Record<CalendarKind, CalendarKindStyle> = {
  CALL: {
    label: "Calls",
    icon: "phone",
    dot: "bg-accent",
    text: "text-accent",
    soft: "bg-accent/10",
  },
  FOLLOW_UP: {
    label: "Lead follow-ups",
    icon: "bell",
    dot: "bg-accent2",
    // #3FD1C8 is a fill colour, not a text one — the badge palette's darker
    // teal is what stays legible on white.
    text: "text-[#0E9F94]",
    soft: "bg-[#E2F7F5]",
  },
  INVOICE_DUE: {
    label: "Invoice due dates",
    icon: "dollar",
    dot: "bg-[#7C3AED]",
    text: "text-[#7C3AED]",
    soft: "bg-[#F3EDFD]",
  },
};

// Fixed order wherever a day's events are grouped rather than timed.
const KIND_ORDER: Record<CalendarKind, number> = {
  CALL: 0,
  FOLLOW_UP: 1,
  INVOICE_DUE: 2,
};

// ─── Day keys ──────────────────────────────────────────────────────────────

// A UTC-midnight date field, read as the day it was typed in as.
export function dayKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// An instant, read as the day it falls on in the browser's own zone.
export function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDayKey(key: string): { year: number; month: number } {
  const [year, month] = key.split("-").map(Number);
  return { year, month: month - 1 };
}

// "Sun, Aug 2, 2026" — from a key, so it never round-trips through a zone.
export function fmtDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ─── Events ────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  kind: CalendarKind;
  // The day this event was raised on. For a call it is the UTC reading of the
  // instant, which is what the server can know on its own; placeEvents()
  // replaces it with the viewer's reading once the browser is running.
  day: string;
  // The instant, for events that happen at a time. Null for all-day ones.
  at: string | null;
  title: string; // the record the event belongs to
  detail: string; // what is happening — "Discovery call", "$2,500 due"
  href: string; // through to the lead, client or invoice's record
  // Already closed out: a completed, cancelled or no-show call, a paid
  // invoice. Nothing resolved can be overdue, however far back it sits.
  resolved: boolean;
  meta: string | null; // status wording, where the status is worth saying
}

export interface CalendarCall {
  id: string;
  scheduledAt: Date;
  type: string;
  status: string;
  leadId: string | null;
  clientId: string | null;
  lead: { clinicName: string } | null;
  client: { clinicName: string } | null;
}

export interface CalendarLead {
  id: string;
  clinicName: string;
  stage: string;
  nextFollowUp: Date | null;
}

export interface CalendarInvoice {
  id: string;
  clientId: string;
  dueDate: Date | null;
  amount: number;
  status: string;
  client: { clinicName: string };
}

export function buildCalendarEvents({
  calls,
  leads,
  invoices,
}: {
  calls: CalendarCall[];
  leads: CalendarLead[];
  invoices: CalendarInvoice[];
}): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const call of calls) {
    const owner = call.lead ?? call.client;
    events.push({
      id: `call-${call.id}`,
      kind: "CALL",
      day: dayKeyUtc(call.scheduledAt),
      at: call.scheduledAt.toISOString(),
      title: owner?.clinicName ?? "Unknown record",
      detail: `${callTypeLabel(call.type)} call`,
      href: call.leadId
        ? `/pipeline/${call.leadId}`
        : `/clients/${call.clientId}`,
      resolved: call.status !== "SCHEDULED",
      // Scheduled is the default state and says nothing; the other three are
      // the outcome of the call and are worth carrying.
      meta:
        call.status === "SCHEDULED"
          ? null
          : (CALL_STATUS_LABELS[call.status as CallStatus] ?? call.status),
    });
  }

  for (const lead of leads) {
    if (!lead.nextFollowUp) continue;
    events.push({
      id: `followup-${lead.id}`,
      kind: "FOLLOW_UP",
      day: dayKeyUtc(lead.nextFollowUp),
      at: null,
      title: lead.clinicName,
      detail: "Follow-up",
      href: `/pipeline/${lead.id}`,
      // A follow-up date has no completed state of its own — it is cleared or
      // moved on the lead — so it can always go overdue, which is the same
      // rule the dashboard's Today's focus applies.
      resolved: false,
      meta: LEAD_STAGE_LABELS[lead.stage as LeadStage] ?? lead.stage,
    });
  }

  for (const invoice of invoices) {
    if (!invoice.dueDate) continue;
    events.push({
      id: `invoice-${invoice.id}`,
      kind: "INVOICE_DUE",
      day: dayKeyUtc(invoice.dueDate),
      at: null,
      title: invoice.client.clinicName,
      detail: `${fmtMoney(invoice.amount)} invoice due`,
      href: `/clients/${invoice.clientId}`,
      resolved: invoice.status === "PAID",
      meta:
        INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ??
        invoice.status,
    });
  }

  return events;
}

// ─── Placing events on days ────────────────────────────────────────────────

export interface PlacedEvent extends CalendarEvent {
  dayKey: string;
  overdue: boolean;
}

// Both of the things that decide where an event sits and whether it has
// slipped — the viewer's zone and the current time — are only knowable in the
// browser. The server renders with its own reading and the client corrects it
// on mount, so this takes them as arguments rather than reaching for
// new Date() itself.
export function placeEvents(
  events: CalendarEvent[],
  { now, todayKey, local }: { now: Date; todayKey: string; local: boolean },
): PlacedEvent[] {
  return events
    .map((event) => {
      const dayKey =
        local && event.at ? localDayKey(new Date(event.at)) : event.day;
      const overdue = event.resolved
        ? false
        : event.at
          ? new Date(event.at) < now // a call is late the minute it passes
          : dayKey < todayKey; // an all-day item, only once the day is over
      return { ...event, dayKey, overdue };
    })
    .sort(
      (a, b) =>
        // Timed events first, in time order — they are the ones you cannot
        // move — then the all-day ones grouped by kind.
        Number(b.at !== null) - Number(a.at !== null) ||
        (a.at ?? "").localeCompare(b.at ?? "") ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.title.localeCompare(b.title),
    );
}

// Which dots a cell shows, and how many events are left over.
//
// A straight slice of the day's events would let a busy day hide a whole
// colour — four calls in front of the follow-up and the invoice, and the cell
// reads as nothing but calls. So every kind present takes a slot first, then
// the remaining slots go to the rest in order, and what is shown is sorted by
// kind so a row of dots always reads left to right in the legend's order.
export function cellDots(
  events: PlacedEvent[],
  limit: number,
): { dots: PlacedEvent[]; extra: number } {
  const seen = new Set<CalendarKind>();
  const first: PlacedEvent[] = [];
  const rest: PlacedEvent[] = [];
  for (const event of events) {
    if (seen.has(event.kind)) rest.push(event);
    else {
      seen.add(event.kind);
      first.push(event);
    }
  }
  const dots = [...first, ...rest]
    .slice(0, limit)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return { dots, extra: events.length - dots.length };
}

export function groupByDay(events: PlacedEvent[]): Map<string, PlacedEvent[]> {
  const byDay = new Map<string, PlacedEvent[]>();
  for (const event of events) {
    const bucket = byDay.get(event.dayKey);
    if (bucket) bucket.push(event);
    else byDay.set(event.dayKey, [event]);
  }
  return byDay;
}

// ─── The month grid ────────────────────────────────────────────────────────

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Six rows every month, so the grid keeps one height and the page does not
// jump as you page through it.
const GRID_ROWS = 6;
const GRID_CELLS = GRID_ROWS * WEEKDAYS.length;

export interface MonthCell {
  key: string; // "2026-08-02"
  day: number; // day of the month
  inMonth: boolean; // false for the leading and trailing filler days
}

export interface MonthView {
  year: number;
  month: number; // 0-indexed, as JS counts them
  label: string; // "August 2026"
  cells: MonthCell[];
}

export function buildMonth(year: number, month: number): MonthView {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = first.getUTCDay(); // how many trailing days of the month before
  const cells: MonthCell[] = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    const date = new Date(Date.UTC(year, month, 1 - lead + i));
    cells.push({
      key: dayKeyUtc(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month && date.getUTCFullYear() === year,
    });
  }
  return {
    year,
    month,
    label: first.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    cells,
  };
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}
