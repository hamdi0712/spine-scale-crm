"use client";

// Starts an email check through Instantly: every unchecked address from the
// Email view, or one lead's ("Check email" / "Check again"). The confirm
// quotes the credits it will take against what is left of this month's
// budget; the job runs on the server and shows in the shared progress panel.

import { useState } from "react";
import { MENU_ITEM } from "@/lib/menuItem";
import { startEmailCheckJob } from "@/lib/actions/jobs";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";
import { fmtCredits } from "@/lib/emailCheck";

export default function EmailCheckButton({
  label,
  count,
  leadIds = null,
  force = false,
  perCheck,
  used,
  budget,
  hasKey,
  compact = false,
  menu = false,
}: {
  label: string;
  count: number;
  leadIds?: string[] | null;
  force?: boolean;
  perCheck: number;
  used: number;
  budget: number;
  hasKey: boolean;
  compact?: boolean;
  // An item in the pipeline's Find emails menu rather than a button of its own.
  menu?: boolean;
}) {
  const { running, track } = useJobRun("email-check");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const needed = count * perCheck;
  const left = Math.max(0, budget - used);

  async function run() {
    if (!hasKey) {
      setError("No Instantly API key — add one under Settings → API Keys.");
      return;
    }
    if (
      !confirm(
        `Check ${count} email${count === 1 ? "" : "s"} through Instantly? About ${fmtCredits(needed)} credit${needed === 1 ? "" : "s"} (${fmtCredits(perCheck)} per check) — ${fmtCredits(used)} of ${budget} used this month, ${fmtCredits(left)} left.${needed > left ? "\n\nThat is more than is left: it will be refused." : ""}`,
      )
    )
      return;
    setError(null);
    setStarting(true);
    const r = await startEmailCheckJob({ leadIds, force }).catch(() => ({ ok: false as const, error: "The check could not be started." }));
    setStarting(false);
    if (!r.ok) setError(r.error);
    else track(r.id);
  }

  if (menu) {
    return (
      <div>
        <button type="button" onClick={() => void run()} disabled={running || starting || count === 0} className={MENU_ITEM}>
          <span>
            {running || starting ? "Checking…" : label}
            {count > 0 && <span className="num ml-1.5 text-muted">{count}</span>}
          </span>
          <span className="text-xs font-normal text-muted">Verify new addresses through Instantly</span>
        </button>
        {error && <p className="px-3 pb-2 text-xs text-bad">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={running || starting || count === 0}
        className={`btn ${compact ? "h-8 px-2.5 text-xs" : ""} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {running || starting ? "Checking…" : label}
        {!compact && count > 0 && leadIds === null && <span className="num">({count})</span>}
      </button>
      {error && <p className="max-w-sm text-xs text-bad">{error}</p>}
    </div>
  );
}

export function EmailCheckProgress({ className = "" }: { className?: string }) {
  return <JobProgressFor source="email-check" className={className} />;
}
