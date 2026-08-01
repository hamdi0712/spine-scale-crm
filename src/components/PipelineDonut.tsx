"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";

// Open pipeline value split by stage: a donut with the total in the middle and
// a labelled legend beside it.
//
// Colour. Pipeline stages are a sequence, not a set of unrelated categories —
// a lead moves New → Contacted → Discovery → Proposal → Negotiating — so the
// segments take an ordered ramp rather than eight arbitrary hues, and the
// reader sees the order in the colour. The ramp is built from the two brand
// colours: it starts on a deep shade of the primary blue (#126DFB), passes
// through the primary itself, and ends on a tint of the secondary teal
// (#3FD1C8). Steps are spaced by lightness — each is at least 0.06 OKLCH L
// from its neighbour — so adjacent segments stay apart, and the lightest step
// still clears 2:1 against the white card. The two lightest steps sit under
// 3:1, which is why every segment is also named and valued in the legend
// rather than relying on colour alone.
const STAGE_RAMP = ["#0C46A2", "#0959D2", "#126DFB", "#00A2B0", "#38BCB4"];

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
  // a bug. An empty pipeline gets a plain grey ring and honest zeroes.
  const drawn = total > 0 ? slices : slices.map((s) => ({ ...s, value: 1 }));

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[132px] w-[132px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
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
              stroke="none"
              isAnimationActive={false}
            >
              {drawn.map((slice, i) => (
                <Cell
                  key={slice.stage}
                  fill={total > 0 ? STAGE_RAMP[i % STAGE_RAMP.length] : "#E7E9EE"}
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
