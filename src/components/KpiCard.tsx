// One of the dashboard's four headline numbers.
//
// Used by the dashboard and nowhere else. The card's job is to make the number
// the first thing read and everything else supporting: a tinted glyph to say
// which number it is, and a delta line to say which way it moved.

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
// Blue, teal, purple, pink: a cool run across the wheel rather than four
// unrelated hues, so the row reads as one set while each card still keeps an
// identity a reader can name. It is the same family the AI treatment's gradient
// is drawn from, which is what keeps the dashboard and the assists looking like
// one app.
//
// The purple is the same #7C3AED the AI treatment uses elsewhere. That is worth
// knowing rather than worrying about: nothing on this page is model-generated,
// so the two never appear together, and the AI meaning is carried by the
// sparkle and the gradient rather than by the hue alone.
export type KpiTone = "blue" | "teal" | "purple" | "pink";

const KPI_TONES: Record<KpiTone, string> = {
  blue: "#3B82F6", // people
  teal: "#14B8A6", // revenue
  purple: "#7C3AED", // pipeline
  pink: "#EC4899", // attention
};

// Hex → rgba, so a colour from the shared palette can be used at the alphas the
// glass wants without a second set of colours being written down anywhere.
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

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

  return (
    <div className="card-kpi p-6">
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
          <Glyph size={17} stroke={1.75} aria-hidden />
        </div>
      </div>

      {/* Back to the app's own headline size and weight. 36 at 700 made a card
          half as tall again as it needed to be, and the four of them together
          cost more vertical room than the dashboard has to give — the whole
          page is meant to land on one laptop screen. */}
      <div className="num mt-2 text-[28px] font-semibold leading-none tracking-tight">
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

    </div>
  );
}
