import type { Config } from "tailwindcss";

// Every colour in the app is a semantic token, and every token resolves to a
// CSS custom property holding a bare `R G B` triple. Two things fall out of
// that: the light and dark values live together in globals.css rather than
// being scattered through the components, and Tailwind's opacity modifiers
// (bg-accent/10, border-line/60) keep working, because the triple is fed
// through rgb(… / <alpha-value>) rather than being a finished colour.
//
// Nothing here changes what light mode looks like — each --c-* light value is
// the hex that used to be written in this file, converted to a triple.
const c = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Class strategy rather than media: the toggle in the sidebar puts `dark` on
  // <html>, so an explicit choice can disagree with the OS.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: c("bg"),
        panel: c("panel"),
        wash: c("wash"),
        surface: c("surface"),
        line: c("line"),
        accent: c("accent"),
        "accent-hover": c("accent-hover"),
        "accent-press": c("accent-press"),
        "accent-soft": c("accent-soft"),
        accent2: c("accent2"),
        // The AI pair, reserved for controls that spend a model call — the
        // violet the glow and the focus ring are drawn in, and the deep indigo
        // the gradient lands on and the border is seated in. Nothing else in
        // the app should wear them, so purple keeps meaning "this asks the
        // model something".
        ai: c("ai"),
        "ai-deep": c("ai-deep"),
        "ai-soft": c("ai-soft"),
        ink: c("ink"),
        "ink-soft": c("ink-soft"),
        muted: c("muted"),
        ok: c("ok"),
        "ok-soft": c("ok-soft"),
        "ok-on-soft": c("ok-on-soft"),
        warn: c("warn"),
        "warn-soft": c("warn-soft"),
        "warn-on-soft": c("warn-on-soft"),
        bad: c("bad"),
        "bad-soft": c("bad-soft"),
        "bad-on-soft": c("bad-on-soft"),
        // The badge hues that were arbitrary values at their call sites.
        teal: c("teal"),
        "teal-soft": c("teal-soft"),
        indigo: c("indigo"),
        "indigo-soft": c("indigo-soft"),
        purple: c("purple"),
        "purple-soft": c("purple-soft"),
        pink: c("pink"),
        // The navy hero widget keeps its own scale: it is dark on a light page
        // by design, and stays a distinct focal surface on a dark one.
        hero: c("hero"),
        "hero-ink": c("hero-ink"),
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
      },
      // The app's one transition timing, declared once in globals.css and made
      // the default for every Tailwind `transition-*` utility here. That is
      // what keeps the motion consistent without every call site having to
      // remember a duration: `transition-colors` on a checklist row and the
      // hand-written transition on a card are the same 160ms curve.
      transitionDuration: {
        DEFAULT: "var(--motion)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--motion-ease)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        num: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
