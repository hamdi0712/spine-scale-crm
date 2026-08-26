"use client";

// The open/close motion every dialog in the app shares.
//
// Opening is pure CSS — a dialog is mounted when it opens, so the keyframes in
// globals.css run on first paint and nothing here is needed for it. Closing is
// the part that needs a hook: the component is unmounted the moment its parent
// flips the flag, and an element that is gone cannot fade. So the hook sits
// between the two — a request to close plays the exit first and calls the
// parent's onClose when it has finished.
//
// Everything a dialog needs is returned: the two class names to put on the
// scrim and the panel, and the `close` to call instead of `onClose` from the
// Escape key, the backdrop, and every close button.

import { useCallback, useEffect, useRef, useState } from "react";

// Matches --motion in globals.css. Duplicated as a number because a timeout
// cannot read a CSS custom property, and kept deliberately equal rather than
// measured: the exit is short enough that being a frame out either way is
// invisible, and reading computed styles here would cost a layout per dialog.
const EXIT_MS = 160;

export default function useDialogMotion(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  // Held in a ref so the timer effect below does not restart every time the
  // parent re-renders with a fresh onClose identity.
  const done = useRef(onClose);
  done.current = onClose;

  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!closing) return;
    // Someone who has asked the OS for less motion gets the same close, on the
    // next tick rather than after the exit: the CSS is already skipping the
    // animation, and waiting 160ms for an animation that is not playing would
    // just read as the dialog being slow to shut.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => done.current(), reduced ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  return {
    close,
    closing,
    scrimClass: closing ? "motion-scrim-out" : "motion-scrim-in",
    dialogClass: closing ? "motion-dialog-out" : "motion-dialog-in",
  };
}
