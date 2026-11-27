"use client";

// "Retry" on an Email queue lead that needs you: the contact finder runs on it
// again, from the top. Progress shows in the queue's contact finder panel.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryContactFinder } from "@/lib/actions/jobs";
import { useJobRun } from "@/components/JobProgress";

export default function ContactFinderRetryButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const { track } = useJobRun("contact-finder");
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setNote(null);
    setStarting(true);
    const r = await retryContactFinder(leadId).catch(() => ({ ok: false as const, error: "The run could not be started." }));
    setStarting(false);
    if (r.ok) track(r.id);
    else setNote(r.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end">
      <button type="button" className="btn h-8 px-3 text-sm" disabled={starting} onClick={() => void run()}>
        {starting ? "Starting…" : "Retry"}
      </button>
      {note && <p className="mt-1 max-w-xs text-right text-xs text-muted">{note}</p>}
    </div>
  );
}
