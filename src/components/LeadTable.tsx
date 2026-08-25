"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { IconBrandLinkedin, IconCheck } from "@tabler/icons-react";
import { LEAD_STAGES, LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { deleteLeads, moveLeadsStage } from "@/lib/actions/leads";
import { ICP_TIER_LABELS, ICP_TIER_ORDER, IcpTier } from "@/lib/icp";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { fmtRelative } from "@/lib/activity";
import { IcpTierBadge, StageBadge } from "@/components/Badge";
import { KanbanLead } from "@/components/KanbanBoard";
import { useUrlState } from "@/lib/useUrlState";

type SortKey =
  | "clinicName"
  | "stage"
  | "icpTier"
  | "estValue"
  | "nextFollowUp"
  | "createdAt";

export default function LeadTable({ leads }: { leads: KanbanLead[] }) {
  // The stage, the tier and the sort live in the query string
  // (src/lib/useUrlState.ts), so opening a lead and pressing Back returns to
  // the list as it was rather than to an unfiltered one. The search box stays
  // local state: every keystroke would otherwise be a navigation, and on a
  // force-dynamic page that is a server round trip per letter typed.
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useUrlState<string>("stage", "ALL");
  const [tierFilter, setTierFilter] = useUrlState<string>("tier", "ALL");
  const [sortKey, setSortKey] = useUrlState<SortKey>("sort", "createdAt", [
    "clinicName",
    "stage",
    "icpTier",
    "estValue",
    "nextFollowUp",
    "createdAt",
  ]);
  const [dirParam, setDirParam] = useUrlState<"asc" | "desc">("dir", "desc", [
    "asc",
    "desc",
  ]);
  const sortDir: 1 | -1 = dirParam === "asc" ? 1 : -1;
  // Selection is state and nothing else — no URL, no storage — so navigating
  // away or refreshing starts again with nothing selected, which is the only
  // safe default for a set of rows with a delete button pointed at them.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const allRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = leads.filter((l) => {
      if (stageFilter !== "ALL" && l.stage !== stageFilter) return false;
      if (tierFilter === "UNSCORED" && l.icpTier != null) return false;
      if (tierFilter !== "ALL" && tierFilter !== "UNSCORED" && l.icpTier !== tierFilter)
        return false;
      if (!q) return true;
      return [l.clinicName, l.contactName, l.leadSource]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q));
    });
    const stageOrder = (s: string) => LEAD_STAGES.indexOf(s as LeadStage);
    // Unscored leads sort after every tier, in both directions is fine —
    // they carry no tier to rank.
    const tierOrder = (t: IcpTier | null) =>
      t == null ? ICP_TIER_ORDER.length : ICP_TIER_ORDER.indexOf(t);
    return filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "clinicName":
          cmp = a.clinicName.localeCompare(b.clinicName);
          break;
        case "stage":
          cmp = stageOrder(a.stage) - stageOrder(b.stage);
          break;
        case "icpTier":
          cmp = tierOrder(a.icpTier) - tierOrder(b.icpTier);
          break;
        case "estValue":
          cmp = (a.estValue ?? -1) - (b.estValue ?? -1);
          break;
        case "nextFollowUp":
          cmp = (a.nextFollowUp ?? "9999").localeCompare(b.nextFollowUp ?? "9999");
          break;
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return cmp * sortDir;
    });
  }, [leads, query, stageFilter, tierFilter, sortKey, sortDir]);

  // Only what is on screen. A row filtered out of view is not a row somebody
  // chose, and a delete that reached beyond the list they were looking at
  // would be the worst kind of surprise — so the count, the actions and the
  // header checkbox all read from here.
  const chosen = rows.filter((l) => selected.has(l.id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;

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
      for (const lead of rows) {
        if (on) next.add(lead.id);
        else next.delete(lead.id);
      }
      return next;
    });
  }

  function runBulk(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      // Cleared on the way out rather than on the way in, so a failed action
      // leaves the selection to try again with.
      setSelected(new Set());
    });
  }

  function bulkDelete() {
    const ids = chosen.map((l) => l.id);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    runBulk(() => deleteLeads(ids));
  }

  function bulkStage(stage: string) {
    const ids = chosen.map((l) => l.id);
    if (ids.length === 0 || stage === "") return;
    runBulk(() => moveLeadsStage(ids, stage));
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setDirParam(sortDir === 1 ? "desc" : "asc");
    } else {
      setSortKey(key);
      setDirParam("asc");
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
          placeholder="Search clinic, contact, source…"
          className="field max-w-xs"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="field w-auto"
        >
          <option value="ALL">All stages</option>
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="field w-auto"
        >
          <option value="ALL">All tiers</option>
          {ICP_TIER_ORDER.map((t) => (
            <option key={t} value={t}>
              {ICP_TIER_LABELS[t]}
            </option>
          ))}
          <option value="UNSCORED">Not scored</option>
        </select>
        <span className="num ml-auto text-xs text-muted">
          {rows.length} lead{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      {/* Rides the top of the viewport while a long list scrolls under it, so
          the actions stay with the selection instead of with the header row
          that made it. Nothing renders at all until something is chosen. */}
      {chosen.length > 0 && (
        <div className="sticky top-0 z-20 mb-3">
          <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="num text-sm font-medium">
              {chosen.length} selected
            </span>
            {/* Full-height controls, like the filter row this sits directly
                under — a shorter select would sit a few pixels off the
                buttons beside it, because .field fixes its own height. */}
            <select
              value=""
              disabled={pending}
              onChange={(e) => bulkStage(e.target.value)}
              aria-label={`Change stage on ${chosen.length} selected leads`}
              className="field w-auto disabled:opacity-50"
            >
              <option value="">Change stage…</option>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STAGE_LABELS[s]}
                </option>
              ))}
            </select>
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
                  aria-label="Select every lead in this list"
                  className="h-4 w-4 shrink-0 accent-accent"
                />
              </th>
              <SortTh k="clinicName">Clinic</SortTh>
              <th className="th">Contact</th>
              <th className="th">Source</th>
              <SortTh k="stage">Stage</SortTh>
              <SortTh k="icpTier">ICP tier</SortTh>
              <SortTh k="estValue">
                Est. value
              </SortTh>
              <SortTh k="nextFollowUp">
                Next follow-up
              </SortTh>
              <SortTh k="createdAt">
                Created
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => (
              <tr
                key={lead.id}
                className={selected.has(lead.id) ? "bg-accent/5" : "hover:bg-wash/70"}
              >
                <td className="td">
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={(e) => toggleOne(lead.id, e.target.checked)}
                    aria-label={`Select ${lead.clinicName}`}
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                </td>
                <td className="td">
                  <Link
                    href={`/pipeline/${lead.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {lead.clinicName}
                  </Link>
                </td>
                <td className="td text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    {lead.contactName ?? "—"}
                    <LinkedInLink lead={lead} />
                  </span>
                </td>
                <td className="td text-muted">{lead.leadSource ?? "—"}</td>
                <td className="td">
                  <StageBadge stage={lead.stage} />
                </td>
                <td className="td">
                  {lead.icpTier ? (
                    <IcpTierBadge tier={lead.icpTier} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="td num">
                  {lead.estValue != null ? fmtMoney(lead.estValue) : "—"}
                </td>
                <td className="td num text-xs">
                  {fmtDate(lead.nextFollowUp)}
                </td>
                <td className="td num text-xs text-muted">
                  {fmtDate(lead.createdAt)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={9}>
                  No leads match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The row's outreach link: the contact's profile where there is one, the
// clinic's company page where there is only that, and nothing at all
// otherwise — an empty column is quieter than a row of dead icons.
//
// It opens LinkedIn and stops there. Nothing in the app sends a connection
// request or a message; the work on the other side of this link is done by
// hand, deliberately.
//
// Beside it, where one has been marked sent on the lead page, a check — so a
// list of forty rows says which of them have already been approached without
// forty pages being opened to find out.
function LinkedInLink({ lead }: { lead: KanbanLead }) {
  const href = lead.linkedinUrl ?? lead.companyLinkedinUrl;
  const sentAt = lead.connectionRequestSentAt
    ? new Date(lead.connectionRequestSentAt)
    : null;
  if (!href && !sentAt) return null;
  const label = lead.linkedinUrl
    ? `Open ${lead.contactName ?? lead.clinicName} on LinkedIn`
    : `Open ${lead.clinicName}'s LinkedIn company page`;
  return (
    <span className="inline-flex items-center gap-1">
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title={label}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="text-muted transition-colors hover:text-accent"
        >
          <IconBrandLinkedin size={16} stroke={1.75} aria-hidden />
        </a>
      )}
      {sentAt && (
        <span
          title={`Connection request sent ${fmtRelative(sentAt)} — ${fmtDateTime(sentAt)}`}
          className="text-ok"
        >
          <IconCheck size={13} stroke={2.5} aria-hidden />
          <span className="sr-only">
            Connection request sent {fmtRelative(sentAt)}
          </span>
        </span>
      )}
    </span>
  );
}
