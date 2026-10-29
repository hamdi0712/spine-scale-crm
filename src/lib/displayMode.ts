// Guided or Pro: how much the app explains itself.
//
// Guided is the app as it was built, every subtitle, field hint and "how this
// works" note on screen. Pro is for someone who already knows: explanation
// (.helper-text) is hidden, and confirm dialogs say what they are about to do in one line. What is information
// rather than explanation never goes: costs, keep-your-Mac-awake, anything
// that cannot be undone, errors, and why an action is blocked.
//
// The mode is per browser, in localStorage, and lives on <html> as
// data-mode="pro" (absent for Guided) so CSS does the hiding and nothing
// re-renders. Like the theme, it is put there by a pre-paint script, so a Pro
// browser never shows the Guided text for a frame on load.

export type DisplayMode = "guided" | "pro";

export const DISPLAY_MODE_STORAGE_KEY = "spine-scale-display-mode";

export const DISPLAY_MODE_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem(${JSON.stringify(DISPLAY_MODE_STORAGE_KEY)}) === "pro")
      document.documentElement.dataset.mode = "pro";
  } catch (e) {}
})();
`;

export function readStoredMode(): DisplayMode {
  try {
    return localStorage.getItem(DISPLAY_MODE_STORAGE_KEY) === "pro" ? "pro" : "guided";
  } catch {
    return "guided";
  }
}

export function applyMode(mode: DisplayMode) {
  const root = document.documentElement;
  if (mode === "pro") root.dataset.mode = "pro";
  else delete root.dataset.mode;
}

// Read off <html>, which is what is on screen, rather than off storage.
export function isPro(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.mode === "pro";
}

// The wording for a native confirm(): the Guided sentence, or in Pro the
// short one. The short one keeps the cost, the limit and "cannot be undone"
// whenever the long one has them — callers write it that way.
export function confirmText(guided: string, pro: string): string {
  return isPro() ? pro : guided;
}
