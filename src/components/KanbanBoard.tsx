"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { LEAD_STAGES, LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { moveLeadStage } from "@/lib/actions/leads";
import { fmtDate, fmtMoney } from "@/lib/format";

export interface KanbanLead {
  id: string;
  clinicName: string;
  contactName: string | null;
  leadSource: string | null;
  stage: string;
  estValue: number | null;
  nextFollowUp: string | null;
  createdAt: string;
}

export default function KanbanBoard({ leads }: { leads: KanbanLead[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  // Local optimistic overrides so a drop paints instantly.
  const [moved, setMoved] = useState<Record<string, string>>({});

  const stageOf = (l: KanbanLead) => moved[l.id] ?? l.stage;

  function handleDrop(stage: LeadStage) {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    setMoved((m) => ({ ...m, [id]: stage }));
    startTransition(async () => {
      await moveLeadStage(id, stage);
      router.refresh();
    });
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {LEAD_STAGES.map((stage) => {
        const column = leads.filter((l) => stageOf(l) === stage);
        const value = column.reduce((s, l) => s + (l.estValue ?? 0), 0);
        return (
          <div
            key={stage}
            onDragOver={(e) => {
              e.preventDefault();
              setOverStage(stage);
            }}
            onDragLeave={() => setOverStage(null)}
            onDrop={() => handleDrop(stage)}
            className={`flex min-h-[420px] w-56 shrink-0 flex-col rounded-[10px] border ${
              overStage === stage
                ? "border-accent/50 bg-accent/5"
                : "border-line bg-bg"
            }`}
          >
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold">
                  {LEAD_STAGE_LABELS[stage]}
                </span>
                <span className="font-mono text-xs text-muted">
                  {column.length}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">
                {value > 0 ? fmtMoney(value) : "—"}
              </div>
            </div>
            <div className="flex-1 space-y-2 p-2">
              {column.map((lead) => (
                <div
                  key={lead.id}
                  draggable
                  onDragStart={() => setDragId(lead.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverStage(null);
                  }}
                  className={`cursor-grab rounded-lg border border-line bg-surface px-3 py-2.5 shadow-sm hover:border-accent/50 ${
                    dragId === lead.id ? "opacity-40" : ""
                  }`}
                >
                  <Link
                    href={`/pipeline/${lead.id}`}
                    className="block text-sm font-medium hover:text-accent"
                    draggable={false}
                  >
                    {lead.clinicName}
                  </Link>
                  {lead.contactName && (
                    <div className="mt-0.5 text-xs text-muted">
                      {lead.contactName}
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-muted">
                    <span>{lead.estValue != null ? fmtMoney(lead.estValue) : ""}</span>
                    <span>
                      {lead.nextFollowUp ? fmtDate(lead.nextFollowUp) : ""}
                    </span>
                  </div>
                </div>
              ))}
              {column.length === 0 && <div className="h-full" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
