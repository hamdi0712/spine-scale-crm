"use client";

// The discovery list — cards by default, the table a press away.
//
// Discovery is read differently from the pipeline. The pipeline answers "who
// is where, what is due", which is a table's question; Discovery answers "is
// this one any good", which is a score, a status and four facts about a
// clinic — so it opens as a grid of cards with the score big enough to read
// across the whole page, and the table is there for the moments when the
// answer is a sort or a scan down one column. The pipeline is untouched and
// still opens as a table.
//
// Search, the filters, the sort, the selection and the view are all one piece
// of state living here, which is why the toggle is a button rather than a link
// like the pipeline's: switching from cards to table keeps the search you
// typed and the tier you filtered to, and a navigation would throw both away.
//
// Selection only ever covers rows currently on screen — in either view — so
// filtering something out of view takes it out of the selection too, and a
// delete can never reach past the list somebody was looking at.
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
import {
  BATCH_ALL,
  BATCH_NONE,
  batchOptions,
} from "@/lib/discoveryBatch";
import { SOURCE_ALL, sourceKey, sourceOptions } from "@/lib/discoverySource";
import { deleteDiscoveryCandidates } from "@/lib/actions/discovery";
import {
  ICP_MAX_SCORE,
  ICP_TIER_ACTIONS,
  ICP_TIER_LABELS,
  ICP_TIER_ORDER,
  IcpTier,
} from "@/lib/icp";
import { fmtDate } from "@/lib/format";
import {
  DiscoveryStatusBadge,
  IcpScoreBadge,
  IcpTierBadge,
  icpTierDot,
} from "@/components/Badge";
import Icon from "@/components/Icons";

export interface DiscoveryRow {
  id: string;
  clinicName: string;
  contactName: string | null;
  source: string | null;
  location: string | null;
  email: string | null;
  // The run this one arrived on. Null for anything imported before batches
  // existed, which the filter offers as a group of its own.
  batchLabel: string | null;
  status: string;
  icpTotal: number | null;
  icpTier: IcpTier | null;
  // Whichever sentence applies to this row's status, already chosen on the
  // server — the list shows one line of "why" and links to the rest.
  reason: string | null;
  promotedLeadId: string | null;
  createdAt: string;
}

type SortKey = "clinicName" | "status" | "icpTier" | "icpTotal" | "createdAt";

// The three the quick-filters offer. Disqualified is deliberately not one of
// them: it is not a tier anybody goes looking through, it has its own page,
// and a fourth button would make the row read as a legend rather than a filter.
const QUICK_TIERS: IcpTier[] = ["A", "B", "C"];

