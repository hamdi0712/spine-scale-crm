"use client";

// "Find emails on Facebook": every email lead with no address whose Facebook
// page has not been read yet — the website first, then the page. The confirm
// quotes the rough Apify cost; the job runs on the server and shows in the
// shared progress panel.

import { useState } from "react";
import { startFacebookEmailJob } from "@/lib/actions/jobs";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";
import { facebookEmailsCost, fmtEstimate } from "@/lib/pipelineSettings";

export default function FacebookEmailButton({ count, enabled }: { count: number; enabled: boolean }) {
  const { running, track } = useJobRun("facebook-emails");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function run() {
    if (!enabled) {
      setError("Facebook page emails is off — turn it on under Settings → Pipeline.");
      return;
    }
    if (
      !confirm(
        `Read ${count} Facebook page${count === 1 ? "" : "s"} for an email? Rough Apify cost: ${fmtEstimate(facebookEmailsCost(count))} (one page each). Any address found is checked through Instantly afterwards.`,
      )
    )
      return;
    setError(null);
    setStarting(true);
    const r = await startFacebookEmailJob().catch(() => ({ ok: false as const, error: "The run could not be started." }));
    setStarting(false);
    if (!r.ok) setError(r.error);
    else track(r.id);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={running || starting || count === 0}
        title={enabled ? undefined : "Off — turn it on under Settings → Pipeline"}
        className="btn disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running || starting ? "Reading pages…" : "Find emails on Facebook"}
        {count > 0 && <span className="num">({count})</span>}
      </button>
      {error && <p className="max-w-sm text-xs text-bad">{error}</p>}
    </div>
  );
}

export function FacebookEmailProgress({ className = "" }: { className?: string }) {
  return <JobProgressFor source="facebook-emails" className={className} />;
}
