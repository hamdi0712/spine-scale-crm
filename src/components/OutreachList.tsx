"use client";

// The Outreach Queue's cards, and on a big monitor the toolbar above them:
// search, the A/B filter and a sort, laid out the way the Email pipeline's
// is. Below the wide breakpoint the toolbar is hidden and the cards are
// exactly the cards they were.

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { IcpTier } from "@/lib/icp";
import { fmtDate } from "@/lib/format";
import { IcpScoreBadge } from "@/components/Badge";
import Icon from "@/components/Icons";
import { LeadLocalTime } from "@/components/Clock";

export interface OutreachRow {
  id: string;
  clinicName: string;
  contactName: string | null;
  leadSource: string | null;
  location: string | null;
  timeZone: string | null;
  email: string | null;
  createdAt: string;
  icpTier: IcpTier | null;
  icpTotal: number | null;
  icpMax: number | null;
}

const TIER_DOT: Record<"A" | "B", string> = { A: "bg-ok", B: "bg-warn" };

export default function OutreachList({ rows }: { rows: OutreachRow[] }) {
  const [query, setQuery] = useState("");
  const [tiers, setTiers] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"newest" | "score" | "name">("newest");

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (tiers.size === 0 || (r.icpTier !== null && tiers.has(r.icpTier))) &&
            (q === "" || [r.clinicName, r.contactName, r.location, r.email].some((v) => (v ?? "").toLowerCase().includes(q))),
        )
        .sort((a, b) =>
          sort === "score" ? (b.icpTotal ?? -1) - (a.icpTotal ?? -1) : sort === "name" ? a.clinicName.localeCompare(b.clinicName) : 0,
        ),
    [rows, tiers, q, sort],
  );

  return (
    <>
      {/* The big monitor's toolbar, the Email pipeline's shape. */}
      <div className="card mb-4 mt-4 hidden items-center gap-2 overflow-visible px-3 py-2.5 wide:flex">
        <label className="relative flex flex-1 items-center">
          <span className="sr-only">Search</span>
          <IconSearch size={15} stroke={2} aria-hidden className="pointer-events-none absolute left-3 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clinics, contacts, emails…"
            className="field !h-8 w-full pl-9 text-[13px]"
          />
        </label>
        <div className="flex rounded-[10px] border border-line p-0.5" role="group" aria-label="Tier">
          {(["A", "B"] as const).map((t) => {
            const on = tiers.has(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setTiers((prev) => {
                    const next = new Set(prev);
                    if (next.has(t)) next.delete(t);
                    else next.add(t);
                    return next;
                  })
                }
                className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors ${on ? "bg-wash text-ink" : "text-muted hover:text-ink"}`}
              >
                <span className={`h-2 w-2 rounded-full ${TIER_DOT[t]}`} aria-hidden />
                {t}
              </button>
            );
          })}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort" className="field !h-8 w-auto text-[13px]">
          <option value="newest">Newest first</option>
          <option value="score">Highest score</option>
          <option value="name">Clinic name</option>
        </select>
      </div>

      {/* The same grid Discovery's cards sit in, for the same reason: the
          sidebar collapses under a window that does not change width, so the
          columns come off the room this grid has rather than off a viewport
          breakpoint. See the note in src/components/DiscoveryList.tsx. On a
          big monitor it is three across at the Email pipeline's scale. */}
      <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] items-stretch gap-4 wide:mt-0 wide:grid-cols-3 wide:gap-3">
        {shown.map((row) => (
          <Link
            key={row.id}
            href={`/pipeline/${row.id}`}
            className="card card-interactive group flex flex-col p-4 hover:bg-wash/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 wide:card-sheen wide:p-3.5 wide:transition-[transform,box-shadow] wide:hover:-translate-y-0.5"
          >
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium text-ink group-hover:underline wide:font-semibold wide:group-hover:no-underline"
                  title={row.clinicName}
                >
                  {row.clinicName}
                </span>
                {/* Never a blank line where a person would be. A lead
                    promoted from a clinic-first candidate can arrive with
                    nobody named on it, and it says so in words — the name is
                    typed onto the lead when it is found. */}
                <p className="mt-0.5 truncate text-xs text-muted wide:text-[11px]">
                  {row.contactName || <span className="text-muted/70">No contact yet</span>}
                </p>
              </div>
              {/* The clock rides with the badge rather than down in the meta
                  rows: whether now is a reasonable hour to call is read at the
                  same moment as whether the lead is worth calling. */}
              <div className="flex shrink-0 items-center gap-2">
                <LeadLocalTime timeZone={row.timeZone} />
                <IcpScoreBadge tier={row.icpTier} total={row.icpTotal} max={row.icpMax ?? 0} />
              </div>
            </div>

            <div className="mt-3.5 space-y-1.5 wide:mt-2.5 wide:space-y-0.5">
              <CardMeta icon="building" value={row.leadSource} />
              <CardMeta icon="mapPin" value={row.location} />
              <CardMeta icon="mail" value={row.email} />
            </div>

            {/* mt-auto so the footers line up across a row of cards whose
                middles are different heights. */}
            <div className="mt-auto flex items-center gap-2 pt-4 wide:pt-2.5">
              <span className="text-xs text-muted wide:text-[11px]">Awaiting first contact</span>
              <span className="num ml-auto shrink-0 text-xs text-muted wide:text-[11px]">{fmtDate(row.createdAt)}</span>
            </div>
          </Link>
        ))}
        {shown.length === 0 && (
          <p className="card col-span-full px-4 py-10 text-center text-sm text-muted">No lead matches that search.</p>
        )}
      </div>
    </>
  );
}

// A fact about the lead, or nothing at all — the same rule Discovery's cards
// follow: an empty row of dashes says nothing, so the card just gets shorter.
function CardMeta({ icon, value }: { icon: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="flex items-center gap-2 text-xs text-muted wide:text-[12.5px] wide:text-ink-soft">
      <Icon name={icon} className="h-3.5 w-3.5 text-muted/70 wide:h-[13px] wide:w-[13px]" />
      <span className="min-w-0 truncate" title={value}>
        {value}
      </span>
    </p>
  );
}
