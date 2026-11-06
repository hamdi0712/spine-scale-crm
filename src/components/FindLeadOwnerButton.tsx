"use client";

// "Find this owner's email": Find owners for one lead, right away, within
// budget. Progress shows in the shared Find owners panel.

import { useState } from "react";
import { findLeadOwner } from "@/lib/actions/ownerFind";
import { useJobRun } from "@/components/JobProgress";

export default function FindLeadOwnerButton({ leadId }: { leadId: string }) {
  const { running, track } = useJobRun("find-owners");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setStarting(true);
    const r = await findLeadOwner(leadId).catch(() => ({ ok: false as const, error: "The run could not be started." }));
    setStarting(false);
    if (!r.ok) setError(r.error);
    else track(r.id);
  }

  return (
    <div className="flex flex-col items-end">
      <button type="button" className="btn h-8 px-3 text-sm" disabled={running || starting} onClick={() => void run()}>
        {starting ? "Starting…" : "Find this owner's email"}
      </button>
      {error && <p className="mt-1 max-w-xs text-right text-xs text-bad">{error}</p>}
    </div>
  );
}
