"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconBrandLinkedin, IconCheck } from "@tabler/icons-react";
import { LEAD_STAGES, LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { ICP_TIER_LABELS, ICP_TIER_ORDER, IcpTier } from "@/lib/icp";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { fmtRelative } from "@/lib/activity";
import { IcpTierBadge, StageBadge } from "@/components/Badge";
import { KanbanLead } from "@/components/KanbanBoard";

type SortKey =
  | "clinicName"
  | "stage"
  | "icpTier"
  | "estValue"
  | "nextFollowUp"
  | "createdAt";

export default function LeadTable({ leads }: { leads: KanbanLead[] }) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [tierFilter, setTierFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

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
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
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
              <tr key={lead.id} className="hover:bg-wash/70">
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
                <td className="td text-muted" colSpan={8}>
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
