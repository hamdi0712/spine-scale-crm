// The strip along the bottom of the Pipeline snapshot card.
//
// The donut above it answers "where is the money", by stage and in pounds. This
// answers the other half of the same question — "how many, and how big" — which
// the donut cannot: a stage holding one large lead and a stage holding six
// small ones draw the same arc. Four stage counts and the average size of a
// lead is the smallest set that tells those two apart.
//
// Each tile takes its stage's own colour from the donut's ramp, so a tile and
// the arc it counts are the same blue. Average deal size is not a stage and
// takes the KPI row's purple instead.
//
// Server-rendered: it is five numbers and no interaction.

import {
  IconFileText,
  IconMessages,
  IconSearch,
  IconTrendingUp,
  IconUserPlus,
} from "@tabler/icons-react";
import { STAGE_RAMP } from "@/lib/dashboardPalette";

const STATS = {
  newLeads: { label: "New leads", Glyph: IconUserPlus, hue: STAGE_RAMP[0] },
  discovery: { label: "Discovery", Glyph: IconSearch, hue: STAGE_RAMP[2] },
  proposals: { label: "Proposals", Glyph: IconFileText, hue: STAGE_RAMP[3] },
  negotiating: { label: "Negotiating", Glyph: IconMessages, hue: STAGE_RAMP[4] },
  // Not a stage, so not from the ramp — the KPI row's purple, which is the
  // dashboard's colour for a number about the business rather than about a
  // step in it.
  avgDeal: { label: "Avg. deal size", Glyph: IconTrendingUp, hue: "#7C3AED" },
} as const;

export type PipelineStatKey = keyof typeof STATS;

export interface PipelineStat {
  key: PipelineStatKey;
  value: string;
  // What the number is counted over, where that is worth stating. Carried as a
  // hover title rather than as copy, because a tile this size has room for a
  // number and a label and nothing else.
  title?: string;
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export default function PipelineStats({ stats }: { stats: PipelineStat[] }) {
  return (
    <div className="mt-5 grid grid-cols-5 divide-x divide-line/70 border-t border-line/70 pt-4">
      {stats.map((stat) => {
        const { label, Glyph, hue } = STATS[stat.key];
        return (
          <div
            key={stat.key}
            title={stat.title}
            className="flex min-w-0 flex-col items-center px-1.5 text-center"
          >
            <span
              className="mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
              style={{
                color: hue,
                background: `linear-gradient(140deg, ${alpha(hue, 0.16)}, ${alpha(hue, 0.07)})`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 2px ${alpha(hue, 0.12)}`,
              }}
            >
              <Glyph size={16} stroke={1.75} aria-hidden />
            </span>
            {/* 15px and nowrap: five columns in a third-width card leave about
                70px each, and a four-figure money value at the headline size
                either broke over two lines or ran into the divider. */}
            <span
              className="num whitespace-nowrap text-[15px] font-semibold leading-none tracking-tight"
              style={{ color: hue }}
            >
              {stat.value}
            </span>
            <span className="mt-1.5 text-[10px] leading-tight text-muted">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
