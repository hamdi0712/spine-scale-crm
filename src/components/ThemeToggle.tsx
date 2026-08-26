"use client";

import { useCallback, useEffect, useState } from "react";
import { IconMoon, IconSun } from "@tabler/icons-react";
import {
  applyTheme,
  readStoredChoice,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from "@/lib/theme";

// The light/dark switch, in the sidebar's foot beside Settings.
//
// It is one button rather than a three-way control. The state machine
// underneath has three values (see lib/theme.ts) but the *control* only ever
// needs to say "give me the other one", and a first-time visitor is already on
// whatever their OS asked for — so pressing it once takes them off system and
// onto the opposite of what they are looking at, which is what they meant.
//
// It renders nothing on the server and nothing on the first client render.
// The truth about which theme is showing lives on <html>, put there by the
// pre-paint script before React existed; markup rendered on the server cannot
// know it, and rendering a guess would either flash the wrong icon or trip a
// hydration mismatch. One frame with no glyph is the cheaper of those.
export default function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = readStoredChoice();
    setChoice(stored);
    setMounted(true);
    // Re-assert the theme on mount. The pre-paint script has already done this
    // and normally nothing has disturbed it — this is the backstop for the
    // case where something re-rendered <html> out from under it. Cheap, and it
    // means the class on the document and the state in here can never drift.
    applyTheme(resolveTheme(stored));
  }, []);

  // While the visitor is on "system", the OS flipping (sundown on a machine
  // set to switch automatically) has to flip the app with it. An explicit
  // choice ignores it — that is what makes it explicit.
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(systemPrefersDark() ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  // Another tab changing the preference should not leave this one disagreeing
  // with it — storage events only fire in the tabs that did not write.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
      const next = readStoredChoice();
      setChoice(next);
      applyTheme(resolveTheme(next));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const resolved = mounted ? resolveTheme(choice) : "light";

  const toggle = useCallback(() => {
    const next: ThemeChoice = resolveTheme(choice) === "dark" ? "light" : "dark";
    setChoice(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode with storage blocked: the theme still changes for this
      // page view, it just will not be remembered. Nothing to tell the user.
    }
  }, [choice]);

  const label = resolved === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={`flex h-[42px] w-full items-center gap-2 rounded-[10px] text-left text-sm font-normal text-muted transition-[color,background-color] hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
        collapsed ? "justify-center px-0" : "px-3"
      }`}
    >
      {/* Both glyphs are held in the tree and one is hidden, so the row never
          reflows on press and the icon does not pop in a frame late. */}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {mounted &&
          (resolved === "dark" ? (
            <IconSun size={20} stroke={1.75} aria-hidden />
          ) : (
            <IconMoon size={20} stroke={1.75} aria-hidden />
          ))}
      </span>
      {!collapsed && (
        <span>{resolved === "dark" ? "Light mode" : "Dark mode"}</span>
      )}
    </button>
  );
}
