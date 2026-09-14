"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import useTheme from "@/components/useTheme";
import { MonkTally } from "@/lib/monkMode";

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

  const slices = [
    { key: "completed", label: "Completed", value: tally.completed, fill: ramp.complete },
    { key: "inProgress", label: "In Progress", value: tally.inProgress, fill: ramp.partial },
    { key: "missed", label: "Missed", value: tally.missed, fill: ramp.missed },
  ];

  // Recharts draws nothing for an all-zero dataset and an empty ring reads as
  // a bug, so the first morning of a challenge — nothing decided yet — is
  // drawn as a full muted ring with honest zeroes beside it.
  const empty = tally.decided === 0;
  const drawn = empty
    ? [{ key: "empty", label: "", value: 1, fill: ramp.missed }]
    : slices;

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[124px] w-[124px] shrink-0">
        <div className="donut-glass" aria-hidden />
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={drawn}
              dataKey="value"
              nameKey="label"
              innerRadius={42}
              outerRadius={60}
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
          <div className="num text-[20px] font-semibold leading-none tracking-tight">
            {tally.pct}%
          </div>
          <div className="num mt-1 text-[11px] text-muted">
            {tally.completed} / {tally.decided || 0}
          </div>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2.5">
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
    </div>
  );
}
