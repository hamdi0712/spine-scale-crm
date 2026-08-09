import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#FEFEFE",
        panel: "#FAFAFB",
        wash: "#F4F5F7",
        surface: "#FFFFFF",
        line: "#E7E9EE",
        accent: "#126DFB",
        accent2: "#3FD1C8",
        // The AI pair, reserved for controls that spend a model call — the
        // violet the glow and the focus ring are drawn in, and the deep indigo
        // the gradient lands on and the border is seated in. Nothing else in
        // the app should wear them, so purple keeps meaning "this asks the
        // model something".
        ai: "#7C3AED",
        "ai-deep": "#4B32C3",
        ink: "#1C1B27",
        muted: "#6B7280",
        ok: "#1FAA6D",
        "ok-soft": "#E7F8EF",
        warn: "#D89B2D",
        "warn-soft": "#FDF3E2",
        bad: "#E14C57",
        "bad-soft": "#FDEBEC",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0, 0, 0, 0.04)",
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
