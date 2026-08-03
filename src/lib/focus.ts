// Today's focus — one list of everything that wants doing today, drawn from
// four places that used to be four separate panels.
//
// The order is the point. Calls come first because they happen at a time and
// the time is not negotiable; then follow-ups that have already slipped; then
// clients whose health has just turned, because that is a conversation you
// should start rather than wait to be asked about; then the onboarding work.
// The one exception runs the other way: an onboarding item that is holding up
// a call or a launch is not admin, it is the thing standing between a client
// and going live, so it is lifted to sit with the calls.
//
// The list itself is uncapped — hiding work does not make it go away — but the
// dashboard card only shows the top FOCUS_VISIBLE_LIMIT of it behind a "View
// all", so the panel reads as the next thing to do rather than a backlog. The
// ordering above is what makes that safe: the row on screen is always the most
// pressing one, and nothing is dropped, only folded.

import { callTypeLabel } from "@/lib/calls";
import { HEALTH_LABELS, HealthStatus } from "@/lib/health";

// Priority tiers, low number first.
const TIER_CALL = 1;
const TIER_BLOCKING_URGENT = 2; // an onboarding item holding up a call or launch
const TIER_FOLLOW_UP = 3;
const TIER_HEALTH = 4;
const TIER_BLOCKING = 5;
const TIER_ONBOARDING = 6;

// How many rows the dashboard card shows before the rest go behind "View all".
// One, so the card reads as the next thing to do. It is not what squares the
// card off against US business hours beside it — collapsed, the two are held
// to a common height by the dashboard row itself, whichever of them is the
// taller — so this number can change without unsettling that.
export const FOCUS_VISIBLE_LIMIT = 1;

// A health change stops being news after this long.
const HEALTH_NEWS_DAYS = 7;

export type FocusKind = "CALL" | "FOLLOW_UP" | "HEALTH" | "ONBOARDING";

export type FocusTone = "blue" | "amber" | "red" | "neutral";

export interface FocusItem {
  id: string;
  kind: FocusKind;
  icon: string;
  label: string; // "Footlab — Proposal follow-up"
  href: string;
  note: string; // the chip: "Call due", "Overdue", "Blocking launch"
  at: string | null; // ISO instant, rendered in the viewer's own zone
  tone: FocusTone;
  priority: number;
  sortAt: number; // epoch ms within a tier; 0 where time is not the sort key
  // Whether this row is time-bound or blocking rather than routine onboarding
  // admin. The summary line counts on it; the visible/hidden split does not.
  pinned: boolean;
}

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface FocusCall {
  id: string;
  scheduledAt: Date;
  type: string;
  status: string;
  leadId: string | null;
  clientId: string | null;
  lead: { clinicName: string } | null;
  client: { clinicName: string } | null;
}

export interface FocusLead {
  id: string;
  clinicName: string;
  stage: string;
  nextFollowUp: Date | null;
}

export interface FocusChecklistItem {
  id: string;
  title: string;
  status: string;
  blocking: boolean;
  sortOrder: number;
}

