import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0D0D12",
        surface: "#16141C",
        line: "#252331",
        accent: "#6366F1",
        ink: "#E4E4EA",
        muted: "#84818A",
        ok: "#3FA575",
        warn: "#C08A3E",
        bad: "#C05257",
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
