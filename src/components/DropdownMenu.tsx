"use client";

// A button that opens a small menu of actions under it: the pipeline's Find
// emails menu, a lead's ⋯ menu. Closes on a click outside it and on Escape.
//
// The items stay mounted while the menu is shut: an item can own a run's
// error line or a form, and closing the menu should not lose either.

import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconDots } from "@tabler/icons-react";

// The look of one item, for a button or a form's submit button inside a menu.
export const MENU_ITEM =
  "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-wash focus:outline-none focus-visible:bg-wash disabled:cursor-not-allowed disabled:opacity-50";

export default function DropdownMenu({
  label,
  badge = 0,
  icon = false,
  children,
  className = "",
}: {
  // The button's text; with icon, its accessible name.
  label: string;
  badge?: number;
  // A ⋯ icon button rather than a labelled one.
  icon?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={icon ? label : undefined}
        className={icon ? "btn w-10 justify-center px-0" : "btn w-full justify-center gap-1.5"}
      >
        {icon ? (
          <IconDots size={18} stroke={2} aria-hidden />
        ) : (
          <>
            {label}
            {badge > 0 && <span className="num text-muted">({badge})</span>}
            <IconChevronDown size={15} stroke={2} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>
      <div className={`card absolute right-0 z-30 mt-2 w-72 p-1.5 shadow-lg max-md:left-0 max-md:w-auto ${open ? "" : "hidden"}`}>
        {children}
      </div>
    </div>
  );
}
