// One of the Daily KPI page's four goal cards.
//
// The same shell as the dashboard's headline row (.card-kpi, the tinted disc,
// the app's numeric type scale) with the one thing that row does not have: a
// goal. The number is read against it twice over — as current/goal, and as the
// ring beside it — and the line underneath says which way the day moved
// compared with the same count yesterday.
//
// Yesterday's count is a real query over yesterday, not a stored snapshot: all
// four metrics are read off timestamped records, so "yesterday" is the same
// question asked about a different day (src/lib/dailyKpiStore.ts).

import {
  IconCalendarCheck,
  IconMessage2,
  IconTargetArrow,
  IconUserPlus,
} from "@tabler/icons-react";
import Icon from "@/components/Icons";
import ProgressRing from "@/components/ProgressRing";
import {
  DAILY_KPI_BLURBS,
  DAILY_KPI_HUES,
  DAILY_KPI_LABELS,
  DailyKpiKey,
  progressPct,
} from "@/lib/dailyKpi";

// Tabler at the sidebar's 1.75 stroke, the same four glyphs the dashboard's
// KPI row uses for the same four ideas — a clinic qualified, a request sent, a
// reply, a call booked.
const GLYPHS: Record<DailyKpiKey, typeof IconTargetArrow> = {
  qualifiedLeads: IconTargetArrow,
  connectionsSent: IconUserPlus,
  repliesReceived: IconMessage2,
  meetingsBooked: IconCalendarCheck,
};

// Hex → rgba, so the disc's wash and halo come from the one hue named in
// src/lib/dailyKpi.ts rather than from a second set of colours.
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export default function DailyKpiCard({
  metric,
  count,
  goal,
  yesterday,
  isToday,
}: {
  metric: DailyKpiKey;
  count: number;
  goal: number;
  yesterday: number;
  isToday: boolean;
}) {
  const hue = DAILY_KPI_HUES[metric];
  const Glyph = GLYPHS[metric];
  const pct = progressPct(count, goal);
  const delta = count - yesterday;

  return (
    <div className="card-kpi p-5">
      <div className="flex items-center gap-2.5">
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
        <div className="min-w-0 flex-1 text-xs font-medium leading-snug tracking-[0.02em] text-muted">
          {DAILY_KPI_LABELS[metric]}
        </div>
      </div>

      {/* The count, the goal and the ring on one line: three readings of the
          same thing, so they sit together rather than stacking. The count and
          the goal are one phrase — the number at the page’s headline size and
          the goal beside it in the muted tier. */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="num flex items-baseline gap-1.5 leading-none">
          <span className="text-[28px] font-semibold tracking-tight">
            {count}
          </span>
          <span className="text-sm font-medium text-muted">/ {goal}</span>
        </div>

        <ProgressRing
          pct={pct}
          hue={hue}
          label={`${DAILY_KPI_LABELS[metric]}: ${count} of ${goal}, ${pct}% of goal`}
        >
          <span className="num text-[12px] font-semibold" style={{ color: hue }}>
            {pct}%
          </span>
        </ProgressRing>
      </div>

      {/* The comparison line. An arrow shows for a rise and for nothing else —
          a fall wearing an up arrow would be a lie told in an icon, which is
          the rule the dashboard's delta line already follows. */}
      <div
        className={`mt-3 flex items-center gap-1 text-xs ${
          delta > 0 ? "text-ok" : delta < 0 ? "text-bad" : "text-muted"
        }`}
      >
        {delta !== 0 && (
          <Icon
            name={delta > 0 ? "arrowUp" : "arrowDown"}
            className="h-3.5 w-3.5"
          />
        )}
        {delta === 0
          ? `Level with ${isToday ? "yesterday" : "the day before"}`
          : `${Math.abs(delta)} vs ${isToday ? "yesterday" : "the day before"}`}
      </div>

      <div className="mt-1 text-[11px] leading-relaxed text-muted">
        {DAILY_KPI_BLURBS[metric]}
      </div>
    </div>
  );
}
