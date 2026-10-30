"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { EMAIL_LEAD_NEXT, EmailLeadStatus } from "@/lib/emailChannel";
import { IcpTier } from "@/lib/icp";
import { EmailToSend, inboxShort } from "@/lib/emailWorkflow";
import { EmailStatusBadge, IcpTierChip } from "@/components/Badge";
import EmailSendButtons from "@/components/EmailSendButtons";

export interface EmailLeadRow {
  id: string;
  clinicName: string;
  contactName: string | null;
  location: string | null;
  email: string | null;
  // "Owner · Valid", "Front desk · Not checked". Null without an address.
  emailDetail: string | null;
  icpTier: IcpTier | null;
  icpVerdict: string | null;
  icpScore: string | null;
  status: EmailLeadStatus;
  sequence: string;
  // The email to send now — Email 1 once Ready, or the follow-up that is due —
  // with its buttons on the row. Null for everything else.
  toSend: EmailToSend | null;
  // There is one, but it cannot go yet (no inbox, nobody to sign it as).
  sendBlocked: string | null;
  followUpDueToday: boolean;
  // The inbox it is sent from, and what that inbox has sent today.
  inbox: string | null;
  inboxSentToday: number;
  inboxLimit: number;
}

// Six tabs rather than a chip per status: the statuses grouped by what the
// work is. "Needs work" is everything waiting on the operator before it can be
// sent; "Done" is everything the sequence has finished with, one way or
// another. Due today cuts across them (every lead in it is In sequence).
type Filter = "all" | "ready" | "due" | "work" | "sequence" | "done";

const FILTER_STATUSES: Record<Exclude<Filter, "all" | "due">, EmailLeadStatus[]> = {
  ready: ["ready"],
  work: ["needs_opener", "check_email", "check_contact", "no_email"],
  sequence: ["in_sequence"],
  done: ["replied", "stopped", "not_ab"],
};

function matches(row: EmailLeadRow, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "due") return row.followUpDueToday;
  return FILTER_STATUSES[filter].includes(row.status);
}

// The Email view of the pipeline: one row per clinic, built around the one
// thing to do next. Every tab is always shown with its count, so the set
// reads the same on every visit. Due today opens first when there is any:
// it is the work that cannot wait.
export default function EmailLeadTable({ rows }: { rows: EmailLeadRow[] }) {
  const due = rows.filter((r) => r.followUpDueToday).length;
  const [filter, setFilter] = useState<Filter>(due > 0 ? "due" : "all");
  const [query, setQuery] = useState("");

  const tabs = useMemo(
    () =>
      (
        [
          ["all", "All"],
          ["ready", "Ready"],
          ["due", "Due today"],
          ["work", "Needs work"],
          ["sequence", "In sequence"],
          ["done", "Done"],
        ] as [Filter, string][]
      ).map(([key, label]) => ({ key, label, count: rows.filter((r) => matches(r, key)).length })),
    [rows],
  );

  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      matches(r, filter) &&
      (q === "" ||
        [r.clinicName, r.contactName, r.location, r.email].some((v) => (v ?? "").toLowerCase().includes(q))),
  );

  return (
    <div className="md:card md:overflow-hidden">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 md:mb-0 md:border-b md:border-line/60 md:px-4 md:py-3">
        <div className="m-pill-row flex flex-wrap items-center gap-1" role="group" aria-label="Filter">
          {tabs.map((tab) => {
            const on = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                aria-pressed={on}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                  on ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-wash hover:text-ink"
                }`}
              >
                {tab.label}
                <span className={`num text-xs ${on ? "opacity-90" : "opacity-70"}`}>{tab.count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative flex w-full items-center md:w-60">
          <span className="sr-only">Search clinics</span>
          <IconSearch size={15} stroke={2} aria-hidden className="pointer-events-none absolute left-3 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clinics"
            className="field h-9 w-full pl-9 text-sm"
          />
        </label>
      </div>

      {/* A phone gets a card per clinic: who, the address, the status and the
          next move. Tier and sequence are on the desktop table and the lead. */}
      <ul className="space-y-2.5 md:hidden">
        {shown.map((row) => (
          <li key={row.id}>
            <Link href={`/pipeline/${row.id}`} className="card card-interactive block p-3.5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-[15px] font-medium leading-snug text-ink">
                  {row.clinicName}
                </span>
                <EmailStatusBadge status={row.status} />
              </div>
              <p className={`mt-1 truncate text-sm ${row.email ? "text-ink/80" : "text-muted"}`}>
                {row.email ?? "No email yet"}
              </p>
              <p className="mt-2 text-xs font-medium text-accent">
                {row.followUpDueToday ? "Send the follow-up" : EMAIL_LEAD_NEXT[row.status]} →
              </p>
            </Link>
            {row.toSend && (
              <div className="mt-2 px-1">
                <EmailSendButtons leadId={row.id} toSend={row.toSend} inboxSentToday={row.inboxSentToday} inboxLimit={row.inboxLimit} compact />
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && (
          <li className="card px-4 py-6 text-center text-sm text-muted">
            {q ? "No clinic matches that search." : "Nothing here right now."}
          </li>
        )}
      </ul>

      <div className="overflow-x-auto max-md:hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Clinic</th>
              <th className="th">Email</th>
              <th className="th">Tier</th>
              <th className="th">Status</th>
              <th className="th text-right">Next step</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} className="hover:bg-wash/70">
                <td className="td">
                  <Link href={`/pipeline/${row.id}`} className="font-medium text-ink hover:underline">
                    {row.clinicName}
                  </Link>
                  <div className="mt-0.5 text-xs text-muted">
                    {[row.contactName ?? "No contact yet", row.location].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="td">
                  {row.email ? (
                    <>
                      <div className="break-all text-sm text-ink">{row.email}</div>
                      {row.emailDetail && (
                        <div className="mt-0.5 text-xs text-muted">{row.emailDetail}</div>
                      )}
                      {row.inbox && <div className="mt-0.5 text-xs text-muted">from {inboxShort(row.inbox)}</div>}
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="td">
                  {row.icpTier || row.icpVerdict ? (
                    <IcpTierChip tier={row.icpTier} verdict={row.icpVerdict} score={row.icpScore} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="td">
                  <EmailStatusBadge status={row.status} />
                  <div className="num mt-1 text-xs text-muted">{row.sequence}</div>
                </td>
                <td className="td text-right">
                  {row.sendBlocked && !row.toSend ? (
                    <span className="text-xs text-bad">{row.sendBlocked}</span>
                  ) : row.toSend ? (
                    <div className="flex justify-end">
                      <EmailSendButtons leadId={row.id} toSend={row.toSend} inboxSentToday={row.inboxSentToday} inboxLimit={row.inboxLimit} compact />
                    </div>
                  ) : (
                    <Link href={`/pipeline/${row.id}`} className="btn h-8 whitespace-nowrap px-3 text-xs">
                      {EMAIL_LEAD_NEXT[row.status]}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={5}>
                  {q ? "No clinic matches that search." : "Nothing here right now."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
