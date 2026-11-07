"use client";

// "Re-run openers": unapproves every approved-but-unsent email (its old opener
// kept as a lead note), then regenerates openers under the playbook rules —
// those first, then Needs opener A-tier, then B-tier. Nothing is approved.
// Runs on the server in the shared progress panel.

import { useState } from "react";
import { startOpenerRerun } from "@/lib/actions/jobs";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";
import type { RerunEstimate } from "@/lib/openerRerun";

export default function RerunOpenersButton({ estimate }: { estimate: RerunEstimate }) {
  const { running, track } = useJobRun("rerun-openers");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const total = estimate.reset + estimate.needs;

  async function run() {
    if (
      !confirm(
        `Re-run openers for ${total} lead${total === 1 ? "" : "s"}?\n\n` +
          `${estimate.reset} approved but unsent: unapproved, old opener kept in the lead's notes, regenerated.\n` +
          `${estimate.needs} in Needs opener (A-tier first, then B-tier): generated.\n\n` +
          `Nothing is approved — each opener waits for you. Leads with no cited evidence go to Needs manual opener.\n\n` +
          `DeepSeek cost: up to about $${estimate.maxUsd.toFixed(2)} (two calls per lead at most).`,
      )
    )
      return;
    setError(null);
    setStarting(true);
    const r = await startOpenerRerun().catch(() => ({ ok: false as const, error: "The run could not be started." }));
    setStarting(false);
    if (!r.ok) setError(r.error);
    else track(r.id);
  }

  return (
    <div className="card space-y-3 p-6">
      <div>
        <p className="text-sm font-medium">Re-run openers</p>
        <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
          Regenerates openers under the current rules: {estimate.reset} approved-but-unsent, then {estimate.needs} in
          Needs opener (A, then B). Up to about ${estimate.maxUsd.toFixed(2)}. Save template changes first.
        </p>
      </div>
      <div>
        <button type="button" onClick={() => void run()} disabled={running || starting || total === 0} className="btn">
          {running || starting ? "Re-running openers…" : "Re-run openers"}
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <JobProgressFor source="rerun-openers" />
    </div>
  );
}
