"use client";

// The owner, on an email lead's page: what the NPI Registry says, whether its
// official is a decision-maker, what the site says, and — when they disagree
// or the site names several doctors — the names to pick between. Picking one
// confirms them and looks for their email (within budget).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pickLeadOwner, findLeadOwner } from "@/lib/actions/ownerFind";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";

export interface OwnerPanelProps {
  leadId: string;
  status: "confirmed" | "pick" | "not_found" | null;
  statusLabel: string;
  // Where a settled owner came from: "set by hand", "confirmed by NPI",
  // "from site", "from the email address". null: not settled.
  basisLabel: string | null;
  sourceLabel: string | null;
  owner: string | null;
  npiNumber: string | null;
  npiOfficial: string | null;
  npiTitle: string | null;
  // The official's title is an office or billing one.
  npiNotDecisionMaker: boolean;
  siteNames: string[];
  choices: string[];
  checkedAt: string | null;
  emailNote: string | null;
  // Settled, but the owner's own address is still to be looked for.
  canFindEmail: boolean;
}

export default function OwnerPanel(p: OwnerPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { track } = useJobRun("find-owners");
  const settled = p.basisLabel !== null;

  function pick(name: string) {
    setError(null);
    startTransition(async () => {
      const r = await pickLeadOwner(p.leadId, name);
      if (!r.ok) setError(r.error);
      else {
        if (r.job.ok) track(r.job.id);
        else if (!/No email lead is waiting/.test(r.job.error)) setError(`Owner saved. The email lookup didn't start: ${r.job.error}`);
        router.refresh();
      }
    });
  }

  function runOne() {
    setError(null);
    startTransition(async () => {
      const r = await findLeadOwner(p.leadId);
      if (!r.ok) setError(r.error);
      else track(r.id);
    });
  }

  return (
    <div className="space-y-2 text-xs leading-relaxed">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Owner: <span className={settled ? "text-ok" : p.status === "pick" ? "text-warn" : "text-muted"}>{p.statusLabel}</span>
          {settled && p.owner && <span className="ml-1.5">{p.owner}</span>}
          {p.basisLabel && <span className="ml-1.5 rounded bg-ok-soft px-1.5 py-0.5 text-xs font-medium text-ok">{p.basisLabel}</span>}
        </p>
        {settled ? (
          <div className="flex items-center gap-2">
            {p.canFindEmail && (
              <button type="button" className="btn !h-7 !px-2.5 !text-xs" disabled={pending} onClick={runOne}>
                Find owner email
              </button>
            )}
            <button type="button" className="text-xs font-medium text-accent hover:underline disabled:opacity-50" disabled={pending} onClick={runOne}>
              Look up again
            </button>
          </div>
        ) : (
          p.status !== "pick" && (
            <button type="button" className="btn !h-7 !px-2.5 !text-xs" disabled={pending} onClick={runOne}>
              {p.checkedAt ? "Find owner email" : "Find owner"}
            </button>
          )
        )}
      </div>
      {p.sourceLabel && <p className="text-muted">{p.sourceLabel}</p>}
      {p.npiNumber ? (
        <p className="text-muted">
          NPI {p.npiNumber}: {p.npiOfficial ?? "no official named"}
          {p.npiTitle ? `, ${p.npiTitle}` : ""}
          {p.npiNotDecisionMaker && <span className="ml-1.5 rounded bg-warn-soft px-1.5 py-0.5 font-medium text-warn">Not a decision-maker</span>}
        </p>
      ) : p.checkedAt ? (
        <p className="text-muted">No NPI Registry record matched this clinic.</p>
      ) : null}
      {p.siteNames.length > 0 && p.status !== "pick" && <p className="text-muted">On the site: {p.siteNames.join(", ")}</p>}
      {p.status === "pick" && (
        <div className="space-y-1.5">
          <p className="text-muted">These don&apos;t agree — who owns the clinic?</p>
          <div className="flex flex-wrap gap-2">
            {p.choices.map((name) => (
              <button key={name} type="button" className="btn !h-7 !px-2.5 !text-xs" disabled={pending} onClick={() => pick(name)}>
                {name}
                {name === p.npiOfficial ? <span className="text-muted"> · NPI</span> : <span className="text-muted"> · site</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {p.emailNote && <p className="text-muted">{p.emailNote}</p>}
      {error && <p className="text-bad">{error}</p>}
      <JobProgressFor source="find-owners" />
    </div>
  );
}
