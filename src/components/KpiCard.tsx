// One of the dashboard's four headline numbers.
//
// Used by the dashboard and nowhere else. The card's job is to make the number
// the first thing read and everything else supporting: a tinted glyph to say
// which number it is, a delta line to say which way it moved, and a curve along
// the bottom edge that is decoration and nothing more — see DECORATIVE_CURVE.

import Icon from "@/components/Icons";
import { EMPTY_RAMP, STAGE_RAMP } from "@/lib/dashboardPalette";

// The four cards take their colour from the pipeline donut's palette, one step
// each, in the donut's own order — so the KPI row and the chart at the bottom
// of the page are visibly the same five-colour system read at two sizes.
//
// Each step is a pair. The soft value is the donut's empty-state ramp and it is
// the light under the glass; the strong value is the live ramp at the same
// index and it is the glyph on top. Both arrays are declared in
// src/components/PipelineDonut.tsx and imported rather than copied, so a change
// to the chart's palette moves these with it.
//
// Taking a step each is what separates the cards. Active clients and Pipeline
// value used to be the same blue, which made two of the four read as one; they
// are now steps 0 and 2 — blue and indigo — and no two cards in the row share a
// hue.
export type KpiTone = 0 | 1 | 2 | 3 | 4;

// Percentage → rgba, so a hex from the shared palette can be used at the alphas
// the glass wants without a second set of colours being written down anywhere.
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// The line along the bottom of every card, and it is ornament — it is not
// this metric's history, and there is no history stored to draw one from.
//
// It is deliberately the same path on all four cards. Four different-looking
// curves would invite the reading that each card is showing its own trend, and
// this app is careful about not implying data it does not have (the MRR card
// shows no month-on-month percentage for exactly that reason). One repeated
// shape reads as a house flourish; four unique ones would read as charts. It
// carries aria-hidden and no axis, no labels and no points, for the same
// reason.
const DECORATIVE_CURVE =
  "M0 30 C 22 30, 30 14, 52 15 C 74 16, 82 26, 104 22 C 126 18, 132 6, 156 9 C 178 12, 186 22, 200 18";

export interface Kpi {
  label: string;
  value: string;
  icon: string;
  delta: string;
  tone: "up" | "alert" | "flat";
}

export default function KpiCard({
  kpi,
  tone,
}: {
  kpi: Kpi;
  tone: KpiTone;
}) {
  const soft = EMPTY_RAMP[tone];
  const strong = STAGE_RAMP[tone];
  // Keyed on the label rather than the tone, so no two cards can ever share a
  // DOM id even if the palette is re-pointed.
  const fillId = `kpi-curve-${kpi.label.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="card-kpi p-6 pb-[54px]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium tracking-[0.02em] text-muted">
          {kpi.label}
        </div>
        <div
          className="kpi-mark"
          style={
            {
              color: strong,
              "--mark-tint": alpha(soft, 0.95),
              "--mark-tint-soft": alpha(soft, 0.35),
              "--mark-shadow": alpha(strong, 0.14),
            } as React.CSSProperties
          }
        >
          <Icon name={kpi.icon} className="h-[19px] w-[19px]" />
        </div>
      </div>

      {/* 36px at 700, tracked in. Heavier than the 600 the rest of the app
          caps at, deliberately: this is the one number on the page that is
          meant to be readable across a room. */}
      <div className="num mt-3 text-[36px] font-bold leading-none tracking-[-0.03em]">
        {kpi.value}
      </div>

      <div
        className={`mt-2.5 flex items-center gap-1 text-xs ${
          kpi.tone === "up"
            ? "text-ok"
            : kpi.tone === "alert"
              ? "text-bad"
              : "text-muted"
        }`}
      >
        {kpi.tone !== "flat" && <Icon name="arrowUp" className="h-3.5 w-3.5" />}
        {kpi.delta}
      </div>

      <svg
        viewBox="0 0 200 36"
        preserveAspectRatio="none"
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[44px] w-full"
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strong} stopOpacity="0.14" />
            <stop offset="100%" stopColor={strong} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${DECORATIVE_CURVE} L 200 36 L 0 36 Z`}
          fill={`url(#${fillId})`}
        />
        <path
          d={DECORATIVE_CURVE}
          fill="none"
          stroke={strong}
          strokeOpacity="0.45"
          strokeWidth="2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
