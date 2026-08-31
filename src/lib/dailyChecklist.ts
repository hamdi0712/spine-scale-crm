// The fixed daily routine — four groups of work, in the order a day runs
// through them, and the rules for reading a day.
//
// The items are a constant rather than a table, for the reason the ad
// compliance gate's five are: this is the shape of a working day, not data
// somebody maintains. A routine you can edit from the UI is a routine you stop
// following, and the point of the checklist is that it asks the same questions
// every morning. Changing it is a code change, deliberately.
//
// Each item has a stable key and a label. The key is what is stored, so a
// wording change never orphans the history behind it; the label is what is
// read. DailyChecklistEntry.item holds the key.
//
// Pure — no database, no clock beyond what it is handed. The reading and
// seeding live in src/lib/dailyChecklistStore.ts.

export const DAILY_CHECKLIST_CATEGORIES = [
  "PROSPECTING",
  "OUTREACH",
  "CONVERSATIONS",
  "CRM",
] as const;

export type DailyChecklistCategory =
  (typeof DAILY_CHECKLIST_CATEGORIES)[number];

export const DAILY_CHECKLIST_CATEGORY_LABELS: Record<
  DailyChecklistCategory,
  string
> = {
  PROSPECTING: "Prospecting",
  OUTREACH: "Outreach",
  CONVERSATIONS: "Conversations",
  CRM: "CRM",
};

export interface DailyChecklistItem {
  key: string;
  label: string;
  category: DailyChecklistCategory;
}

// The routine, whole, in order. The board renders it grouped by category and
// nothing reorders it — this array is the sequence.
export const DAILY_CHECKLIST_ITEMS: DailyChecklistItem[] = [
  // Prospecting — filling the top of the funnel, and filling it with clinics
  // that have actually been looked at.
  {
    key: "PROSPECT_RESEARCHED",
    label: "Clinics researched",
    category: "PROSPECTING",
  },
  {
    key: "PROSPECT_QUALIFIED",
    label: "Qualified / disqualified",
    category: "PROSPECTING",
  },
  {
    key: "PROSPECT_DECISION_MAKERS",
    label: "Decision-makers identified",
    category: "PROSPECTING",
  },
  {
    key: "PROSPECT_NOTES",
    label: "Research notes completed",
    category: "PROSPECTING",
  },

  // Outreach — the sequence, in the order its five steps happen.
  {
    key: "OUTREACH_GENERATED",
    label: "Connection messages generated",
    category: "OUTREACH",
  },
  {
    key: "OUTREACH_REVIEWED",
    label: "Messages reviewed",
    category: "OUTREACH",
  },
  {
    key: "OUTREACH_REQUESTS_SENT",
    label: "Connection requests sent",
    category: "OUTREACH",
  },
  {
    key: "OUTREACH_ACCEPTED_PROCESSED",
    label: "Accepted connections processed",
    category: "OUTREACH",
  },
  {
    key: "OUTREACH_FIRST_MESSAGES",
    label: "First messages sent",
    category: "OUTREACH",
  },

  // Conversations — what happens once somebody answers.
  //
  // One item, and only one, because only one of them is a thing a person can
  // decide to do. Checking the replies is done whether or not anybody wrote
  // back; answering one, sending an audit offer, cutting a Loom and clearing a
  // follow-up all wait on somebody else having moved first. Those four used to
  // be ticks here, and on a quiet day they read as four failures for work that
  // was never available to do — so they are counted rather than ticked now
  // (src/lib/dailyBonus.ts), off the same records the numbers panel reads.
  {
    key: "CONVO_REPLIES_CHECKED",
    label: "Replies checked",
    category: "CONVERSATIONS",
  },

  // CRM — the two habits that keep everything above readable tomorrow.
  { key: "CRM_ACTIONS_MARKED", label: "Every action marked", category: "CRM" },
  {
    key: "CRM_NEXT_STEPS",
    label: "Every active lead has correct next step",
    category: "CRM",
  },
];

const ITEM_KEYS = new Set(DAILY_CHECKLIST_ITEMS.map((i) => i.key));

export function isDailyChecklistItem(value: unknown): value is string {
  return typeof value === "string" && ITEM_KEYS.has(value);
}

export function itemsInCategory(
  category: DailyChecklistCategory,
): DailyChecklistItem[] {
  return DAILY_CHECKLIST_ITEMS.filter((i) => i.category === category);
}

// ─── Days ──────────────────────────────────────────────────────────────────

// A day is midnight UTC on that day, matching every other date-only column in
// this schema (see fmtDate, which reads them back in UTC). Storing a local
// midnight would make "today" a different row depending on where the browser
// is, and the whole feature turns on two views of the same day agreeing.
export function toChecklistDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// "2026-08-21" — what the page's ?date= carries and what a <input type="date">
// posts, so the two are the same string.
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Parses a ?date= back into a day, rejecting anything that is not a real one.
// A junk parameter falls back rather than throwing: a mistyped URL should show
// today, not an error page.
export function parseDayKey(value: string | undefined, fallback: Date): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return toChecklistDay(fallback);
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? toChecklistDay(fallback) : d;
}

export function addDays(day: Date, n: number): Date {
  return new Date(day.getTime() + n * 24 * 60 * 60 * 1000);
}

// ─── Reading a day ─────────────────────────────────────────────────────────

export interface DailyChecklistRow {
  item: string;
  checked: boolean;
}

// The routine joined to whatever rows exist for the day. Driven by the
// constant rather than by the rows, so an item added to the routine shows up
// unticked on days that predate it instead of vanishing from the list.
export function readDay(rows: DailyChecklistRow[]): Map<string, boolean> {
  const byItem = new Map(rows.map((r) => [r.item, r.checked]));
  return new Map(
    DAILY_CHECKLIST_ITEMS.map((i) => [i.key, byItem.get(i.key) ?? false]),
  );
}

// The day's score, and it is a score over controllable work only: every item
// left in the routine is something that can be done on any day, whatever the
// inboxes did. What happened because somebody else moved is bonus, added
// beside this rather than into it (src/lib/dailyBonus.ts).
export function checkedCount(checked: Map<string, boolean>): number {
  return DAILY_CHECKLIST_ITEMS.filter((i) => checked.get(i.key)).length;
}
