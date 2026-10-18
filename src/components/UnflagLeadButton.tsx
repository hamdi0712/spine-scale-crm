"use client";

// "Un-flag (keep this lead)" on a lead flagged by new scoring: removes the
// flag as a manual override that later applies and reverts respect.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unflagScoringRejectedLead } from "@/lib/actions/scoringApplication";

export default function UnflagLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await unflagScoringRejectedLead(leadId);
            if (!r.ok) setError(r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Un-flagging…" : "Un-flag (keep this lead)"}
      </button>
      <span className="text-xs text-muted">Future applies skip it and a revert leaves it as it is.</span>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
