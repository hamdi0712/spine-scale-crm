"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import {
  EMPTY_LIGHT,
  EMPTY_RAMP,
  RAMP_LIGHT,
  STAGE_RAMP,
} from "@/lib/dashboardPalette";

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
  // Recharts draws nothing for an all-zero dataset, and an empty ring reads as
  // a bug. An empty pipeline is drawn as a full ring in the soft ramp, with
  // honest zeroes in the legend and in the middle.
  const drawn = total > 0 ? slices : slices.map((s) => ({ ...s, value: 1 }));

  return (
    <div className="flex items-center gap-4">
      {/* The chart is flat now — no drop shadow under the ring, no lift on the
          segments. What gives it depth instead is the surface behind it: a
          frosted disc, the same glass the KPI marks and the empty-state glyphs
          are drawn in, sized a little proud of the ring so it reads as
          something the chart is resting on rather than a container around it.

          The disc is a sibling of the chart rather than its parent, so it can
          be wider than the ring without boxing it in, and the total in the
          middle stays crisp above both. */}
      <div className="relative h-[142px] w-[142px] shrink-0">
        <div className="donut-glass" aria-hidden />
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              {STAGE_RAMP.map((base, i) => (
                <linearGradient
                  key={base}
                  id={`donut-step-${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={RAMP_LIGHT[i]} />
                  <stop offset="100%" stopColor={base} />
                </linearGradient>
              ))}
              {EMPTY_RAMP.map((base, i) => (
                <linearGradient
                  key={base}
                  id={`donut-empty-${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={EMPTY_LIGHT[i]} />
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
              // A 2px gap of card surface between segments keeps neighbouring
              // steps from bleeding into one another.
              paddingAngle={total > 0 ? 2 : 0}
              // Softened, not pilled: 3px against a 20px-thick ring takes the
              // hard vector corners off where segments meet while keeping the
              // ring reading as a ring.
              cornerRadius={3}
              stroke="none"
              isAnimationActive={false}
            >
              {drawn.map((slice, i) => (
                <Cell
                  key={slice.stage}
                  fill={`url(#donut-${total > 0 ? "step" : "empty"}-${
                    i % STAGE_RAMP.length
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
              style={{ background: STAGE_RAMP[i % STAGE_RAMP.length] }}
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
