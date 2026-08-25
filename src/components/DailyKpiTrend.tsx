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
// so the two charts in the app are drawn in one language. What is not lifted
// is the curve and the fill: this one is drawn as a soft shape rather than a
// wireframe, because it is the panel a person looks at first.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DAILY_GOAL_KEYS,
  DAILY_KPI_LABELS,
  type DailyKpiKey,
} from "@/lib/dailyKpi";
import useTheme from "@/components/useTheme";

export interface DailyKpiPoint {
  day: string; // short label — "May 22"
  qualifiedLeads: number;
  messagesSent: number;
}

// This is the one chart that cannot use DAILY_KPI_HUES' token references.
// Recharts puts colours on SVG as attributes — `stroke`, and the `stopColor`
// of the gradient stops under each curve — and `var()` does not resolve there.
// So the four hues are written out literally in both themes, and must be kept
// in step with the --kpi-* tokens in globals.css if either moves.
//
// Dark lifts each hue for the same reason the tokens do: the fill under a
// curve is the hue at 22% and less, and a mid-tone at 22% over a #161B24 card
// is not a glow, it is nothing.
const SERIES: Record<"light" | "dark", Record<DailyKpiKey, string>> = {
  light: {
    qualifiedLeads: "#3B82F6",
    messagesSent: "#14B8A6",
    repliesReceived: "#7C3AED",
    meetingsBooked: "#EC4899",
  },
  dark: {
    qualifiedLeads: "#60A5FA",
    messagesSent: "#2DD4BF",
    repliesReceived: "#A78BFA",
    meetingsBooked: "#F472B6",
  },
};

// Axis furniture in the muted grey the rest of the app sets supporting text
// in, at the same 11px the card blurbs use. The line colours carry the data;
// the scaffolding stays quiet. Lifted from TrendCharts, dark values included,
// so the two charts in the app stay one language.
interface Furniture {
  line: string;
  grid: string;
  tick: string;
  tooltipBg: string;
  tooltipInk: string;
  shadow: string;
}

const FURNITURE: Record<"light" | "dark", Furniture> = {
  light: {
    line: "#E7E9EE",
    grid: "#F1F2F5",
    tick: "#6B7280",
    tooltipBg: "#FFFFFF",
    tooltipInk: "#1C1B27",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
  },
  dark: {
    line: "#2A313D",
    // A touch lighter than the border, as in light — the rules behind the
    // curves are quieter than the axis that frames them.
    grid: "#242B36",
    tick: "#949CAB",
    tooltipBg: "#161B24",
    tooltipInk: "#E8EAF0",
    shadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
  },
};

function axisProps(f: Furniture) {
  return {
    stroke: f.line,
    tick: {
      fill: f.tick,
      fontSize: 11,
      fontWeight: 400,
      fontFamily: "var(--font-sans)",
    },
    tickLine: false as const,
    axisLine: { stroke: f.line },
  };
}

function tooltipProps(f: Furniture) {
  return {
    contentStyle: {
      background: f.tooltipBg,
      border: `1px solid ${f.line}`,
      borderRadius: 10,
      boxShadow: f.shadow,
      fontSize: 12,
      fontFamily: "var(--font-sans)",
    },
    labelStyle: { color: f.tick, marginBottom: 4 },
    itemStyle: { color: f.tooltipInk },
  };
}

export default function DailyKpiTrend({ data }: { data: DailyKpiPoint[] }) {
  const theme = useTheme();
  const hues = SERIES[theme];
  const AXIS = axisProps(FURNITURE[theme]);
  const TOOLTIP_STYLE = tooltipProps(FURNITURE[theme]);
  return (
    <div>
      {/* The legend, as two pills at the top right rather than a line of text
          under the plot.

          It is plain markup and not Recharts' <Legend>, which can only be
          styled as far as its own wrapper: a pill needs a background, a radius
          and a dot of its own, and building that inside a chart renderer is
          more machinery than reading two names is worth. Up here it is also
          read before the curves rather than after them, which is the order a
          legend is actually useful in. */}
      <div className="mb-1 flex flex-wrap items-center justify-end gap-2">
        {DAILY_GOAL_KEYS.map((key) => (
          <span
            key={key}
            className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-line/70 bg-surface px-2.5 text-[12px] font-medium text-muted"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: hues[key] }}
              aria-hidden
            />
            {DAILY_KPI_LABELS[key]}
          </span>
        ))}
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
          >
            {/* One gradient per series, from the line's own hue at a light
                wash down to nothing — a glow under the curve rather than a
                block of colour, so the two areas can overlap without either
                becoming a solid the other disappears behind. */}
            <defs>
              {DAILY_GOAL_KEYS.map((key) => (
                <linearGradient
                  key={key}
                  id={`daily-kpi-fill-${key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={hues[key]}
                    stopOpacity={0.22}
                  />
                  <stop
                    offset="100%"
                    stopColor={hues[key]}
                    stopOpacity={0}
                  />
                </linearGradient>
              ))}
            </defs>

            {/* Horizontal rules only. Vertical ones would fence seven days into
                seven columns, and the point of a line is that it crosses them. */}
            <CartesianGrid stroke={FURNITURE[theme].grid} vertical={false} />
            <XAxis dataKey="day" {...AXIS} />
            <YAxis {...AXIS} allowDecimals={false} width={44} />
            <Tooltip {...TOOLTIP_STYLE} />
            {DAILY_GOAL_KEYS.map((key) => (
              <Area
                key={key}
                // Monotone rather than a plain spline. It still passes through
                // every day's value and it cannot overshoot between two of
                // them — a rise from 4 to 9 curves up to 9 and stops, where a
                // natural spline arcs past it and draws a day that never
                // happened. Linear was the earlier fix for that; this keeps
                // the honesty and loses the sawtooth.
                type="monotone"
                dataKey={key}
                name={DAILY_KPI_LABELS[key]}
                stroke={hues[key]}
                strokeWidth={2}
                fill={`url(#daily-kpi-fill-${key})`}
                fillOpacity={1}
                dot={{ r: 2.5, strokeWidth: 0, fill: hues[key] }}
                activeDot={{ r: 4, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