export default function DiscoveryList({ rows }: { rows: DiscoveryRow[] }) {
  const [view, setView] = useState<"cards" | "table">("cards");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [batchFilter, setBatchFilter] = useState<string>(BATCH_ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(SOURCE_ALL);
  // One tier at a time, and pressing the one already on clears it — three
  // buttons that could each be half-on would be a set of checkboxes wearing a
  // segmented control's clothes.
  const [tierFilter, setTierFilter] = useState<IcpTier | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  // Selection is state and nothing else — no URL, no storage — so navigating
  // away or refreshing starts again with nothing selected, which is the only
  // safe default for a set of rows with a delete button pointed at them.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const allRef = useRef<HTMLInputElement>(null);

  // Every batch on the list, counted across all of it rather than across what
  // is currently filtered — a dropdown whose options disappeared as you used
  // it would be a dropdown you could not get back out of.
  const batches = useMemo(() => batchOptions(rows), [rows]);

  // Same rule as the batches above: counted across the whole list rather than
  // across what is currently filtered, so choosing one source never removes
  // the option that would take you back.
  const sources = useMemo(() => sourceOptions(rows), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (tierFilter !== null && r.icpTier !== tierFilter) return false;
      if (batchFilter !== BATCH_ALL && (r.batchLabel ?? BATCH_NONE) !== batchFilter) {
        return false;
      }
      if (sourceFilter !== SOURCE_ALL && sourceKey(r.source) !== sourceFilter) {
        return false;
      }
      if (!q) return true;
      return [r.clinicName, r.contactName, r.source, r.location, r.email, r.batchLabel]
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
  }, [
    rows,
    query,
    statusFilter,
    tierFilter,
    batchFilter,
    sourceFilter,
    sortKey,
    sortDir,
  ]);

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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clinic, contact, source, location…"
          className="field w-full max-w-xs"
        />
        {/* w-auto sizes the box to its label, so the native chevron lands on
            top of the 14px px-3.5 padding rather than beside it. The extra
            right padding restores the breathing room full-width fields get. */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="field w-auto pr-9"
        >
          <option value="ALL">All statuses</option>
          {DISCOVERY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DISCOVERY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {/* Where these came from — "LinkedIn", "Added by name", or whatever a
            CSV's own source column said. Read off the candidates rather than
            listed here, because the import maps that column and the values are
            therefore not ours to enumerate. Offered on the same terms as the
            batches: only once there is more than one to choose between. */}
        {sources.length > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label="Filter by source"
            className="field w-auto max-w-[230px] pr-9"
          >
            <option value={SOURCE_ALL}>All sources</option>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} ({s.count})
              </option>
            ))}
          </select>
        )}
        {/* Which run these came in on. Only offered once there is more than
            one batch to choose between — a dropdown with a single option is
            a label pretending to be a control. */}
        {batches.length > 1 && (
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            aria-label="Filter by import batch"
            className="field w-auto max-w-[230px]"
          >
            <option value={BATCH_ALL}>All batches</option>
            {batches.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label} ({b.count})
              </option>
            ))}
          </select>
        )}
        {/* One press to the tier that matters today. Pressing the one already
            on clears it, which is why there is no "All" button beside them. */}
        <div className="segment" role="group" aria-label="Filter by ICP tier">
          {QUICK_TIERS.map((tier) => {
            const on = tierFilter === tier;
            return (
              <button
                key={tier}
                type="button"
                aria-pressed={on}
                onClick={() => setTierFilter(on ? null : tier)}
                title={`${ICP_TIER_LABELS[tier]} only${
                  ICP_TIER_ACTIONS[tier] ? ` — ${ICP_TIER_ACTIONS[tier]}` : ""
                }. Press again to clear.`}
                className={`segment-item ${on ? "segment-item-on" : ""}`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${icpTierDot(tier)}`}
                />
                {ICP_TIER_LABELS[tier]}
              </button>
            );
          })}
        </div>
        {/* Count and view travel together, so a filter that changes the count
            never leaves the toggle sitting somewhere new. */}
        <div className="ml-auto flex items-center gap-3">
          <span className="num text-xs text-muted">
            {visible.length} candidate{visible.length === 1 ? "" : "s"}
          </span>
          {/* Cards first, because cards are what loads — a toggle whose second
              item is the default reads as though the first one were. */}
          <div className="segment" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={view === "cards"}
              onClick={() => setView("cards")}
              className={`segment-item ${view === "cards" ? "segment-item-on" : ""}`}
            >
              Cards
            </button>
            <button
              type="button"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
              className={`segment-item ${view === "table" ? "segment-item-on" : ""}`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Rides the top of the viewport while a long list scrolls under it, so
          the actions stay with the selection rather than with whatever made
          it. Nothing renders at all until something is chosen. */}
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

      {view === "cards" ? (
        <>
          {/* The grid has no header row to hang "select all" off, so it gets
              its own — same checkbox, same rule about only reaching what is
              on screen. */}
          <label className="mb-3 inline-flex cursor-pointer items-center gap-2.5 text-xs text-muted">
            <input
              ref={allRef}
              type="checkbox"
              checked={allChosen}
              onChange={(e) => toggleAll(e.target.checked)}
              disabled={visible.length === 0}
              className="h-4 w-4 shrink-0 accent-accent"
            />
            Select all
          </label>
          {visible.length === 0 ? (
            <div className="card px-6 py-10 text-center">
              <p className="text-sm font-medium">No candidates match</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Nothing in Discovery answers to those filters.
              </p>
            </div>
          ) : (
            /* Columns come off the room this grid actually has, not off the
               window. Every other grid in the app uses viewport breakpoints
               and is right to: they sit in fixed layouts. This one cannot,
               because the sidebar collapses — 224px of chrome becomes 64px
               with the window exactly as wide as it was — and a breakpoint
               would hold three columns through both, or two.

               So: as many 300px-or-wider tracks as fit, and a card is a card
               whatever else is on screen. auto-fill rather than auto-fit so
               three results after a filter stay card-width instead of
               stretching to fill a row meant for three. The min() is what
               keeps the last column honest below 300px — a track that cannot
               have its minimum takes the container's width instead of
               overflowing it. */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] items-stretch gap-4">
              {visible.map((row) => (
                <CandidateCard
                  key={row.id}
                  row={row}
                  selected={selected.has(row.id)}
                  onToggle={(on) => toggleOne(row.id, on)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
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
                  className={
                    selected.has(row.id) ? "bg-accent/5" : "hover:bg-wash/70"
                  }
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
                  {/* The batch is not a column of its own here — a tenth one
                      squeezed every other column into three lines. It is on
                      the card, in the filter above, and on the candidate. */}
                  <td className="td text-muted">
                    {row.source ?? "—"}
                    {row.batchLabel && (
                      <span
                        className="block max-w-[150px] truncate text-xs text-muted/80"
                        title={`Imported on the batch “${row.batchLabel}”`}
                      >
                        {row.batchLabel}
                      </span>
                    )}
                  </td>
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
                  <td className="td num whitespace-nowrap">
                    {row.icpTotal != null ? (
                      <>
                        {row.icpTotal}
                        <span className="text-xs text-muted">
                          {" "}
                          / {ICP_MAX_SCORE}
                        </span>
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
      )}
    </div>
  );
}

// One candidate, at a glance: who it is, the score, where it got to, and when
// it arrived.
//
// The score is the loudest thing on it, deliberately — a grid of these is read
// by scanning for the green ones. The status pill underneath says something
// different and is worth having both: a clinic can be A-tier and still sitting
// unprocessed, and only the pill says so.
function CandidateCard({
  row,
  selected,
  onToggle,
}: {
  row: DiscoveryRow;
  selected: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div
      className={`card flex flex-col p-4 transition-colors ${
        selected ? "border-accent/40 bg-accent/5" : "hover:bg-wash/40"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Select ${row.clinicName}`}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/discovery/${row.id}`}
            className="block truncate text-sm font-medium text-ink hover:underline"
            title={row.clinicName}
          >
            {row.clinicName}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted">
            {row.contactName ?? "No contact named"}
          </p>
        </div>
        <IcpScoreBadge
          tier={row.icpTier}
          total={row.icpTotal}
          max={ICP_MAX_SCORE}
        />
      </div>

      <div className="mt-3.5 space-y-1.5">
        <CardMeta icon="building" value={row.source} />
        <CardMeta icon="mapPin" value={row.location} />
        <CardMeta icon="mail" value={row.email} />
        <CardMeta icon="tag" value={row.batchLabel} />
      </div>

      {/* Why it was turned down or why it stopped, where there is one — the
          same line the table shows, for the same reason. */}
      {row.reason && (
        <p
          className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted"
          title={row.reason}
        >
          {row.reason}
        </p>
      )}

      {/* mt-auto so the footers line up across a row of cards whose middles
          are different heights — a clinic with no location is still a card the
          same shape as the one beside it. */}
      <div className="mt-auto flex items-center gap-2 pt-4">
        <DiscoveryStatusBadge status={row.status} />
        <span className="num ml-auto shrink-0 text-xs text-muted">
          {fmtDate(row.createdAt)}
        </span>
      </div>
    </div>
  );
}

// A fact about the clinic, or nothing at all. An empty row of dashes down a
// card would be four lines saying nothing; the card just gets shorter.
function CardMeta({ icon, value }: { icon: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="flex items-center gap-2 text-xs text-muted">
      <Icon name={icon} className="h-3.5 w-3.5 text-muted/70" />
      <span className="min-w-0 truncate" title={value}>
        {value}
      </span>
    </p>
  );
}
