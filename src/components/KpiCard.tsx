// One of the dashboard's four headline numbers.
//
// Used by the dashboard and nowhere else. The card's job is to make the number
// the first thing read and everything else supporting: a tinted glyph to say
// which number it is, a delta line to say which way it moved, and a curve along
// the bottom edge that is decoration and nothing more — see DECORATIVE_CURVE.

import {
  IconClockHour3,
  IconCurrencyDollar,
  IconTrendingUp,
  IconUsers,
} from "@tabler/icons-react";
import Icon from "@/components/Icons";

// Tabler, the same set the sidebar's nav is drawn in, at the sidebar's own
// 1.75 stroke. The in-house set is still what the rest of the dashboard uses
// for small inline marks; these four are the page's headline glyphs and they
// belong to the same family as the navigation beside them.
const GLYPHS = {
  clients: IconUsers,
  dollar: IconCurrencyDollar,
  trend: IconTrendingUp,
  clock: IconClockHour3,
} as const;

export type KpiGlyph = keyof typeof GLYPHS;

// One colour per card, given rather than derived — these four are the palette
// for this row and they are named here in full.
//
// They sit outside the pipeline ramp on purpose: that ramp is one sequence from
// blue to teal, and four steps of a sequence can only be so far apart, which is
// what kept clients and pipeline value reading as the same blue. Four hues from
// four parts of the wheel do not have that problem, and each card gets an
// identity a reader can name.
//
// The purple is the same #7C3AED the AI treatment uses elsewhere in the app.
// That is worth knowing rather than worrying about: nothing on this page is
// model-generated, so the two never appear together, and the AI meaning is
// carried by the sparkle and the gradient rather than by the hue alone.
export type KpiTone = "purple" | "emerald" | "blue" | "amber";

const KPI_TONES: Record<KpiTone, string> = {
  purple: "#7C3AED", // people, and the brand
  emerald: "#10B981", // revenue
  blue: "#3B82F6", // pipeline
  amber: "#F59E0B", // attention
};

// Hex → rgba, so a colour from the shared palette can be used at the alphas the
// glass wants without a second set of colours being written down anywhere.
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
  icon: KpiGlyph;
  delta: string;
  tone: "up" | "alert" | "flat";
}

export default function KpiCard({ kpi, tone }: { kpi: Kpi; tone: KpiTone }) {
  const hue = KPI_TONES[tone];
  const Glyph = GLYPHS[kpi.icon];
  // Keyed on the label rather than the tone, so no two cards can ever share a
  // DOM id even if the palette is re-pointed.
  const fillId = `kpi-curve-${kpi.label.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="card-kpi p-6 pb-[54px]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium tracking-[0.02em] text-muted">
          {kpi.label}
        </div>
        {/* The same disc the empty-state glyphs in Recent activity and Client
            health are drawn in: a circle, a soft wash of the card's own hue,
            and a wide halo behind it. One treatment, three places. */}
        <div
          className="kpi-mark"
          style={
            {
              color: hue,
              background: `linear-gradient(140deg, ${alpha(hue, 0.2)}, ${alpha(hue, 0.09)})`,
              "--mark-halo": alpha(hue, 0.1),
            } as React.CSSProperties
          }
        >
          <Glyph size={19} stroke={1.75} aria-hidden />
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
            <stop offset="0%" stopColor={hue} stopOpacity="0.14" />
            <stop offset="100%" stopColor={hue} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${DECORATIVE_CURVE} L 200 36 L 0 36 Z`}
          fill={`url(#${fillId})`}
        />
        <path
          d={DECORATIVE_CURVE}
          fill="none"
          stroke={hue}
          strokeOpacity="0.45"
          strokeWidth="2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
