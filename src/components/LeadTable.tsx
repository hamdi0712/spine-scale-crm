"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LEAD_STAGES, LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { fmtDate, fmtMoney } from "@/lib/format";
import { StageBadge } from "@/components/Badge";
import { KanbanLead } from "@/components/KanbanBoard";

type SortKey = "clinicName" | "stage" | "estValue" | "nextFollowUp" | "createdAt";

export default function LeadTable({ leads }: { leads: KanbanLead[] }) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = leads.filter((l) => {
      if (stageFilter !== "ALL" && l.stage !== stageFilter) return false;
      if (!q) return true;
      return [l.clinicName, l.contactName, l.leadSource]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q));
    });
    const stageOrder = (s: string) => LEAD_STAGES.indexOf(s as LeadStage);
    return filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "clinicName":
          cmp = a.clinicName.localeCompare(b.clinicName);
          break;
        case "stage":
          cmp = stageOrder(a.stage) - stageOrder(b.stage);
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
  }, [leads, query, stageFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function SortTh({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) {
    return (
      <th className={`th ${right ? "text-right" : ""}`}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink"
        >
          {children}
          {sortKey === k && <span aria-hidden>{sortDir === 1 ? "↑" : "↓"}</span>}
        </button>
      </th>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
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
        <span className="ml-auto font-mono text-xs text-muted">
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
              <SortTh k="estValue" right>
                Est. value
              </SortTh>
              <SortTh k="nextFollowUp" right>
                Next follow-up
              </SortTh>
              <SortTh k="createdAt" right>
                Created
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => (
              <tr key={lead.id} className="hover:bg-bg">
                <td className="td">
                  <Link
                    href={`/pipeline/${lead.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {lead.clinicName}
                  </Link>
                </td>
                <td className="td text-muted">{lead.contactName ?? "—"}</td>
                <td className="td text-muted">{lead.leadSource ?? "—"}</td>
                <td className="td">
                  <StageBadge stage={lead.stage} />
                </td>
                <td className="td text-right font-mono">
                  {lead.estValue != null ? fmtMoney(lead.estValue) : "—"}
                </td>
                <td className="td text-right font-mono text-xs">
                  {fmtDate(lead.nextFollowUp)}
                </td>
                <td className="td text-right font-mono text-xs text-muted">
                  {fmtDate(lead.createdAt)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={7}>
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