export interface FocusClient {
  id: string;
  clinicName: string;
  status: string;
  kickoffAt: Date | null;
  healthStatus: string | null;
  healthChangedAt: Date | null;
  checklist: FocusChecklistItem[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function endOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}

// ─── The list ──────────────────────────────────────────────────────────────

export function buildFocus({
  now,
  calls,
  leads,
  clients,
}: {
  now: Date;
  calls: FocusCall[];
  leads: FocusLead[];
  clients: FocusClient[];
}): FocusItem[] {
  const items: FocusItem[] = [];
  const dayEnd = endOfDay(now);
  const dayStart = startOfDay(now);

  // 1 — calls. Scheduled for some point today, or scheduled for earlier and
  // never closed out, which is the more urgent of the two.
  const todaysCalls = calls.filter(
    (c) => c.status === "SCHEDULED" && c.scheduledAt <= dayEnd,
  );
  for (const call of todaysCalls) {
    const overdue = call.scheduledAt < now;
    const owner = call.lead ?? call.client;
    items.push({
      id: `call-${call.id}`,
      kind: "CALL",
      icon: "phone",
      label: `${owner?.clinicName ?? "Unknown record"} — ${callTypeLabel(call.type)} call`,
      href: call.leadId ? `/pipeline/${call.leadId}` : `/clients/${call.clientId}`,
      note: overdue ? "Overdue" : "Call due",
      at: call.scheduledAt.toISOString(),
      tone: overdue ? "red" : "blue",
      priority: TIER_CALL,
      sortAt: call.scheduledAt.getTime(),
      pinned: true,
    });
  }

  // Which clients have a call today that outstanding work could hold up, and
  // which of those calls is the kickoff — the one an unfinished blocking item
  // genuinely derails rather than merely sits behind.
  const clientsWithCallToday = new Set(
    todaysCalls.map((c) => c.clientId).filter((id): id is string => id !== null),
  );
  const clientsWithKickoffToday = new Set(
    todaysCalls
      .filter((c) => c.type === "KICKOFF")
      .map((c) => c.clientId)
      .filter((id): id is string => id !== null),
  );

  // 2 — follow-ups that are due today or have already slipped.
  for (const lead of leads) {
    if (!lead.nextFollowUp || lead.nextFollowUp > dayEnd) continue;
    const overdue = lead.nextFollowUp < dayStart;
    items.push({
      id: `followup-${lead.id}`,
      kind: "FOLLOW_UP",
      icon: "bell",
      label: `${lead.clinicName} — follow-up`,
      href: `/pipeline/${lead.id}`,
      note: overdue ? "Overdue" : "Due today",
      at: null,
      tone: overdue ? "red" : "amber",
      priority: TIER_FOLLOW_UP,
      sortAt: lead.nextFollowUp.getTime(),
      pinned: true,
    });
  }

  for (const client of clients) {
    // 3 — a client that has just crossed into a status that asks something of
    // you. Healthy and Ramping ask nothing, so they never appear here.
    const health = client.healthStatus as HealthStatus | null;
    if (
      (health === "AT_RISK" || health === "NEEDS_ATTENTION") &&
      client.healthChangedAt &&
      daysBetween(now, client.healthChangedAt) <= HEALTH_NEWS_DAYS
    ) {
      const atRisk = health === "AT_RISK";
      items.push({
        id: `health-${client.id}`,
        kind: "HEALTH",
        icon: "pulse",
        label: `${client.clinicName} — ${atRisk ? "reach out, account at risk" : "review the account"}`,
        href: `/reporting/${client.id}`,
        note: `Now ${HEALTH_LABELS[health].toLowerCase()}`,
        at: null,
        tone: atRisk ? "red" : "amber",
        priority: TIER_HEALTH,
        // At risk before needs attention, then most recent first.
        sortAt: (atRisk ? 0 : 1e12) - client.healthChangedAt.getTime(),
        pinned: true,
      });
    }

    // 4 — onboarding work. Only for clients still being onboarded; once a
    // client is live the checklist is delivery admin, not a daily priority.
    if (client.status !== "ONBOARDING") continue;

    // Kickoff already happened, so the launch is what the remaining blocking
    // items are holding up.
    const launchDue = client.kickoffAt !== null && client.kickoffAt < now;
    const callToday = clientsWithCallToday.has(client.id);

    for (const item of client.checklist) {
      if (item.status === "DONE") continue;
      const urgent = item.blocking && (launchDue || callToday);
      items.push({
        id: `checklist-${item.id}`,
        kind: "ONBOARDING",
        icon: "checklist",
        label: `${client.clinicName} — ${item.title}`,
        href: `/clients/${client.id}`,
        note: item.blocking
          ? clientsWithKickoffToday.has(client.id)
            ? "Blocking kickoff"
            : "Blocking launch"
          : item.status === "IN_PROGRESS"
            ? "In progress"
            : "Onboarding",
        at: null,
        tone: urgent ? "amber" : item.blocking ? "amber" : "neutral",
        priority: urgent
          ? TIER_BLOCKING_URGENT
          : item.blocking
            ? TIER_BLOCKING
            : TIER_ONBOARDING,
        sortAt: item.sortOrder,
        pinned: item.blocking,
      });
    }
  }

  return items.sort(
    (a, b) => a.priority - b.priority || a.sortAt - b.sortAt || a.label.localeCompare(b.label),
  );
}

// ─── The one-line read ─────────────────────────────────────────────────────

export interface FocusSummary {
  headline: string;
  detail: string;
  tone: FocusTone;
  cta: { label: string; href: string } | null;
  overdue: number;
}

// What the panel says above the list: the single most pressing thing on it,
// counted rather than characterised, plus a way straight into the top item.
export function summariseFocus(items: FocusItem[]): FocusSummary {
  const overdue = items.filter((i) => i.note === "Overdue").length;
  if (items.length === 0) {
    return {
      headline: "Nothing due today",
      detail: "No calls, overdue follow-ups or blocking onboarding items.",
      tone: "neutral",
      cta: null,
      overdue: 0,
    };
  }

  const count = (kind: FocusKind) => items.filter((i) => i.kind === kind).length;
  const calls = count("CALL");
  const health = count("HEALTH");
  const blocking = items.filter((i) => i.kind === "ONBOARDING" && i.pinned).length;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const [headline, tone]: [string, FocusTone] =
    overdue > 0
      ? [`${overdue} ${plural(overdue, "item is", "items are")} overdue`, "red"]
      : calls > 0
        ? [`${calls} ${plural(calls, "call", "calls")} due today`, "blue"]
        : health > 0
          ? [`${health} ${plural(health, "client needs", "clients need")} a look`, "amber"]
          : blocking > 0
            ? [`${blocking} ${plural(blocking, "item is", "items are")} blocking launch`, "amber"]
            : [`${items.length} ${plural(items.length, "item", "items")} on today's list`, "neutral"];

  const top = items[0];
  const cta =
    top.kind === "FOLLOW_UP"
      ? { label: "View pipeline", href: "/pipeline" }
      : top.kind === "HEALTH"
        ? { label: "View reporting", href: "/reporting" }
        : { label: "Open record", href: top.href };

  return { headline, detail: `Next up: ${top.label}.`, tone, cta, overdue };
}

// Which rows stay on screen, and which hide behind "View all". A straight cut
// down the priority order — no per-kind exceptions, so the visible row is
// exactly the top of the list. Kept here beside the ordering so the two rules
// never drift apart.
export function splitFocus(items: FocusItem[]): {
  visible: FocusItem[];
  hidden: FocusItem[];
} {
  return {
    visible: items.slice(0, FOCUS_VISIBLE_LIMIT),
    hidden: items.slice(FOCUS_VISIBLE_LIMIT),
  };
}
