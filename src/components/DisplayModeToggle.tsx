"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyMode,
  DISPLAY_MODE_STORAGE_KEY,
  readStoredMode,
  type DisplayMode,
} from "@/lib/displayMode";

// The Guided / Pro switch: in the sidebar's foot under the theme toggle, and
// in the phone's top bar. A two-item segment rather than one button, because
// unlike the theme there is no "the other one" you can see at a glance — the
// control has to say which mode you are in.
//
// Like ThemeToggle it draws nothing until mounted: the mode is on <html>
// from the pre-paint script, and the server cannot know it.
export default function DisplayModeToggle({
  variant,
}: {
  variant: "sidebar" | "rail" | "topbar";
}) {
  const [mode, setMode] = useState<DisplayMode | null>(null);

  useEffect(() => {
    const stored = readStoredMode();
    setMode(stored);
    applyMode(stored);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== DISPLAY_MODE_STORAGE_KEY) return;
      const next = readStoredMode();
      setMode(next);
      applyMode(next);
    };
    window.addEventListener("storage", onStorage);
    // The other copy of the switch (sidebar and top bar are both mounted).
    const onLocal = () => setMode(readStoredMode());
    window.addEventListener("display-mode", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("display-mode", onLocal);
    };
  }, []);

  const choose = useCallback((next: DisplayMode) => {
    setMode(next);
    applyMode(next);
    try {
      localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the mode still changes for this page view.
    }
    window.dispatchEvent(new Event("display-mode"));
  }, []);

  if (!mode) return <div className={variant === "topbar" ? "h-8 w-[88px]" : "h-[42px]"} aria-hidden />;

  // The collapsed rail has room for one glyph: a button that flips it.
  if (variant === "rail") {
    return (
      <button
        type="button"
        onClick={() => choose(mode === "pro" ? "guided" : "pro")}
        title={mode === "pro" ? "Pro mode — switch to Guided" : "Guided mode — switch to Pro"}
        aria-label={mode === "pro" ? "Switch to Guided mode" : "Switch to Pro mode"}
        className="flex h-[42px] w-full items-center justify-center rounded-[10px] text-[11px] font-semibold text-muted hover:bg-wash hover:text-ink"
      >
        {mode === "pro" ? "Pro" : "G"}
      </button>
    );
  }

  const small = variant === "topbar";
  return (
    <div
      role="group"
      aria-label="Display mode"
      className={`segment ${small ? "!h-8 !gap-0.5 !p-0.5" : "mt-1 w-full"}`}
    >
      {(["guided", "pro"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => choose(m)}
          title={
            m === "guided"
              ? "Guided: every explanation on screen"
              : "Pro: explanations hidden, confirms are one line"
          }
          className={`segment-item ${small ? "!h-7 !px-2.5 !text-xs" : "flex-1 justify-center"} ${
            mode === m ? "segment-item-on" : ""
          }`}
        >
          {m === "guided" ? "Guided" : "Pro"}
        </button>
      ))}
    </div>
  );
}
