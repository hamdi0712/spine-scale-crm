"use client";

// "Find owners": every email lead waiting on its owner — the name from the
// NPI Registry and the clinic's own site (free), then, for a confirmed owner,
// their address from Hunter or the clinic's pattern, each checked through
// Instantly. The confirm quotes the worst case against what is left of both
// monthly budgets; the job runs on the server in the shared progress panel.

import { useState } from "react";
import { MENU_ITEM } from "@/lib/menuItem";
import { startOwnerJob } from "@/lib/actions/jobs";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";
import { fmtCredits } from "@/lib/emailCheck";

export interface OwnerEstimate {
  count: number;
  hunterMax: number;
  instantlyMax: number;
  hunterLeft: number;
  instantlyLeft: number;
  fits: boolean;
  affordable: number;
  hasKeys: boolean;
}

export default function OwnerFindButton({ estimate }: { estimate: OwnerEstimate }) {
  const { running, track } = useJobRun("find-owners");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const e = estimate;

  async function run() {
    if (!e.hasKeys) {
      setError("Find owners needs a Hunter and an Instantly API key — add them under Settings → API Keys.");
      return;
    }
    const warning = e.fits ? "" : `\n\nThat is more than is left: it will be refused. ${e.affordable} lead${e.affordable === 1 ? "" : "s"} would fit.`;
    if (
      !confirm(
        `Find the owner for ${e.count} email lead${e.count === 1 ? "" : "s"}?\n\n` +
          `Owner names: NPI Registry and the clinic's own site — free.\n` +
          `Owner emails (confirmed owners only): up to ${e.hunterMax} Hunter credit${e.hunterMax === 1 ? "" : "s"} (${fmtCredits(e.hunterLeft)} left this month) and up to ${fmtCredits(e.instantlyMax)} Instantly credits (${fmtCredits(e.instantlyLeft)} left). Hunter charges nothing when it finds nothing, so it is usually less.${warning}`,
      )
    )
      return;
    setError(null);
    setStarting(true);
    const r = await startOwnerJob({}).catch(() => ({ ok: false as const, error: "The run could not be started." }));
    setStarting(false);
    if (!r.ok) setError(r.error);
    else track(r.id);
  }

  return (
    <div>
      <button type="button" onClick={() => void run()} disabled={running || starting || e.count === 0} className={MENU_ITEM}>
        <span>
          {running || starting ? "Finding owners…" : "Find owners"}
          {e.count > 0 && <span className="num ml-1.5 text-muted">{e.count}</span>}
        </span>
        <span className="text-xs font-normal text-muted">
          {e.hasKeys ? "Owner's name from NPI, then their email via Hunter" : "Needs Hunter and Instantly keys — Settings → API Keys"}
        </span>
      </button>
      {error && <p className="px-3 pb-2 text-xs text-bad">{error}</p>}
    </div>
  );
}

export function OwnerFindProgress({ className = "" }: { className?: string }) {
  return <JobProgressFor source="find-owners" className={className} />;
}
