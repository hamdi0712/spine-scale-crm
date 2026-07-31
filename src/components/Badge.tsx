import { Flag } from "@/lib/kpi";
import {
  CHECKLIST_STATUS_LABELS,
  ChecklistStatus,
  CLIENT_STATUS_LABELS,
  ClientStatus,
  LEAD_STAGE_LABELS,
  LeadStage,
} from "@/lib/constants";

// Pill-shaped status badges: colored dot on a soft tinted background.

type Tone =
  | "green"
  | "amber"
  | "red"
  | "blue"
  | "purple"
  | "teal"
  | "indigo"
  | "neutral";

const TONE_CLS: Record<Tone, { pill: string; dot: string }> = {
  green: { pill: "bg-ok-soft text-ok", dot: "bg-ok" },
  amber: { pill: "bg-warn-soft text-warn", dot: "bg-warn" },
  red: { pill: "bg-bad-soft text-bad", dot: "bg-bad" },
  blue: { pill: "bg-[#E8F0FE] text-accent", dot: "bg-accent" },
  purple: { pill: "bg-[#F3EDFD] text-[#7C3AED]", dot: "bg-[#7C3AED]" },
  teal: { pill: "bg-[#E2F7F5] text-[#0E9F94]", dot: "bg-[#0E9F94]" },
  indigo: { pill: "bg-[#EDEEFD] text-[#5A5FE0]", dot: "bg-[#5A5FE0]" },
  neutral: { pill: "bg-line/70 text-muted", dot: "bg-muted" },
};

function Pill({ tone, label }: { tone: Tone; label: string }) {
  const cls = TONE_CLS[tone];
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${cls.pill}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls.dot}`} />
      {label}
    </span>
  );
}

const STAGE_TONES: Record<string, Tone> = {
  NEW: "blue",
  CONTACTED: "purple",
  DISCOVERY: "teal",
  PROPOSAL: "indigo",
  NEGOTIATING: "amber",
  WON: "green",
  LOST: "red",
};

export function StageBadge({ stage }: { stage: string }) {
  const label = LEAD_STAGE_LABELS[stage as LeadStage] ?? stage;
  return <Pill tone={STAGE_TONES[stage] ?? "neutral"} label={label} />;
}

export function ClientStatusBadge({ status }: { status: string }) {
  const label = CLIENT_STATUS_LABELS[status as ClientStatus] ?? status;
  const tone: Tone =
    status === "ACTIVE"
      ? "green"
      : status === "PAUSED"
        ? "amber"
        : status === "CHURNED"
          ? "red"
          : "blue";
  return <Pill tone={tone} label={label} />;
}

export function ChecklistStatusBadge({ status }: { status: string }) {
  const label = CHECKLIST_STATUS_LABELS[status as ChecklistStatus] ?? status;
  const tone: Tone =
    status === "DONE" ? "green" : status === "IN_PROGRESS" ? "amber" : "neutral";
  return <Pill tone={tone} label={label} />;
}

const FLAG_CLS: Record<Flag, string> = {
  green: "text-ok",
  yellow: "text-warn",
  red: "text-bad",
  na: "text-muted",
};

// A metric value colored by its target-band flag, with a small dot marker
// so state is not carried by color alone.
export function FlaggedValue({ value, flag }: { value: string; flag: Flag }) {
  return (
    <span className={`num inline-flex items-center gap-1.5 ${FLAG_CLS[flag]}`}>
      {flag !== "na" && (
        <span
          aria-label={flag}
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            flag === "green" ? "bg-ok" : flag === "yellow" ? "bg-warn" : "bg-bad"
          }`}
        />
      )}
      {value}
    </span>
  );
}
