"use client";

// Checking addresses without an API: export the unchecked ones as a CSV, run
// it through whichever checker you use, and bring the results file back. The
// import reads the usual result words (valid, risky, catch-all, invalid, …)
// and updates each lead; an invalid address moves to the alternates and the
// lead goes back to No email.

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CheckImportSummary, importCheckResults } from "@/lib/actions/emailWorkflow";

export default function EmailCheckFile({ unchecked }: { unchecked: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState<CheckImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function read(file: File) {
    setError(null);
    setSummary(null);
    start(async () => {
      const r = await importCheckResults(await file.text());
      if (!r.ok) setError(r.error);
      else setSummary(r.summary);
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5 max-md:items-stretch">
      <div className="flex flex-wrap items-center gap-2 max-md:[&>*]:flex-1 max-md:[&>*]:justify-center">
        <a
          href="/api/email/check-export"
          download
          className={`btn ${unchecked === 0 ? "pointer-events-none opacity-50" : ""}`}
          aria-disabled={unchecked === 0}
        >
          Export emails to check{unchecked > 0 && <span className="num">({unchecked})</span>}
        </a>
        <button type="button" onClick={() => input.current?.click()} disabled={pending} className="btn disabled:opacity-50">
          {pending ? "Importing…" : "Import check results"}
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) read(f);
          }}
        />
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      {summary && (
        <p className="num text-right text-xs text-muted max-md:text-left">
          {summary.updated} updated: {summary.valid} valid · {summary.risky} risky · {summary.unknown} unknown ·{" "}
          {summary.invalid} invalid (moved to alternates)
          {summary.unmatched.length > 0 && ` · ${summary.unmatched.length} not matched to a lead`}
          {summary.unreadable > 0 && ` · ${summary.unreadable} rows unreadable`}
        </p>
      )}
    </div>
  );
}
