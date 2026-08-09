// One of the dashboard's four headline numbers.
//
// Used by the dashboard and nowhere else. The card's job is to make the number
// the first thing read and everything else supporting: a tinted glyph to say
// which number it is, a delta line to say which way it moved, and a curve along
// the bottom edge that is decoration and nothing more — see DECORATIVE_CURVE.

import Icon from "@/components/Icons";

// Four tones, one per card, in the order the row runs.
//
// The lavender is #5A5FE0 — the indigo the status badges already use — rather
// than the app's #7C3AED violet. Violet has one meaning in this app now: a
// control or a panel whose contents came from a model. A KPI card is counted
// from the database, so painting one violet would say something about it that
// is not true.
export type KpiTone = "blue" | "teal" | "indigo";

const KPI_TONES: Record<
  KpiTone,
  { disc: string; glyph: string; curve: string; halo: string }
> = {
  blue: {
    disc: "linear-gradient(135deg, #EAF1FE, #D6E5FD)",
    glyph: "#126DFB",
    curve: "#126DFB",
    halo: "rgba(18, 109, 251, 0.16)",
  },
  teal: {
    disc: "linear-gradient(135deg, #E3F7F5, #CBEFEA)",
    glyph: "#0E9F94",
    curve: "#0E9F94",
    halo: "rgba(14, 159, 148, 0.16)",
  },
  indigo: {
    disc: "linear-gradient(135deg, #EDEEFD, #DEE0FB)",
    glyph: "#5A5FE0",
    curve: "#5A5FE0",
    halo: "rgba(90, 95, 224, 0.16)",
  },
};

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
  const t = KPI_TONES[tone];
  // Keyed on the label rather than the tone: two of the four cards are blue,
  // and two elements sharing a DOM id is invalid however alike they look.
  const fillId = `kpi-curve-${kpi.label.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="card-kpi p-6 pb-[54px]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium tracking-[0.02em] text-muted">
          {kpi.label}
        </div>
        <div
          className="kpi-mark"
          style={{ background: t.disc, color: t.glyph }}
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
            <stop offset="0%" stopColor={t.curve} stopOpacity="0.14" />
            <stop offset="100%" stopColor={t.curve} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${DECORATIVE_CURVE} L 200 36 L 0 36 Z`}
          fill={`url(#${fillId})`}
        />
        <path
          d={DECORATIVE_CURVE}
          fill="none"
          stroke={t.curve}
          strokeOpacity="0.45"
          strokeWidth="2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
