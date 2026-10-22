"use client";

// "Retry failed records" — re-runs only the records a comparison could not
// score into the same run. Progress shows in the page's job panel, the same
// one a full run uses.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startComparisonRetryJob } from "@/lib/actions/jobs";

export default function RetryFailedComparison({ runId, count }: { runId: string; count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await startComparisonRetryJob(runId);
            if (!r.ok) setError(r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Starting…" : `Retry ${count} failed record${count === 1 ? "" : "s"}`}
      </button>
      <span className="text-xs text-muted">Scores only these into this comparison — the rest are kept.</span>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
