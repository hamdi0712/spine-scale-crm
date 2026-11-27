"use client";

// The owner, on an email lead's page: who owns the clinic and where that came
// from, how sure the contact finder is, the finder's latest run on one line,
// and one button — "Re-run contact finder" — whose differences from the lead
// are shown side by side and replaced only when you say so. Picking an owner
// by hand is the Contact field in the lead's details.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replaceWithLookup, keepAfterLookup } from "@/lib/actions/ownerFind";
import { lookUpContactAgain } from "@/lib/actions/jobs";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";
import type { ContactFinderPanel } from "@/lib/contactFinder";

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
  // The contact finder's side (src/lib/contactFinder.ts).
  finder: ContactFinderPanel | null;
}

export default function OwnerPanel(p: OwnerPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const finderRun = useJobRun("contact-finder");
  const settled = p.basisLabel !== null;
  const f = p.finder;

  // "Re-run contact finder": the finder on this lead, proposing only — what
  // it finds that differs is shown beside what is on the lead, and nothing is
  // replaced until you press Replace.
  function rerun() {
    setError(null);
    startTransition(async () => {
      const r = await lookUpContactAgain(p.leadId);
      if (!r.ok) setError(r.error);
      else finderRun.track(r.id);
    });
  }

  function decide(replace: boolean) {
    setError(null);
    startTransition(async () => {
      const r = replace ? await replaceWithLookup(p.leadId) : await keepAfterLookup(p.leadId);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 text-xs leading-relaxed">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Owner: <span className={settled ? "text-ok" : "text-muted"}>{p.statusLabel}</span>
          {settled && p.owner && <span className="ml-1.5">{p.owner}</span>}
          {p.basisLabel && <span className="ml-1.5 rounded bg-ok-soft px-1.5 py-0.5 text-xs font-medium text-ok">{p.basisLabel}</span>}
          {f?.confidence === "high" && <span className="ml-1.5 rounded bg-ok-soft px-1.5 py-0.5 text-xs font-medium text-ok">High confidence</span>}
          {f?.confidence === "low" && (
            <span className="ml-1.5 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn" title="The contact finder isn't sure this is the owner, so the email names nobody.">
              Low confidence — the email names nobody
            </span>
          )}
        </p>
        <button type="button" className="btn !h-7 !px-2.5 !text-xs" disabled={pending || finderRun.running} onClick={rerun}>
          {finderRun.running ? "Running…" : "Re-run contact finder"}
        </button>
      </div>
      {f?.traceLine && (
        <p className="text-muted" title="The contact finder's latest run">
          {f.traceLine}
        </p>
      )}
      {f?.ownerPick && (
        <p className="text-muted">
          AI: {f.ownerPick.reason}
          {f.ownerPick.quote && <span className="italic"> — “{f.ownerPick.quote}”</span>}
        </p>
      )}
      {f?.proposal && (
        <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-3 py-2.5">
          <p className="font-medium text-ink">Look up again found something different</p>
          <div className="mt-1.5 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1">
            <span />
            <span className="text-muted">On the lead</span>
            <span className="text-muted">Found</span>
            {f.proposal.owner && (
              <>
                <span className="text-muted">Owner</span>
                <span>{f.proposal.owner.current ?? "—"}</span>
                <span className="font-medium">
                  {f.proposal.owner.found} <span className="text-muted">({f.proposal.owner.confidence} confidence)</span>
                </span>
              </>
            )}
            {f.proposal.email && (
              <>
                <span className="text-muted">Email</span>
                <span>{f.proposal.email.current ?? "—"}</span>
                <span className="font-medium">
                  {f.proposal.email.found} <span className="text-muted">({f.proposal.email.status ?? "unchecked"})</span>
                </span>
              </>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn !h-7 !px-2.5 !text-xs" disabled={pending} onClick={() => decide(true)}>
              Replace
            </button>
            <button type="button" className="btn !h-7 !px-2.5 !text-xs" disabled={pending} onClick={() => decide(false)}>
              Keep
            </button>
          </div>
        </div>
      )}
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
      {p.siteNames.length > 0 && <p className="text-muted">On the site: {p.siteNames.join(", ")}</p>}
      {p.emailNote && <p className="text-muted">{p.emailNote}</p>}
      {error && <p className="text-bad">{error}</p>}
      <JobProgressFor source="contact-finder" />
    </div>
  );
}
