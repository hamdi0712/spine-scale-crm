"use client";

// The last seven days of the two daily metrics.
//
// Lines rather than the bars TrendCharts draws, and one panel rather than two,
// because the pair shares a unit — things you did that day — and the question
// the chart answers is whether they move together. Weekly leads, CPL and show
// rate never shared an axis; these always do.
//
// Replies and meetings are not on it. They are judged month to date now
// (src/lib/dailyKpi.ts), and a daily line for a metric nobody is holding to a
// daily number invites reading a quiet Tuesday as a bad day — which is the
// whole thing the split was made to stop. Their month stands beside the score
// and in the breakdown table instead.
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
  DAILY_GOAL_KEYS,
  DAILY_KPI_HUES,
  DAILY_KPI_LABELS,
} from "@/lib/dailyKpi";

export interface DailyKpiPoint {
  day: string; // short label — "May 22"
  qualifiedLeads: number;
  connectionsSent: number;
}

// Axis furniture in the muted grey the rest of the app sets supporting text
// in, at the same 11px the card blurbs use. The line colours carry the data;
// the scaffolding stays quiet.
const AXIS = {
  stroke: "#E7E9EE",
  tick: {
    fill: "#6B7280",
    fontSize: 11,
    fontWeight: 400,
    fontFamily: "var(--font-sans)",
  },
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
              fontWeight: 400,
              fontFamily: "var(--font-sans)",
              color: "#6B7280",
              paddingTop: 10,
            }}
          />
          {DAILY_GOAL_KEYS.map((key) => (
            <Line
              key={key}
              // Straight segments between the days they connect. A spline
              // through seven sparse points invents a bulge where the data
              // has a step, and a chart of daily counts should not draw a
              // shape the numbers never made.
              type="linear"
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
