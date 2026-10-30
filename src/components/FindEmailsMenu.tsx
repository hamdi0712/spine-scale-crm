"use client";

// The Email pipeline's "Find emails" menu: the two bulk email actions —
// Check all unchecked, Find emails on Facebook — behind one button, so the
// header carries one primary action and one menu rather than a row of four.
//
// The items stay mounted while the menu is shut: each one owns its run's
// error line, and closing the menu should not lose it.

import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";

export default function FindEmailsMenu({ children, badge = 0 }: { children: React.ReactNode; badge?: number }) {
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
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="btn w-full justify-center gap-1.5"
      >
        Find emails
        {badge > 0 && <span className="num text-muted">({badge})</span>}
        <IconChevronDown size={15} stroke={2} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className={`card absolute right-0 z-30 mt-2 w-72 p-1.5 shadow-lg max-md:left-0 max-md:w-auto ${open ? "" : "hidden"}`}
      >
        {children}
      </div>
    </div>
  );
}
