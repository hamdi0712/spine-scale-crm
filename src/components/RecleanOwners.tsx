"use client";

// Settings → Email: re-read every email lead's stored crawl with today's
// doctor-name cleanup and re-label its addresses. Free — no Hunter or
// Instantly credits — and it lists what it changed.

import Link from "next/link";
import { useState, useTransition } from "react";
import { recleanOwners } from "@/lib/actions/ownerFind";
import type { RecleanResult } from "@/lib/ownerReclean";

export default function RecleanOwners() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RecleanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    start(async () => {
      const r = await recleanOwners();
      if (r.ok) setResult(r.result);
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={pending} className="btn-ghost disabled:opacity-50">
          {pending ? "Re-cleaning…" : "Re-clean owner names & labels"}
        </button>
        <span className="text-xs text-muted">Free — no Hunter or Instantly credits. Owners and labels you set by hand are left alone.</span>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      {result && (
        <div className="space-y-2">
          <p className="text-sm">
            {result.scanned} email lead{result.scanned === 1 ? "" : "s"} read · {result.confirmed} owner{result.confirmed === 1 ? "" : "s"} confirmed ·{" "}
            {result.renamed} name{result.renamed === 1 ? "" : "s"} fixed · {result.relabelled} relabelled
          </p>
          {result.changes.length === 0 ? (
            <p className="text-sm text-muted">Nothing needed changing.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
              {result.changes.map((c, i) => (
                <li key={`${c.leadId}-${i}`}>
                  <Link href={`/pipeline/${c.leadId}`} className="font-medium hover:underline">
                    {c.clinicName}
                  </Link>{" "}
                  <span className="text-muted">— {c.what}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
