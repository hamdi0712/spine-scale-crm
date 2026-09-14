"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import useTheme from "@/components/useTheme";
import { MonkTally, monkProgressNote } from "@/lib/monkMode";
import MonkStatBadge from "@/components/MonkStatBadge";

// Overall progress: every habit-day of the challenge so far, split three ways,
// with the completion percentage in the middle.
//
// The same object as the dashboard's PipelineDonut — flat ring, no gaps, no
// rounded ends, the figure in the hole — because it is the same reading in a
// different subject, and the app should not have two kinds of donut.
//
// Today's untouched habits are counted as pending and kept out of both the
// ring and the percentage: a habit nobody has got to yet at nine in the
// morning is not a failure, and folding it into "Missed" would open every day
// at zero and walk it up to something respectable by bedtime.

// Drawn here rather than as tokens: the stops go onto SVG as attributes, so —
// as with every other chart in the app — the ramp has to be a real value
// picked against the theme rather than a variable the stylesheet swaps.
const RAMP = {
  light: { complete: "#1FAA6D", partial: "#126DFB", missed: "#C3C9D6" },
  dark: { complete: "#34D399", partial: "#4D8DFF", missed: "#4A5262" },
};

export default function MonkDonut({ tally }: { tally: MonkTally }) {
  const ramp = useTheme() === "dark" ? RAMP.dark : RAMP.light;
  const note = monkProgressNote(tally.pct, tally.decided);

  const slices = [
    { key: "completed", label: "Completed", value: tally.completed, fill: ramp.complete },
    { key: "inProgress", label: "In Progress", value: tally.inProgress, fill: ramp.partial },
    { key: "missed", label: "Missed", value: tally.missed, fill: ramp.missed },
  ];

  // Recharts draws nothing for an all-zero dataset and an empty ring reads as
  // a bug, so the first morning of a challenge — nothing decided yet — is
  // drawn as a full muted ring with honest zeroes beside it.
  const empty = tally.decided === 0;
  // The glow takes the colour of the largest slice — the chart's own summary,
  // rather than a fixed accent that would say "going well" through a bad week.
  const glow = empty
    ? ramp.missed
    : tally.completed >= tally.missed
      ? ramp.complete
      : ramp.missed;
  const drawn = empty
    ? [{ key: "empty", label: "", value: 1, fill: ramp.missed }]
    : slices;

  return (
    // The ring over its legend rather than beside it. The panel is one of four
    // in a row now, and at a quarter of the page a ring and three labelled
    // counts side by side leaves neither enough room — stacked, the ring gets
    // the width it wants and the counts read as a table under it.
    // flex-1 rather than h-full: h-full resolves against the card's whole
    // height, heading included, so the ring and its legend together came to
    // more than the space left under the heading and the last legend row fell
    // out of the bottom of the card. As a flex child of a column card this
    // takes what is actually left.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mx-auto my-auto h-[104px] w-[104px]">
        {/* The glow, behind the ring and sized to it. A wide blurred disc in
            whichever colour is winning, which is what gives a thin ring
            something to sit in — at nine pixels of stroke the chart had no
            presence of its own left. Blur rather than a box-shadow because the
            ring is an SVG arc, not a box, and a shadow would trace the square
            around it. */}
        <div
          aria-hidden
          className="absolute inset-[12px] rounded-full blur-[16px]"
          style={{ background: glow, opacity: 0.55 }}
        />
        <div className="donut-glass" aria-hidden />
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={drawn}
              dataKey="value"
              nameKey="label"
              innerRadius={40}
              outerRadius={48}
              startAngle={90}
              endAngle={-270}
              paddingAngle={0}
              cornerRadius={0}
              stroke="none"
              isAnimationActive={false}
            >
              {drawn.map((slice) => (
                <Cell key={slice.key} fill={slice.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="num text-[22px] font-semibold leading-none tracking-tight">
            {tally.pct}%
          </div>
          <div className="num mt-1 text-[11px] text-muted">
            {tally.completed} / {tally.decided}
          </div>
        </div>
      </div>

      <ul className="mt-3 shrink-0 space-y-2 border-t border-line/60 pt-3">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: slice.fill }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {slice.label}
            </span>
            <span className="num shrink-0 text-xs font-medium">
              {slice.value}
            </span>
          </li>
        ))}
      </ul>

      {/* The line, at the foot of the card and in its own strip. It is the one
          thing here a percentage cannot say for itself — whether the number is
          worth feeling good about — and it carries a mark chosen by the same
          band that chose the words (monkProgressNote), so a bad patch and a
          finished run do not get the same encouraging star. */}
      <div className="mt-3 shrink-0">
        <MonkStatBadge icon={note.icon} tone="blue">
          {note.text}
        </MonkStatBadge>
      </div>
    </div>
  );
}
