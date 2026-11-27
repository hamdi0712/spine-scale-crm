"use client";

// "Finding contacts for N leads" at the top of the Email queue. Kept live
// while the contact finder runs: the page is read again every few seconds,
// so leads drop off the count (and needs-you leads appear) as they finish.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";

const REFRESH_MS = 8_000;

export default function FindingContactsLine({ count }: { count: number }) {
  const router = useRouter();
  const { running } = useJobRun("contact-finder");

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [running, router]);

  return (
    <div className="mt-6 space-y-3">
      {count > 0 && (
        <p className="flex items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-accent" : "bg-muted"}`} aria-hidden />
          <span className="font-medium">
            Finding contacts for <span className="num">{count}</span> lead{count === 1 ? "" : "s"}
          </span>
          {!running && <span className="text-xs text-muted">· waiting for the next run</span>}
        </p>
      )}
      <JobProgressFor source="contact-finder" />
    </div>
  );
}
