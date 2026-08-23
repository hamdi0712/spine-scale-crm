"use client";

// The last seven days, all four metrics on one chart.
//
// Lines rather than the bars TrendCharts draws, and one panel rather than
// three, because these four share a unit — things done in a day — and the
// question the chart answers is whether they move together. Weekly leads, CPL
// and show rate never shared an axis; these always do.
//
// The axis, tooltip and grid treatment are lifted from TrendCharts unchanged,
// so the two charts in the app are drawn in one language.

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DAILY_KPI_HUES,
  DAILY_KPI_KEYS,
  DAILY_KPI_LABELS,
} from "@/lib/dailyKpi";

export interface DailyKpiPoint {
  day: string; // short label — "May 22"
  qualifiedLeads: number;
  connectionsSent: number;
  repliesReceived: number;
  meetingsBooked: number;
}

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
};

export default function DailyKpiTrend({ data }: { data: DailyKpiPoint[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
          {/* Horizontal rules only. Vertical ones would fence seven days into
              seven columns, and the point of a line is that it crosses them. */}
          <CartesianGrid stroke="#F1F2F5" vertical={false} />
          <XAxis dataKey="day" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} width={44} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend
            iconType="plainline"
            iconSize={14}
            wrapperStyle={{
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              color: "#6B7280",
              paddingTop: 8,
            }}
          />
          {DAILY_KPI_KEYS.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={DAILY_KPI_LABELS[key]}
              stroke={DAILY_KPI_HUES[key]}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: DAILY_KPI_HUES[key] }}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
