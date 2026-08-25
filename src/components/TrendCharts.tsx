"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useTheme from "@/components/useTheme";

export interface TrendPoint {
  week: string; // short label
  leads: number;
  cpl: number | null;
  showRate: number | null; // 0–100
}

// Recharts writes its colours onto SVG as attributes rather than as CSS, and
// `var()` does not resolve there — so unlike the rest of the app these cannot
// be token classes and have to be real values chosen at render time. The two
// palettes below are the light one this file used to hard-code and its dark
// counterpart, picked with `useTheme()`.
//
// The series colours climb in dark for the same reason the accent token does:
// a bar in #126DFB against a #161B24 card is a dark shape on a dark ground.
// The grid, axis and tick values are simply the line/muted tokens' two
// halves, and the tooltip is the card surface it is supposed to look like.
interface ChartPalette {
  primary: string;
  secondary: string;
  line: string;
  tick: string;
  tooltipBg: string;
  tooltipInk: string;
  cursor: string;
  shadow: string;
}

const PALETTE: Record<"light" | "dark", ChartPalette> = {
  light: {
    primary: "#126DFB",
    secondary: "#3FD1C8",
    line: "#E7E9EE",
    tick: "#6B7280",
    tooltipBg: "#FFFFFF",
    tooltipInk: "#1C1B27",
    cursor: "#F4F5F7",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
  },
  dark: {
    primary: "#4D8DFF",
    secondary: "#3FD1C8",
    line: "#2A313D",
    tick: "#949CAB",
    tooltipBg: "#161B24",
    tooltipInk: "#E8EAF0",
    cursor: "#1E242E",
    shadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
  },
};

// Rounded bar tops, matching the UI's 8-10px radius language.
const BAR_RADIUS: [number, number, number, number] = [8, 8, 0, 0];
const MAX_BAR = 28;

function axisProps(p: ChartPalette) {
  return {
    stroke: p.line,
    tick: { fill: p.tick, fontSize: 11, fontFamily: "var(--font-sans)" },
    tickLine: false as const,
    axisLine: { stroke: p.line },
  };
}

function tooltipProps(p: ChartPalette) {
  return {
    contentStyle: {
      background: p.tooltipBg,
      border: `1px solid ${p.line}`,
      borderRadius: 10,
      boxShadow: p.shadow,
      fontSize: 12,
      fontFamily: "var(--font-sans)",
    },
    labelStyle: { color: p.tick, marginBottom: 4 },
    itemStyle: { color: p.tooltipInk },
    cursor: { fill: p.cursor, opacity: 0.6 },
  };
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactElement;
}) {
  return (
    <div className="card p-6">
      <div className="mb-4 text-xs font-medium tracking-[0.02em] text-muted">
        {title}
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Three single-series panels rather than one multi-axis chart — leads, CPL,
// and show rate are different units and never share an axis.
export default function TrendCharts({ data }: { data: TrendPoint[] }) {
  const palette = PALETTE[useTheme()];
  const AXIS = axisProps(palette);
  const TOOLTIP_STYLE = tooltipProps(palette);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Panel title="Leads / week">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis dataKey="week" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} width={48} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar
            dataKey="leads"
            name="Leads"
            fill={palette.primary}
            radius={BAR_RADIUS}
            maxBarSize={MAX_BAR}
            isAnimationActive={false}
          />
        </BarChart>
      </Panel>
      <Panel title="CPL ($)">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis dataKey="week" {...AXIS} />
          <YAxis {...AXIS} width={48} tickFormatter={(v: number) => `$${v}`} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v: number) => [`$${Number(v).toFixed(2)}`, "CPL"]}
          />
          <Bar
            dataKey="cpl"
            name="CPL"
            fill={palette.primary}
            radius={BAR_RADIUS}
            maxBarSize={MAX_BAR}
            isAnimationActive={false}
          />
        </BarChart>
      </Panel>
      <Panel title="Show rate (%)">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis dataKey="week" {...AXIS} />
          <YAxis
            {...AXIS}
            width={56}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v: number) => [`${Number(v).toFixed(1)}%`, "Show rate"]}
          />
          <Bar
            dataKey="showRate"
            name="Show rate"
            fill={palette.secondary}
            radius={BAR_RADIUS}
            maxBarSize={MAX_BAR}
            isAnimationActive={false}
          />
        </BarChart>
      </Panel>
    </div>
  );
}
