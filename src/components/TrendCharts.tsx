"use client";

import {
  Line,
  LineChart,
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

const AXIS = {
  stroke: "#E7E5F0",
  tick: { fill: "#6F6C7D", fontSize: 11, fontFamily: "var(--font-mono)" },
  tickLine: false as const,
  axisLine: { stroke: "#E7E5F0" },
};

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#FFFFFF",
    border: "1px solid #E7E5F0",
    borderRadius: 8,
    boxShadow: "0 4px 12px rgba(28, 27, 39, 0.08)",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
  },
  labelStyle: { color: "#6F6C7D", marginBottom: 4 },
  itemStyle: { color: "#1C1B27" },
  cursor: { stroke: "#E7E5F0" },
};

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactElement;
}) {
  return (
    <div className="card p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel title="Leads / week">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis dataKey="week" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} width={48} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Line
            type="monotone"
            dataKey="leads"
            name="Leads"
            stroke={PRIMARY}
            strokeWidth={2}
            dot={{ r: 2, fill: PRIMARY, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </Panel>
      <Panel title="CPL ($)">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis dataKey="week" {...AXIS} />
          <YAxis {...AXIS} width={48} tickFormatter={(v: number) => `$${v}`} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v: number) => [`$${Number(v).toFixed(2)}`, "CPL"]}
          />
          <Line
            type="monotone"
            dataKey="cpl"
            name="CPL"
            stroke={PRIMARY}
            strokeWidth={2}
            dot={{ r: 2, fill: PRIMARY, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </Panel>
      <Panel title="Show rate (%)">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis dataKey="week" {...AXIS} />
          <YAxis
            {...AXIS}
            width={48}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v: number) => [`${Number(v).toFixed(1)}%`, "Show rate"]}
          />
          <Line
            type="monotone"
            dataKey="showRate"
            name="Show rate"
            stroke={SECONDARY}
            strokeWidth={2}
            dot={{ r: 2, fill: SECONDARY, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </Panel>
    </div>
  );
}
