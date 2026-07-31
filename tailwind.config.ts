import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F5F4FB",
        surface: "#FFFFFF",
        line: "#E7E5F0",
        accent: "#126DFB",
        accent2: "#3FD1C8",
        ink: "#1C1B27",
        muted: "#6F6C7D",
        ok: "#1FAA6D",
        "ok-soft": "#E7F8EF",
        warn: "#D89B2D",
        "warn-soft": "#FDF3E2",
        bad: "#E14C57",
        "bad-soft": "#FDEBEC",
      },
      boxShadow: {
        card: "0 1px 2px rgba(28, 27, 39, 0.04), 0 4px 12px rgba(28, 27, 39, 0.06)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
