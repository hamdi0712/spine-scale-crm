"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendPoint {
  week: string; // short label
  leads: number;
  cpl: number | null;
  showRate: number | null; // 0–100
}

// Primary accent for headline series; the teal secondary accent is reserved
// for the secondary series (show rate).
const PRIMARY = "#126DFB";
const SECONDARY = "#3FD1C8";

// Rounded bar tops, matching the UI's 8-10px radius language.
const BAR_RADIUS: [number, number, number, number] = [8, 8, 0, 0];
const MAX_BAR = 28;

const AXIS = {
  stroke: "#E7E9EE",
  tick: { fill: "#6B7280", fontSize: 11, fontFamily: "var(--font-sans)" },
  tickLine: false as const,
  axisLine: { stroke: "#E7E9EE" },
};

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#FFFFFF",
    border: "1px solid #E7E9EE",
    borderRadius: 10,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
    fontSize: 12,
    fontFamily: "var(--font-sans)",
  },
  labelStyle: { color: "#6B7280", marginBottom: 4 },
  itemStyle: { color: "#1C1B27" },
  cursor: { fill: "#F4F5F7", opacity: 0.6 },
};

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
            fill={PRIMARY}
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
            fill={PRIMARY}
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
            fill={SECONDARY}
            radius={BAR_RADIUS}
            maxBarSize={MAX_BAR}
            isAnimationActive={false}
          />
        </BarChart>
      </Panel>
    </div>
  );
}
