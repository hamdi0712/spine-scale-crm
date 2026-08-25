"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import {
  EMPTY_LIGHT,
  EMPTY_LIGHT_DARK,
  EMPTY_RAMP,
  EMPTY_RAMP_DARK,
  RAMP_LIGHT,
  RAMP_LIGHT_DARK,
  STAGE_RAMP,
  STAGE_RAMP_DARK,
} from "@/lib/dashboardPalette";
import useTheme from "@/components/useTheme";

// Open pipeline value split by stage: a donut with the total in the middle and
// a labelled legend beside it. The ramp it is drawn in lives in
// src/lib/dashboardPalette.ts, where the KPI row reads it too.
export interface PipelineSlice {
  stage: string;
  label: string;
  value: number;
}

export default function PipelineDonut({
  slices,
  total,
}: {
  slices: PipelineSlice[];
  total: number;
}) {
  // The gradient stops go onto SVG as attributes, so — as with every other
  // chart in the app — the ramp has to be a real value picked here rather than
  // a token the stylesheet swaps.
  const dark = useTheme() === "dark";
  const stageRamp = dark ? STAGE_RAMP_DARK : STAGE_RAMP;
  const rampLight = dark ? RAMP_LIGHT_DARK : RAMP_LIGHT;
  const emptyRamp = dark ? EMPTY_RAMP_DARK : EMPTY_RAMP;
  const emptyLight = dark ? EMPTY_LIGHT_DARK : EMPTY_LIGHT;
  // Recharts draws nothing for an all-zero dataset, and an empty ring reads as
  // a bug. An empty pipeline is drawn as a full ring in the soft ramp, with
  // honest zeroes in the legend and in the middle.
  const drawn = total > 0 ? slices : slices.map((s) => ({ ...s, value: 1 }));

  return (
    <div className="flex items-center gap-5">
      {/* The chart is flat and the ring is one closed circle. What sits behind
          it is light rather than a container: a wash that fades out before the
          disc's own edge, so there is nothing with a rim to be read as a second
          circle around the first. It is a sibling of the chart, not its parent,
          and the total in the middle stays crisp above both. */}
      <div className="relative h-[132px] w-[132px] shrink-0">
        <div className="donut-glass" aria-hidden />
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              {stageRamp.map((base, i) => (
                <linearGradient
                  key={base}
                  id={`donut-step-${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={rampLight[i]} />
                  <stop offset="100%" stopColor={base} />
                </linearGradient>
              ))}
              {emptyRamp.map((base, i) => (
                <linearGradient
                  key={base}
                  id={`donut-empty-${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={emptyLight[i]} />
                  <stop offset="100%" stopColor={base} />
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={drawn}
              dataKey="value"
              nameKey="label"
              innerRadius={44}
              outerRadius={64}
              startAngle={90}
              endAngle={-270}
              // No gaps and no rounded ends: the ring is one clean, closed
              // circle. Segments are told apart by colour and by the legend
              // beside them, which is what they were always told apart by —
              // the gaps and the soft corners were breaking the circle to
              // repeat information the legend already carries.
              paddingAngle={0}
              cornerRadius={0}
              stroke="none"
              isAnimationActive={false}
            >
              {drawn.map((slice, i) => (
                <Cell
                  key={slice.stage}
                  fill={`url(#donut-${total > 0 ? "step" : "empty"}-${
                    i % stageRamp.length
                  })`}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="num text-[17px] font-semibold leading-none tracking-tight">
            {fmtMoney(total)}
          </div>
          <div className="mt-1 text-[11px] text-muted">Total value</div>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((slice, i) => (
          <li key={slice.stage} className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: stageRamp[i % stageRamp.length] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {slice.label}
            </span>
            <span className="num shrink-0 text-xs font-medium">
              {fmtMoney(slice.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
