import { Flag } from "@/lib/kpi";
import {
  CONCEPT_STATUS_LABELS,
  ConceptStatus,
  CREATIVE_STATUS_LABELS,
  CREATIVE_TYPE_LABELS,
  CreativeStatus,
  CreativeType,
  RESEARCH_NOTE_TYPE_LABELS,
  ResearchNoteType,
} from "@/lib/adhub";
import { CALL_STATUS_LABELS, CallStatus } from "@/lib/calls";
import {
  DISCOVERY_STATUS_LABELS,
  DISCOVERY_STATUS_MEANINGS,
  DiscoveryStatus,
} from "@/lib/discovery";
import {
  HEALTH_ACTIONS,
  HEALTH_LABELS,
  HealthStatus,
  Trend,
} from "@/lib/health";
import { ICP_TIER_ACTIONS, ICP_TIER_LABELS, IcpTier } from "@/lib/icp";
import Icon from "@/components/Icons";
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

function Pill({
  tone,
  label,
  title,
}: {
  tone: Tone;
  label: string;
  title?: string;
}) {
  const cls = TONE_CLS[tone];
  return (
    <span
      title={title}
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

// A candidate's place in the discovery queue. Blue and teal for work still in
// front of the queue, indigo for scored-but-undecided, green for the one that
// made it through — and neutral for a rejection, because being rejected is a
// decision the framework made and not a fault. Red is kept for Failed, which
// is the only one of the six that means something went wrong.
const DISCOVERY_TONES: Record<DiscoveryStatus, Tone> = {
  PENDING: "blue",
  ENRICHING: "teal",
  SCORED: "indigo",
  PROMOTED: "green",
  REJECTED: "neutral",
  FAILED: "red",
};

export function DiscoveryStatusBadge({ status }: { status: string }) {
  const known = status as DiscoveryStatus;
  const label = DISCOVERY_STATUS_LABELS[known] ?? status;
  return (
    <Pill
      tone={DISCOVERY_TONES[known] ?? "neutral"}
      label={label}
      title={DISCOVERY_STATUS_MEANINGS[known]}
    />
  );
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

const TIER_TONES: Record<IcpTier, Tone> = {
  A: "green",
  B: "amber",
  C: "neutral",
  DISQUALIFIED: "red",
};

// The tier's colour on its own, for anything that needs to mark a tier without
// wearing a whole badge — the dots on Discovery's tier quick-filters. Read off
// the same table the badges use, so a tier is never two different greens.
export function icpTierDot(tier: IcpTier): string {
  return TONE_CLS[TIER_TONES[tier]].dot;
}

// Renders nothing for a lead that has never been scored — absence of a tier
// is not a C-tier.
//
// The compact views (Kanban cards, pipeline table) carry the tier's action as
// a hover title so it costs no space. Pass tooltip={false} where the action is
// already spelled out on screen.
export function IcpTierBadge({
  tier,
  tooltip = true,
}: {
  tier: IcpTier | null | undefined;
  tooltip?: boolean;
}) {
  if (!tier) return null;
  const action = ICP_TIER_ACTIONS[tier];
  return (
    <Pill
      tone={TIER_TONES[tier]}
      label={ICP_TIER_LABELS[tier]}
      title={tooltip && action ? action : undefined}
    />
  );
}

// The score, big enough to read across a grid of cards — the number itself,
// with the tier's mark beside it and the tier's colour behind both.
//
// It carries the tier rather than repeating it in words: A green and burning,
// B amber and warm, C grey and cold, disqualified red and struck out. The
// status pill on the same card is what says where the candidate got to; this
// says how good it is, and the two never mean the same thing.
//
// A candidate nobody has scored gets a dash on the same neutral ground as a
// C-tier — deliberately quiet — because "not scored" is not a low score, and
// the title spells that out for anybody who hovers it.
const TIER_MARKS: Record<IcpTier, string> = {
  A: "flame",
  B: "sun",
  C: "snowflake",
  DISQUALIFIED: "ban",
};

export function IcpScoreBadge({
  tier,
  total,
  max,
}: {
  tier: IcpTier | null | undefined;
  total: number | null | undefined;
  max: number;
}) {
  const scored = total != null && tier != null;
  const cls = TONE_CLS[scored ? TIER_TONES[tier] : "neutral"];
  const action = scored ? ICP_TIER_ACTIONS[tier] : null;
  return (
    <span
      title={
        scored
          ? `${total} of ${max} — ${ICP_TIER_LABELS[tier]}${action ? `. ${action}` : ""}`
          : "Not scored yet — the next queue run decides this one"
      }
      className={`inline-flex h-[28px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 ${cls.pill}`}
    >
      {scored && (
        <Icon name={TIER_MARKS[tier]} className="h-[15px] w-[15px]" />
      )}
      <span className="num text-sm font-semibold leading-none">
        {scored ? total : "—"}
      </span>
      <span className="sr-only">
        {scored ? `out of ${max}, ${ICP_TIER_LABELS[tier]}` : "not scored yet"}
      </span>
    </span>
  );
}

// Ramping is the deliberate fourth colour: a client with too little reported
// history is neither good news nor bad, and painting it green or red would be
// inventing a reading the numbers do not support.
const HEALTH_TONES: Record<HealthStatus, Tone> = {
  HEALTHY: "green",
  NEEDS_ATTENTION: "amber",
  AT_RISK: "red",
  RAMPING: "neutral",
};

export function HealthBadge({
  status,
  reason,
}: {
  status: HealthStatus;
  reason?: string;
}) {
  return (
    <Pill
      tone={HEALTH_TONES[status]}
      label={HEALTH_LABELS[status]}
      title={reason ?? HEALTH_ACTIONS[status]}
    />
  );
}

const TREND_ICONS: Record<Trend, string> = {
  up: "arrowUp",
  down: "arrowDown",
  flat: "arrowRight",
};

const TREND_TITLES: Record<Trend, string> = {
  up: "Show rate up on the previous reported week",
  down: "Show rate down on the previous reported week",
  flat: "Show rate flat against the previous reported week",
};

// Direction of travel beside the badge. Colour is intentionally muted: the
// badge says how things are, this says which way they are going, and a green
// arrow on a red badge would fight it.
export function TrendArrow({ trend }: { trend: Trend | null }) {
  if (!trend) return null;
  return (
    <span
      title={TREND_TITLES[trend]}
      className={`inline-flex items-center ${
        trend === "up" ? "text-ok" : trend === "down" ? "text-bad" : "text-muted"
      }`}
    >
      <Icon name={TREND_ICONS[trend]} className="h-3.5 w-3.5" />
      <span className="sr-only">{TREND_TITLES[trend]}</span>
    </span>
  );
}

const CALL_TONES: Record<string, Tone> = {
  SCHEDULED: "blue",
  COMPLETED: "green",
  NO_SHOW: "red",
  CANCELLED: "neutral",
};

export function CallStatusBadge({ status }: { status: string }) {
  const label = CALL_STATUS_LABELS[status as CallStatus] ?? status;
  return <Pill tone={CALL_TONES[status] ?? "neutral"} label={label} />;
}

export function ChecklistStatusBadge({ status }: { status: string }) {
  const label = CHECKLIST_STATUS_LABELS[status as ChecklistStatus] ?? status;
  const tone: Tone =
    status === "DONE" ? "green" : status === "IN_PROGRESS" ? "amber" : "neutral";
  return <Pill tone={tone} label={label} />;
}

// ─── Ad Hub ────────────────────────────────────────────────────────────────

// Concepts follow the client-status convention: green live, amber held, red
// stopped, blue-free neutral for something not started yet.
const CONCEPT_TONES: Record<ConceptStatus, Tone> = {
  DRAFT: "neutral",
  ACTIVE: "green",
  PAUSED: "amber",
  KILLED: "red",
};

export function ConceptStatusBadge({ status }: { status: string }) {
  const label = CONCEPT_STATUS_LABELS[status as ConceptStatus] ?? status;
  return <Pill tone={CONCEPT_TONES[status as ConceptStatus] ?? "neutral"} label={label} />;
}

// A creative walks a longer road than a concept, so the tones track the stage
// it is at: amber while it is being checked, blue once cleared, teal live,
// purple under test, then the verdict in green or red.
const CREATIVE_TONES: Record<CreativeStatus, Tone> = {
  DRAFT: "neutral",
  COMPLIANCE_REVIEW: "amber",
  READY: "blue",
  LAUNCHED: "teal",
  TESTING: "purple",
  WINNER: "green",
  LOSER: "red",
};

export function CreativeStatusBadge({ status }: { status: string }) {
  const label = CREATIVE_STATUS_LABELS[status as CreativeStatus] ?? status;
  return <Pill tone={CREATIVE_TONES[status as CreativeStatus] ?? "neutral"} label={label} />;
}

// A persona has no status of its own — this renders the rollup from its
// concepts, and nothing at all for a persona with none.
export function PersonaRollupBadge({
  status,
}: {
  status: ConceptStatus | null;
}) {
  if (!status) return null;
  return (
    <Pill
      tone={CONCEPT_TONES[status]}
      label={CONCEPT_STATUS_LABELS[status]}
      title={`Strongest state across this persona's concepts: ${CONCEPT_STATUS_LABELS[status]}`}
    />
  );
}

// Type is a fact about the creative, not a state, so it gets a flat chip
// rather than a status dot.
export function CreativeTypeChip({ type }: { type: string }) {
  const label = CREATIVE_TYPE_LABELS[type as CreativeType] ?? type;
  return (
    <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full bg-wash px-2.5 text-xs font-medium text-muted">
      {label}
    </span>
  );
}

export function ResearchTypeChip({ type }: { type: string }) {
  const label = RESEARCH_NOTE_TYPE_LABELS[type as ResearchNoteType] ?? type;
  return (
    <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full bg-wash px-2.5 text-xs font-medium text-muted">
      {label}
    </span>
  );
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
