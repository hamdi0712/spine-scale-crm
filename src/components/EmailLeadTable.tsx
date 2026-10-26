"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  EMAIL_LEAD_NEXT,
  EMAIL_LEAD_STATUSES,
  EMAIL_LEAD_STATUS_LABELS,
  EmailLeadStatus,
} from "@/lib/emailChannel";
import { IcpTier } from "@/lib/icp";
import { EmailStatusBadge, IcpTierChip } from "@/components/Badge";

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
}

type Filter = "all" | EmailLeadStatus;

// The Email view of the pipeline: one row per clinic, built around the one
// thing to do next. The chips above it filter by status and count each one,
// all seven always shown so the set reads the same on every visit — a status
// nothing has reached yet simply says 0.
export default function EmailLeadTable({ rows }: { rows: EmailLeadRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c = Object.fromEntries(EMAIL_LEAD_STATUSES.map((s) => [s, 0])) as Record<
      EmailLeadStatus,
      number
    >;
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  // Ordered the way the work flows, left to right; No email last.
  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: rows.length },
    ...EMAIL_LEAD_STATUSES.map((s) => ({
      key: s,
      label: EMAIL_LEAD_STATUS_LABELS[s],
      count: counts[s],
    })),
  ];

  return (
    <div>
      <div className="m-pill-row mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {chips.map((chip) => {
          const on = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              aria-pressed={on}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                on
                  ? "border-accent/40 bg-accent/10 font-medium text-accent"
                  : "border-line bg-surface text-muted hover:text-ink"
              }`}
            >
              {chip.label}
              <span className={`num text-xs ${on ? "opacity-80" : "opacity-60"}`}>{chip.count}</span>
            </button>
          );
        })}
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
                {EMAIL_LEAD_NEXT[row.status]} →
              </p>
            </Link>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="card px-4 py-6 text-center text-sm text-muted">No leads with this status.</li>
        )}
      </ul>

      <div className="card overflow-x-auto max-md:hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Clinic</th>
              <th className="th">Email</th>
              <th className="th">Tier</th>
              <th className="th">Status</th>
              <th className="th">Sequence</th>
              <th className="th">Next</th>
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
                </td>
                <td className="td num text-xs text-muted">{row.sequence}</td>
                <td className="td text-sm font-medium text-ink">{EMAIL_LEAD_NEXT[row.status]}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={6}>
                  No leads with this status.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
