"use client";

// "Run contact finder on queue leads": the one-time backfill for the leads
// that were in the Email queue before the contact finder existed (and any
// that need you since). The confirm shows the count and the worst case it
// could spend; it runs as a normal background job in the progress panel, and
// stops — the lead marked "Out of credits" — rather than go past a budget.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startContactFinderBackfill } from "@/lib/actions/jobs";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";

export interface ContactFinderEstimate {
  count: number;
  hunterMax: number;
  instantlyMax: number;
  deepseekMaxUsd: number;
  facebookMaxUsd: number;
  hunterLeft: number;
  instantlyLeft: number;
}

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

export default function ContactFinderBackfillButton({ estimate }: { estimate: ContactFinderEstimate }) {
  const router = useRouter();
  const { running, track } = useJobRun("contact-finder");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const e = estimate;

  async function run() {
    if (
      !confirm(
        `Run the contact finder on ${e.count} queue lead${e.count === 1 ? "" : "s"}?\n\n` +
          `Worst case (every lead needing every step):\n` +
          `• Hunter: up to ${n(e.hunterMax)} credits (${n(e.hunterLeft)} left this month)\n` +
          `• Instantly: up to ${n(e.instantlyMax)} credits (${n(e.instantlyLeft)} left this month)\n` +
          `• DeepSeek: up to $${e.deepseekMaxUsd.toFixed(2)} (only leads with more than one possible owner)\n` +
          (e.facebookMaxUsd > 0 ? `• Facebook pages (Apify): up to $${e.facebookMaxUsd.toFixed(2)}\n` : "") +
          `\nMost leads stop well short of that: the finder stops at the first good answer. ` +
          `It never goes past a monthly budget — a lead it can't afford is marked "Out of credits" and waits. ` +
          `Nothing is sent or approved.`,
      )
    )
      return;
    setError(null);
    setStarting(true);
    const r = await startContactFinderBackfill().catch(() => ({ ok: false as const, error: "The run could not be started." }));
    setStarting(false);
    if (!r.ok) setError(r.error);
    else track(r.id);
    router.refresh();
  }

  return (
    <div className="card space-y-3 p-6">
      <div>
        <p className="text-sm font-medium">Run contact finder on queue leads</p>
        <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
          Takes the {e.count} lead{e.count === 1 ? "" : "s"} in the Email queue through the contact finder: owner, Hunter, Facebook, Instantly, then
          the Email pipeline, a contact form or the call list. At most {n(e.hunterMax)} Hunter and {n(e.instantlyMax)} Instantly credits and about $
          {e.deepseekMaxUsd.toFixed(2)} of DeepSeek, within this month&apos;s budgets.
        </p>
      </div>
      <div>
        <button type="button" onClick={() => void run()} disabled={running || starting || e.count === 0} className="btn">
          {running || starting ? "Finding contacts…" : "Run contact finder"}
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <JobProgressFor source="contact-finder" />
    </div>
  );
}
