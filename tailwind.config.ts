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
