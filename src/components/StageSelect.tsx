"use client";

// The lead's stage, in the page header: a change is saved the moment it is
// picked, through the same action the board's drag uses.

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import { moveLeadStage } from "@/lib/actions/leads";

export default function StageSelect({ leadId, stage }: { leadId: string; stage: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Stage
      <select
        key={stage}
        defaultValue={stage}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            await moveLeadStage(leadId, next);
            router.refresh();
          });
        }}
        className="field h-9 !w-36 py-0 text-sm font-medium text-ink disabled:opacity-60"
      >
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>
            {LEAD_STAGE_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
