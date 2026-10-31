"use client";

// The lead's stage, in the page header: the app's own dropdown rather than
// the browser's, so the list matches the rest of the page instead of the
// operating system. A pick is saved at once, through the same action the
// board's drag uses.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { LEAD_STAGES, LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { moveLeadStage } from "@/lib/actions/leads";

export default function StageSelect({ leadId, stage }: { leadId: string; stage: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const label = LEAD_STAGE_LABELS[stage as LeadStage] ?? stage;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: string) {
    setOpen(false);
    if (next === stage) return;
    start(async () => {
      await moveLeadStage(leadId, next);
      router.refresh();
    });
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Stage: ${label}`}
        className="btn min-w-[150px] justify-between gap-3 pl-4 pr-3 disabled:opacity-60"
      >
        <span className="truncate">{pending ? "Saving…" : label}</span>
        <IconChevronDown size={16} stroke={2} aria-hidden className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label="Stage" className="card absolute right-0 z-30 mt-2 w-56 p-1.5 shadow-lg">
          {LEAD_STAGES.map((s) => {
            const on = s === stage;
            return (
              <li key={s} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-wash focus:outline-none focus-visible:bg-wash ${
                    on ? "font-semibold text-accent" : "text-ink"
                  }`}
                >
                  {LEAD_STAGE_LABELS[s]}
                  {on && <IconCheck size={16} stroke={2.5} aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
