"use client";

// The bottom sheet — the phone's version of a dialog, and the surface every
// mobile-only overlay in the app is drawn on: the More menu, a page's ⋯
// actions, the calendar's agenda for a day, the copilot's history.
//
// It slides up from the bottom edge, carries a drag handle, is capped at the
// viewport's dynamic height less a sliver so the page still shows behind it,
// scrolls inside itself rather than scrolling the page, and pads its foot for
// the home indicator. Dragging the handle down past a short threshold closes
// it, as does the scrim, Escape, and the close button.
//
// It is portalled to <body>. That keeps it out of whatever stacking context
// opened it, and — for keepMounted sheets — means a dialog opened from inside
// one is not hidden along with it when it closes.
//
// Motion is the same pair of states useDialogMotion drives for a dialog, on
// the same timing; the keyframes that make a panel travel from the bottom
// edge rather than grow in place are .sheet-panel's, in globals.css.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 160;

type Phase = "closed" | "open" | "closing";

export default function Sheet({
  open,
  onClose,
  title,
  children,
  keepMounted = false,
  footer,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  // Keep the content in the tree while the sheet is shut, hidden. For a
  // sheet whose children own state that must outlive it — a page's actions
  // menu, where a button inside opens a dialog of its own.
  keepMounted?: boolean;
  footer?: React.ReactNode;
  labelledBy?: string;
}) {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const [mounted, setMounted] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const done = useRef(onClose);
  done.current = onClose;

  useEffect(() => setMounted(true), []);

  // Follow the parent's flag: open straight away, close by playing the exit.
  useEffect(() => {
    if (open) {
      setPhase("open");
      setDrag(0);
    } else {
      setPhase((p) => (p === "open" ? "closing" : p));
    }
  }, [open]);

  useEffect(() => {
    if (phase !== "closing") return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const t = setTimeout(() => setPhase("closed"), reduced ? 0 : EXIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const requestClose = useCallback(() => done.current(), []);

  // Escape, and the page underneath held still while the sheet is up.
  useEffect(() => {
    if (phase !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [phase, requestClose]);

  if (!mounted) return null;
  if (phase === "closed" && !keepMounted) return null;

  const hidden = phase === "closed";
  const closing = phase === "closing";

  const onTouchStart = (e: React.TouchEvent) => {
    dragStart.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStart.current === null) return;
    setDrag(Math.max(0, e.touches[0].clientY - dragStart.current));
  };
  const onTouchEnd = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (drag > 80) requestClose();
    else setDrag(0);
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex items-end justify-center ${hidden ? "hidden" : ""}`}
      aria-hidden={hidden || undefined}
    >
      <div
        className={`${closing ? "motion-scrim-out" : "motion-scrim-in"} absolute inset-0 bg-ink/30`}
        onClick={requestClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`${closing ? "motion-dialog-out" : "motion-dialog-in"} sheet-panel relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-t-[20px] border border-b-0 border-line bg-surface shadow-card-hover`}
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
      >
        <div
          className="shrink-0 touch-none pb-1 pt-2"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="sheet-handle" aria-hidden />
          {title && (
            <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-2">
              <div className="display min-w-0 truncate text-base font-semibold text-ink">
                {title}
              </div>
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close"
                className="btn-ghost h-9 shrink-0 px-3 text-base leading-none"
              >
                ✕
              </button>
            </div>
          )}
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 ${
            footer ? "pb-4" : "pb-[calc(env(safe-area-inset-bottom)+16px)]"
          }`}>
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-line/60 bg-surface px-5 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
