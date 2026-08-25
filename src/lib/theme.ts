// The theme, and the one piece of it that has to run before React does.
//
// Three states, not two. "system" is a real, persistent choice — it means
// "follow the OS, and keep following it when it changes" — and it is the state
// a first-time visitor is in. "light" and "dark" are explicit overrides. Only
// an explicit override is written to localStorage; choosing system clears the
// key, so a visitor who has never touched the toggle and one who deliberately
// went back to system are the same state, which is what we want.

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "spine-scale-theme";

// The script that runs before first paint. It is inlined into the document
// head by the root layout, ahead of every stylesheet and any React output, so
// the `dark` class is on <html> by the time the first pixel is drawn. Without
// it the page paints light, hydrates, and then flips — the flash of wrong
// theme, which on a full-page dark UI is a white strobe.
//
// It is written as a string rather than a real module because it must be a
// synchronous inline <script>: anything imported, deferred or bundled runs
// after the first paint by definition, which is the whole problem.
//
// Everything in it is wrapped in try/catch. localStorage throws outright in
// some privacy modes, and a theme preference is never worth a blank page.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var dark =
      stored === "dark" ||
      (stored !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();
`;

// Read the stored override, if there is one. Anything unrecognised — a stale
// value, something another tab wrote — is treated as no choice at all.
export function readStoredChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// Resolve a choice to what actually gets painted.
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice;
}

// Put it on the document. `color-scheme` is set alongside the class because
// the browser draws scrollbars, the caret, autofill and date pickers from it,
// and the stylesheet's own `color-scheme` declaration is not enough on the
// very first paint before styles resolve.
export function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}
