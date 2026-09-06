// One of the Daily KPI page's four goal cards.
//
// Two shapes, one card. A daily metric shows today against today's goal and
// how it moved since yesterday; a monthly one shows month to date against a
// monthly goal and the pace that implies. Which is which is settled by
// DAILY_KPI_CADENCE (src/lib/dailyKpi.ts) and never by the caller.
//
// Four things and no more: the glyph, the label, the number against its goal,
// and one delta line. What the number is counted off used to ride under that
// as a fifth — it lives under the goals form's fields now (DAILY_KPI_BLURBS in
// src/lib/dailyKpi.ts), where it is answering a question somebody is actually
// asking.
//
// Deliberately not the dashboard's KpiCard. That row's tinted disc is a
// gradient with a halo behind it — a lit object, sized for four headline
// numbers on the page a day starts from. This page carries the same four ideas
// at working density: a flat two-tone disc, the sidebar's own type, and
// padding tight enough that the number and its ring read as one object.

import {
  IconCalendarCheck,
  IconMessage2,
  IconSend,
  IconTargetArrow,
} from "@tabler/icons-react";
import Icon from "@/components/Icons";
import ProgressRing from "@/components/ProgressRing";
import {
  DAILY_KPI_HUES,
  DAILY_KPI_LABELS,
  DailyKpiKey,
  MonthlyPace,
  progressPct,
} from "@/lib/dailyKpi";
import SkipDayButton from "@/components/SkipDayButton";

// Tabler at the sidebar's 1.75 stroke, the same four glyphs the dashboard uses
// for the same four ideas — a clinic qualified, a message sent, a reply, a call
// booked.
const GLYPHS: Record<DailyKpiKey, typeof IconTargetArrow> = {
  qualifiedLeads: IconTargetArrow,
  messagesSent: IconSend,
  repliesReceived: IconMessage2,
  meetingsBooked: IconCalendarCheck,
};

// The disc a glyph sits in: one flat wash of the metric's own hue, no gradient
// and no halo. Exported because the chart legend and the breakdown table draw
// the same mark, and three copies of a colour rule is how they drift apart.
// The default is 40 rather than 34: it stands 4px inside the 44px ring across
// the card, which is the proportion the two marks have to hold to read as a
// matched pair at either end of the row. Every card is one line of content
// now, so the pair is the whole visual rhythm of the row.
export function KpiMark({
  metric,
  size = 40,
}: {
  metric: DailyKpiKey;
  size?: number;
}) {
  const hue = DAILY_KPI_HUES[metric];
  const Glyph = GLYPHS[metric];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        color: hue,
        background: `${hue}1A`, // the hue at 10%, flat
      }}
    >
      <Glyph size={Math.round(size * 0.5)} stroke={1.75} aria-hidden />
    </span>
  );
}

export default function DailyKpiCard({
  metric,
  count,
  goal,
  yesterday,
  isToday,
  pace,
  skipped = false,
  skip,
}: {
  metric: DailyKpiKey;
  // Today's count and today's goal for a daily metric; month to date and the
  // monthly goal for a monthly one. The card reads the same either way — what
  // changes is the line under it.
  count: number;
  goal: number;
  yesterday: number;
  isToday: boolean;
  // Present on a monthly metric and absent on a daily one, which is what the
  // card branches on.
  pace?: MonthlyPace;
  // The day has been declared fulfilled for this metric (model DailyKpiSkip),
  // so the ring and the percentage read 100 whatever `count` says. `count`
  // itself stays the real number and a tag says where the 100 came from — a
  // card that quietly showed the goal instead would be the one place on this
  // page that lies about what happened.
  skipped?: boolean;
  // Bound at render time to this day and this metric, and present only on a
  // metric that can be skipped on a day that can still be edited. Absent, no
  // button is drawn.
  skip?: () => Promise<void>;
}) {
  const hue = DAILY_KPI_HUES[metric];
  const pct = skipped ? 100 : progressPct(count, goal);
  const delta = count - yesterday;

  return (
    <div className="card-kpi px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <KpiMark metric={metric} />
        <div className="min-w-0 flex-1">
          {/* The sidebar's own type: 14px, regular weight, no extra tracking.
              A label here is a name for a number, exactly as a nav item is a
              name for a page, and it should not be set louder than one. */}
          <div className="flex items-center gap-1.5">
            <div className="truncate text-sm font-normal leading-tight text-muted">
              {DAILY_KPI_LABELS[metric]}
            </div>
            {/* Where the 100% came from. The same muted pill the rest of the
                page uses for a fact that is not a status. */}
            {skipped && (
              <span className="chip-stat h-[18px] px-2 text-[10px]">
                Skipped
              </span>
            )}
          </div>
          <div className="num mt-1 flex items-baseline gap-1 leading-none">
            <span className="text-[22px] font-semibold tracking-tight">
              {count}
            </span>
            <span className="text-xs font-normal text-muted">/ {goal}</span>
            {pace && (
              <span className="text-xs font-normal text-muted">this month</span>
            )}
          </div>
        </div>

        <ProgressRing
          pct={pct}
          hue={hue}
          size={44}
          stroke={5}
          label={
            pace
              ? `${DAILY_KPI_LABELS[metric]}: ${count} of ${goal} this month, ${pct}% of goal`
              : skipped
                ? `${DAILY_KPI_LABELS[metric]}: ${count} of ${goal}, skipped for this day and counted as 100% of goal`
                : `${DAILY_KPI_LABELS[metric]}: ${count} of ${goal}, ${pct}% of goal`
          }
        >
          <span
            className="num text-[11px] font-semibold"
            style={{ color: hue }}
          >
            {pct}%
          </span>
        </ProgressRing>
      </div>

      {/* The line under the number. A monthly metric says where the month is
          heading; a daily one says which way today moved. An arrow shows for a
          rise and for nothing else — a fall wearing an up arrow would be a lie
          told in an icon. */}
      {pace ? (
        <div
          className={`mt-2.5 flex items-center gap-1 text-xs font-normal ${
            pace.onTrack ? "text-ok" : "text-muted"
          }`}
        >
          {pace.onTrack && <Icon name="arrowUp" className="h-3.5 w-3.5" />}
          On pace for {pace.projected}/{pace.goal} this month
        </div>
      ) : (
        /* The delta is the day's real movement and stays that way when the day
           is skipped: the override forgives the goal, it does not rewrite what
           happened. The skip control sits at the end of the same line rather
           than on one of its own — the row of cards is one line of content
           tall and a second row would break it. */
        <div className="mt-2.5 flex items-center gap-2">
          <div
            className={`flex min-w-0 flex-1 items-center gap-1 text-xs font-normal ${
              delta > 0 ? "text-ok" : delta < 0 ? "text-bad" : "text-muted"
            }`}
          >
            {delta !== 0 && (
              <Icon
                name={delta > 0 ? "arrowUp" : "arrowDown"}
                className="h-3.5 w-3.5"
              />
            )}
            <span className="truncate">
              {delta === 0
                ? `Level with ${isToday ? "yesterday" : "the day before"}`
                : `${Math.abs(delta)} vs ${isToday ? "yesterday" : "the day before"}`}
            </span>
          </div>
          {skip && (
            <SkipDayButton
              skipped={skipped}
              label={DAILY_KPI_LABELS[metric]}
              toggle={skip}
            />
          )}
        </div>
      )}
    </div>
  );
}
