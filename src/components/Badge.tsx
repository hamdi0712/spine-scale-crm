import { Flag } from "@/lib/kpi";
import {
  CHECKLIST_STATUS_LABELS,
  ChecklistStatus,
  CLIENT_STATUS_LABELS,
  ClientStatus,
  LEAD_STAGE_LABELS,
  LeadStage,
} from "@/lib/constants";

// Flat, rectangular badges — no pills, no shadows.

export function StageBadge({ stage }: { stage: string }) {
  const label = LEAD_STAGE_LABELS[stage as LeadStage] ?? stage;
  const cls =
    stage === "WON"
      ? "border-ok/40 text-ok"
      : stage === "LOST"
        ? "border-bad/40 text-bad"
        : "border-line text-muted";
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function ClientStatusBadge({ status }: { status: string }) {
  const label = CLIENT_STATUS_LABELS[status as ClientStatus] ?? status;
  const cls =
    status === "ACTIVE"
      ? "border-ok/40 text-ok"
      : status === "ONBOARDING"
        ? "border-line text-ink"
        : status === "PAUSED"
          ? "border-warn/40 text-warn"
          : "border-bad/40 text-bad";
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function ChecklistStatusBadge({ status }: { status: string }) {
  const label = CHECKLIST_STATUS_LABELS[status as ChecklistStatus] ?? status;
  const cls =
    status === "DONE"
      ? "border-ok/40 text-ok"
      : status === "IN_PROGRESS"
        ? "border-warn/40 text-warn"
        : "border-line text-muted";
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
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

// A metric value colored by its target-band flag, with a small square marker
// so state is not carried by color alone.
export function FlaggedValue({ value, flag }: { value: string; flag: Flag }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono ${FLAG_CLS[flag]}`}>
      {flag !== "na" && (
        <span
          aria-label={flag}
          className={`inline-block h-1.5 w-1.5 ${
            flag === "green" ? "bg-ok" : flag === "yellow" ? "bg-warn" : "bg-bad"
          }`}
        />
      )}
      {value}
    </span>
  );
}
