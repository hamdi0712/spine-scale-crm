"use client";

// The Call list: three sections, each a plain list — Warm calls, Form
// follow-up, Last resort. Each row has the clinic, the owner, the phone to tap,
// why it is here, and the three call results, each logged in the activity
// feed. Not a dialer.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logCall } from "@/lib/actions/callList";
import type { CallRow } from "@/lib/emailBucketsRead";
import type { CallSection } from "@/lib/emailBuckets";

const SECTIONS: { key: CallSection; title: string; empty: string }[] = [
  { key: "warm", title: "Warm calls", empty: "Nobody has replied, shown interest or watched the Loom yet." },
  { key: "form_follow_up", title: "Form follow-up", empty: "No contact form is three days old without a reply." },
  { key: "last_resort", title: "Last resort", empty: "Every lead has an email or a contact form." },
];

export default function CallList({ rows }: { rows: CallRow[] }) {
  return (
    <div className="mt-6 flex flex-col gap-8">
      {SECTIONS.map((s) => {
        const list = rows.filter((r) => r.section === s.key);
        return (
          <section key={s.key}>
            <h2 className="text-sm font-semibold">
              {s.title} <span className="num ml-1 text-muted">{list.length}</span>
            </h2>
            {list.length === 0 ? (
              <p className="mt-2 text-xs text-muted">{s.empty}</p>
            ) : (
              <ul className="card mt-2 divide-y divide-line">
                {list.map((r) => (
                  <CallItem key={r.id} row={r} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CallItem({ row }: { row: CallRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function log(kind: string) {
    if (kind === "CALL_NOT_INTERESTED" && !confirm(`Mark ${row.clinicName} not interested? It moves to Lost and goes on the suppression list.`)) return;
    setError(null);
    start(async () => {
      const r = await logCall(row.id, kind);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <Link href={`/pipeline/${row.id}`} className="text-sm font-medium hover:underline">
          {row.clinicName}
        </Link>
        <p className="text-xs text-muted">
          {row.contactName ?? "Owner unknown"} ·{" "}
          {row.phone ? (
            <a href={`tel:${row.phone.replace(/[^\d+]/g, "")}`} className="num text-accent hover:underline">
              {row.phone}
            </a>
          ) : (
            "no phone"
          )}{" "}
          · {row.why}
          {row.lastCall && ` · last: ${row.lastCall.label}, ${new Date(row.lastCall.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
        </p>
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn" disabled={pending} onClick={() => log("CALL_NO_ANSWER")}>
          Called – no answer
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => log("CALL_TALKED")}>
          Talked
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => log("CALL_NOT_INTERESTED")}>
          Not interested
        </button>
      </div>
    </li>
  );
}
