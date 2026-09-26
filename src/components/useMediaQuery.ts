"use client";

import { useSyncExternalStore } from "react";

// Whether a media query matches, kept live. The server has no viewport, so it
// answers `false` — the desktop reading — and the first client render agrees
// with it; the real answer arrives on the pass straight after hydration.
// Anything that must be right on first paint belongs in CSS (max-md:,
// md:max-lg:) rather than behind this.
export default function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// Below Tailwind's md — the width at which the sidebar gives way to the bottom
// tab bar. The one breakpoint JavaScript needs to know about.
export const PHONE_QUERY = "(max-width: 767px)";

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
