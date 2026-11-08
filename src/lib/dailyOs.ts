// The Daily OS: the fixed weekday routine on the Tasks page, replacing the old
// daily checklist. Four blocks, each a list of tasks with a time estimate and,
// for most, a line on how. No clock times — a block is done when it is done;
// the estimates say how long it should take, not when to start.
//
// Ticks are stored per day in DailyChecklistEntry under "os:" keys, so a day's
// routine is a record of that day and a fresh day starts unticked.

export type OsTone = "teal" | "warn" | "indigo" | "bad";

export interface OsTask {
  key: string;
  label: string;
  minutes: number;
  how?: string;
}

export interface OsBlock {
  key: string;
  tag: string;
  name: string;
  tone: OsTone;
  icon: "mail" | "spark" | "linkedin" | "send";
  tasks: OsTask[];
}

const EMAIL_PREP: OsBlock = {
  key: "b1",
  tag: "Block 1 · Email prep",
  name: "Pipeline",
  tone: "teal",
  icon: "mail",
  tasks: [
    {
      key: "queue",
      label: "Clear the Email queue",
      minutes: 15,
      how: "Outreach queue → Email. Run Find owners from the top right. Open any lead marked “Pick the owner” and pick the doctor from the site. Leads with nothing found move to Contact form or the Call list on their own.",
    },
    {
      key: "fix",
      label: "Fix Check contact + Check clinic name",
      minutes: 10,
      how: "Pipeline → Email → those two chips. Set the owner name (full name, not “Dr. Gary”) or edit the short clinic name. A blank contact on a front-desk inbox is fine.",
    },
    {
      key: "openers",
      label: "Approve 20 openers",
      minutes: 35,
      how: "Needs opener chip, A-tier first. Open Meta Ads on the lead to check the ad before approving. Write the Needs manual opener ones by hand. Approve only if it reads like a person wrote it. This fills tonight’s 20 sends.",
    },
    {
      key: "replies",
      label: "Replies",
      minutes: 15,
      how: "Check both Gmail inboxes. Mark replied in the CRM (interested / not now / not interested). Interested → reply and offer the Loom audit. Not interested is suppressed automatically.",
    },
  ],
};

const SKILL_META: OsBlock = {
  key: "b2",
  tag: "Block 2 · Skill",
  name: "Meta ads + compliance",
  tone: "warn",
  icon: "spark",
  tasks: [
    { key: "campaign", label: "Build a real campaign in the sandbox account", minutes: 40 },
    { key: "policy", label: "Healthcare ad policy: one rule, one example", minutes: 20 },
  ],
};

const SKILL_GHL: OsBlock = {
  key: "b2",
  tag: "Block 2 · Build",
  name: "Pipeline OS template (GHL)",
  tone: "warn",
  icon: "spark",
  tasks: [
    { key: "module", label: "Build one module: funnel / speed-to-lead / reminders / no-show", minutes: 50 },
    { key: "snapshot", label: "Document it as a reusable snapshot", minutes: 10 },
  ],
};

const AUTHORITY: OsBlock = {
  key: "b3",
  tag: "Block 3 · Authority",
  name: "LinkedIn",
  tone: "indigo",
  icon: "linkedin",
  tasks: [
    { key: "post", label: "Write + post one piece (no-show math, follow-up gaps, FootLab proof)", minutes: 15 },
    { key: "comment", label: "Comment on 5 clinic-owner posts", minutes: 10 },
    {
      key: "leads",
      label: "Work existing LinkedIn leads",
      minutes: 5,
      how: "LinkedIn view only: answer replies and send first messages to accepted connections. No new connection requests. LinkedIn is secondary now.",
    },
  ],
};

const SEND_WINDOW: OsBlock = {
  key: "b4",
  tag: "Block 4 · US hours",
  name: "Send window",
  tone: "bad",
  icon: "send",
  tasks: [
    {
      key: "send",
      label: "Send 20 Email 1s (10 per inbox)",
      minutes: 30,
      how: "Pipeline → Email → Ready. Open in Gmail (it picks the right inbox), check it once, send or Schedule send for the US morning, then Mark sent. Use Undo mark sent if you slip.",
    },
    {
      key: "followups",
      label: "Follow-ups due today",
      minutes: 10,
      how: "Due today chip. Same flow: Open in Gmail → send → Mark sent. They reply in the same thread.",
    },
    {
      key: "forms",
      label: "Contact forms",
      minutes: 10,
      how: "Contact form chip. Contact form ↗ → paste Copy message → submit → Mark form sent. Aim for 2–3 a day.",
    },
    {
      key: "calls",
      label: "Warm calls",
      minutes: 10,
      how: "Call list → Warm calls first, then Form follow-up. Log Called – no answer / Talked / Not interested. Nothing warm? Skip it — don’t cold call.",
    },
  ],
};

// Monday = 0 … Friday = 4. Block 2 alternates: Meta ads on Mon/Wed/Fri, the
// GHL build on Tue/Thu.
export function osBlocks(weekday: number): OsBlock[] {
  return [EMAIL_PREP, weekday % 2 === 0 ? SKILL_META : SKILL_GHL, AUTHORITY, SEND_WINDOW];
}

export const OS_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export function osItemKey(block: OsBlock, task: OsTask): string {
  return `os:${block.key}:${block.key === "b2" ? `${block.name === SKILL_META.name ? "meta" : "ghl"}-` : ""}${task.key}`;
}

// Every key the routine can write — what the action accepts.
export const OS_ITEM_KEYS = new Set<string>(
  [0, 1].flatMap((d) => osBlocks(d).flatMap((b) => b.tasks.map((t) => osItemKey(b, t)))),
);

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export const OS_SCOREBOARD: { value: string; label: string }[] = [
  { value: "100", label: "cold emails, week 1 (150 once clean)" },
  { value: "<2%", label: "bounce rate" },
  { value: "10–15", label: "contact forms sent" },
  { value: "2+", label: "discovery calls" },
  { value: "3", label: "LinkedIn posts min" },
  { value: "1", label: "Pipeline OS module" },
];

export const OS_RULES: { lead: string; rest: string }[] = [
  {
    lead: "10 a day per inbox",
    rest: "(hamdi@ + amer@) in week 1. Go to 15 each only if bounces stay under 2%, some replies come in, and nothing lands in spam.",
  },
  { lead: "Max 3 risky emails", rest: "per inbox per day." },
  {
    lead: "Every email needs",
    rest: "an approved opener and passes the pre-send check. Never paste scraped text into an opener.",
  },
  { lead: "Any reply stops the sequence.", rest: "Mark it in the CRM the same day." },
  {
    lead: "Calls are not outreach.",
    rest: "Only warm calls (replied, interested, watched the Loom) and a few last-resort calls.",
  },
];

export const OS_AFTER_CLIENT = "Delivery 2h · Email 1h · Meta 30m · US window 30m. Never drop sending to zero.";
