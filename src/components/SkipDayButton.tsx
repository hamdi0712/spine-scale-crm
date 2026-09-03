"use client";

// "Skip for today", and the way back off it.
//
// A button rather than a form, for the reason ConnectionRequestToggle is one:
// this sits inside a KPI card that the page may well wrap in something else,
// and a nested form is dropped by the browser. The action is called
// imperatively instead, with useTransition holding the press until the server
// component behind it has re-rendered.
//
// Nothing is computed here. Whether the day is skipped is a stored row
// (DailyKpiSkip in prisma/schema.prisma) and this only flips it — the same
// explicit-override shape as the client health flag, and the reason it can be
// undone as easily as it was set.

import { useTransition } from "react";
import Icon from "@/components/Icons";

export default function SkipDayButton({
  skipped,
  label,
  toggle,
}: {
  skipped: boolean;
  // The metric's name, for the control's title and its screen-reader label —
  // "Skip for today" on its own does not say what is being skipped.
  label: string;
  toggle: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => toggle())}
      title={
        skipped
          ? `${label} is marked skipped for this day — click to undo`
          : `Count this day as met for ${label}, whatever the number says`
      }
      className={`inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${
        skipped
          ? "border-line bg-wash text-muted hover:text-ink"
          : "border-line text-muted hover:bg-wash hover:text-ink"
      }`}
    >
      {skipped ? (
        <>
          <Icon name="close" className="h-3 w-3" />
          <span>Undo skip</span>
        </>
      ) : (
        <>
          <Icon name="check" className="h-3 w-3" />
          <span>Skip for today</span>
        </>
      )}
      <span className="sr-only">{label}</span>
    </button>
  );
}
