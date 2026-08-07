"use client";

// The discovery list — the pipeline table's pattern, pointed at candidates.
//
// Search, a status filter, sortable columns, a checkbox per row and one in the
// header, and a bar that rides the top of the screen once anything is
// selected. All of it works the way it does on the pipeline table and for the
// same reasons, including the one that matters: selection only ever covers
// rows currently on screen, so filtering something out of view takes it out of
// the selection too, and a delete can never reach past the list somebody was
// looking at.
//
// The one bulk action here is delete. There is deliberately no bulk promote —
// promotion is what the queue decides, and the one override on it is a single
// button on a single rejected candidate, where the reasoning being overruled
// is on screen next to it.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  DISCOVERY_STATUSES,
  DISCOVERY_STATUS_LABELS,
  DiscoveryStatus,
} from "@/lib/discovery";
import { deleteDiscoveryCandidates } from "@/lib/actions/discovery";
import { ICP_MAX_SCORE, ICP_TIER_ORDER, IcpTier } from "@/lib/icp";
import { fmtDate } from "@/lib/format";
import { DiscoveryStatusBadge, IcpTierBadge } from "@/components/Badge";

export interface DiscoveryRow {
  id: string;
  clinicName: string;
  contactName: string | null;
  source: string | null;
  location: string | null;
  status: string;
  icpTotal: number | null;
  icpTier: IcpTier | null;
  // Whichever sentence applies to this row's status, already chosen on the
  // server — the table shows one line of "why" and links to the rest.
  reason: string | null;
  promotedLeadId: string | null;
  createdAt: string;
}

type SortKey = "clinicName" | "status" | "icpTier" | "icpTotal" | "createdAt";

export default function DiscoveryTable({ rows }: { rows: DiscoveryRow[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  // Selection is state and nothing else — no URL, no storage — so navigating
  // away or refreshing starts again with nothing selected, which is the only
  // safe default for a set of rows with a delete button pointed at them.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const allRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.clinicName, r.contactName, r.source, r.location]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q));
    });
    const statusOrder = (s: string) =>
      DISCOVERY_STATUSES.indexOf(s as DiscoveryStatus);
    // Unscored candidates sort after every tier — they carry no tier to rank.
    const tierOrder = (t: IcpTier | null) =>
      t == null ? ICP_TIER_ORDER.length : ICP_TIER_ORDER.indexOf(t);
    return filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "clinicName":
          cmp = a.clinicName.localeCompare(b.clinicName);
          break;
        case "status":
          cmp = statusOrder(a.status) - statusOrder(b.status);
          break;
        case "icpTier":
          cmp = tierOrder(a.icpTier) - tierOrder(b.icpTier);
          break;
        case "icpTotal":
          cmp = (a.icpTotal ?? -1) - (b.icpTotal ?? -1);
          break;
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return cmp * sortDir;
    });
  }, [rows, query, statusFilter, sortKey, sortDir]);

  const chosen = visible.filter((r) => selected.has(r.id));
  const allChosen = visible.length > 0 && chosen.length === visible.length;

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = chosen.length > 0 && !allChosen;
    }
  }, [chosen.length, allChosen]);

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of visible) {
        if (on) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  function bulkDelete() {
    const ids = chosen.map((r) => r.id);
    if (ids.length === 0) return;
    const promoted = chosen.filter((r) => r.promotedLeadId !== null).length;
    if (
      !confirm(
        `Delete ${ids.length} candidate${ids.length === 1 ? "" : "s"}? This cannot be undone.${
          promoted > 0
            ? `\n\n${promoted} of them ${promoted === 1 ? "has" : "have"} already been promoted — ${promoted === 1 ? "that lead stays" : "those leads stay"} in the pipeline, only the discovery record goes.`
            : ""
        }`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteDiscoveryCandidates(ids);
      // Cleared on the way out rather than on the way in, so a failed action
      // leaves the selection to try again with.
      setSelected(new Set());
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function SortTh({ k, children }: { k: SortKey; children: React.ReactNode }) {
    return (
      <th className="th">
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className="inline-flex items-center gap-1 hover:text-ink"
        >
          {children}
          {sortKey === k && <span aria-hidden>{sortDir === 1 ? "↑" : "↓"}</span>}
        </button>
      </th>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clinic, contact, source, location…"
          className="field max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="field w-auto"
        >
          <option value="ALL">All statuses</option>
          {DISCOVERY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DISCOVERY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="num ml-auto text-xs text-muted">
          {visible.length} candidate{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {chosen.length > 0 && (
        <div className="sticky top-0 z-20 mb-3">
          <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="num text-sm font-medium">
              {chosen.length} selected
            </span>
            <button
              type="button"
              onClick={bulkDelete}
              disabled={pending}
              className="btn-danger disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete selected
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={pending}
              className="btn-ghost ml-auto disabled:opacity-50"
            >
              {pending ? "Working…" : "Clear selection"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th w-[44px]">
                <input
                  ref={allRef}
                  type="checkbox"
                  checked={allChosen}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="Select every candidate in this list"
                  className="h-4 w-4 shrink-0 accent-accent"
                />
              </th>
              <SortTh k="clinicName">Clinic</SortTh>
              <th className="th">Contact</th>
              <th className="th">Source</th>
              <SortTh k="status">Status</SortTh>
              <SortTh k="icpTier">ICP tier</SortTh>
              <SortTh k="icpTotal">Score</SortTh>
              <th className="th">Why</th>
              <SortTh k="createdAt">Imported</SortTh>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                className={selected.has(row.id) ? "bg-accent/5" : "hover:bg-wash/70"}
              >
                <td className="td">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={(e) => toggleOne(row.id, e.target.checked)}
                    aria-label={`Select ${row.clinicName}`}
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                </td>
                <td className="td">
                  <Link
                    href={`/discovery/${row.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {row.clinicName}
                  </Link>
                </td>
                <td className="td text-muted">{row.contactName ?? "—"}</td>
                <td className="td text-muted">{row.source ?? "—"}</td>
                <td className="td">
                  <DiscoveryStatusBadge status={row.status} />
                </td>
                <td className="td">
                  {row.icpTier ? (
                    <IcpTierBadge tier={row.icpTier} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="td num">
                  {row.icpTotal != null ? (
                    <>
                      {row.icpTotal}
                      <span className="text-xs text-muted"> / {ICP_MAX_SCORE}</span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                {/* One line of it, with the whole thing a click away. A
                    rejection nobody can see the reason for is the same as no
                    reason at all. */}
                <td className="td max-w-[280px] text-xs text-muted">
                  {row.reason ? (
                    <span className="line-clamp-2" title={row.reason}>
                      {row.reason}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="td num text-xs text-muted">
                  {fmtDate(row.createdAt)}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={9}>
                  No candidates match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
