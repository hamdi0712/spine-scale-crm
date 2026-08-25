"use client";

import { useEffect, useState } from "react";

// Which theme is currently painted, as a value React can branch on.
//
// Almost nothing in the app needs this — a component styled with the token
// classes flips on its own when the class on <html> changes, with no render
// involved. This exists for the one case that cannot: Recharts takes its
// colours as props and writes them onto SVG as attributes, where `var()` does
// not resolve. Those components need the actual value, in JS, at render time.
//
// The source of truth is the class on <html>, not localStorage and not the
// media query — the pre-paint script and the toggle both write there, so
// reading it means never disagreeing with what is on screen. A MutationObserver
// picks up the toggle; the "system" case is handled where it is chosen (see
// ThemeToggle), which reduces to a class change here too.
//
// It returns "light" on the server and on the first client render, then
// corrects in an effect. Charts are client-only and re-render freely, so a
// single settling frame costs nothing.
export default function useTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
