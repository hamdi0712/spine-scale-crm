"use client";

// The lead's ICP score as a ring, drawn the way Monk Mode's Overall Progress
// ring is (src/components/MonkDonut.tsx): a stroked circle with round ends, a
// faceted bevel across its thickness — a shadowed inner face, a lit outer face
// and a narrow chamfer at the rim, as hard creases rather than a blend — an
// unlit band behind it, and the glow thrown outward from the rim.
//
// The earned points are the tier's colour (A takes Monk Mode's own green),
// the rest Monk Mode's grey.

import useTheme from "@/components/useTheme";

interface Shade {
  deep: string;
  base: string;
  lit: string;
}

// Monk Mode's ramps for green and grey, as they are there; amber and red are
// built to the same three-plane spacing.
const RAMP: Record<"light" | "dark", Record<"A" | "B" | "C" | "rest", Shade>> = {
  light: {
    A: { deep: "#128552", base: "#1FAA6D", lit: "#57D39B" },
    B: { deep: "#B46A08", base: "#E08A1E", lit: "#F6B85A" },
    C: { deep: "#B3261E", base: "#DC3D35", lit: "#F2786F" },
    rest: { deep: "#A9B2C4", base: "#C3C9D6", lit: "#DCE1EA" },
  },
  dark: {
    A: { deep: "#1C7F5C", base: "#34D399", lit: "#7DF0C4" },
    B: { deep: "#9A5A10", base: "#F5A524", lit: "#FFCB73" },
    C: { deep: "#9C2F2A", base: "#F2544B", lit: "#FF8F87" },
    rest: { deep: "#333A47", base: "#4A5262", lit: "#697386" },
  },
};

// Monk Mode's geometry, in the SVG's own units; the ring is scaled by CSS.
const BOX = 104;
const CENTRE = BOX / 2;
const INNER = 38;
const OUTER = 49;
const RADIUS = (INNER + OUTER) / 2;
const THICKNESS = OUTER - INNER;
const FACET_FOLD = 0.5;
const FACET_RIM = 0.88;
const MIN_DASH = 1.2;

function acrossRing(t: number): number {
  return (INNER + t * (OUTER - INNER)) / OUTER;
}

export default function ScoreRing({
  total,
  max,
  tier,
  size = 176,
}: {
  total: number | null;
  max: number;
  tier: string | null;
  size?: number;
}) {
  const ramp = useTheme() === "dark" ? RAMP.dark : RAMP.light;
  const earnedShade = tier === "A" || tier === "B" || tier === "C" ? ramp[tier] : ramp.rest;
  const earned = total === null || max <= 0 ? 0 : Math.max(0, Math.min(max, total));
  const rest = max - earned;

  const segments: { key: string; shade: Shade; dash: number; offset: number }[] = [];
  let run = 0;
  for (const [key, value, shade] of [
    ["earned", earned, earnedShade],
    ["rest", rest, ramp.rest],
  ] as const) {
    if (value <= 0) continue;
    const dash = Math.max((value / max) * 100, MIN_DASH);
    segments.push({ key, shade, dash, offset: run });
    run += (value / max) * 100;
  }
  if (segments.length === 0) segments.push({ key: "rest", shade: ramp.rest, dash: 100, offset: 0 });

  // The glow takes the larger part's colour, as Monk Mode's does.
  const glow = (earned >= rest ? earnedShade : ramp.rest).base;
  const scale = size / BOX;

  return (
    <div className="relative mx-auto" style={{ height: size, width: size }}>
      <div
        aria-hidden
        className="absolute rounded-full"
        style={{
          inset: (CENTRE - OUTER) * scale,
          boxShadow: `0 0 ${26 * scale}px ${2 * scale}px ${glow}59, 0 0 ${10 * scale}px 0 ${glow}40`,
        }}
      />
      <svg viewBox={`0 0 ${BOX} ${BOX}`} className="h-full w-full -rotate-90" role="img" aria-label={total === null ? "Not scored" : `${total} out of ${max}`}>
        <defs>
          {segments.map((seg) => (
            <radialGradient key={seg.key} id={`score-bevel-${seg.key}`} gradientUnits="userSpaceOnUse" cx={CENTRE} cy={CENTRE} r={OUTER}>
              <stop offset={acrossRing(0)} stopColor={seg.shade.deep} />
              <stop offset={acrossRing(FACET_FOLD)} stopColor={seg.shade.deep} />
              <stop offset={acrossRing(FACET_FOLD)} stopColor={seg.shade.lit} />
              <stop offset={acrossRing(FACET_RIM)} stopColor={seg.shade.lit} />
              <stop offset={acrossRing(FACET_RIM)} stopColor={seg.shade.base} />
              <stop offset={acrossRing(1)} stopColor={seg.shade.base} />
            </radialGradient>
          ))}
        </defs>
        <circle cx={CENTRE} cy={CENTRE} r={RADIUS} fill="none" stroke={ramp.rest.deep} strokeWidth={THICKNESS} opacity={0.35} />
        {segments.map((seg) => (
          <circle
            key={seg.key}
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS}
            fill="none"
            stroke={`url(#score-bevel-${seg.key})`}
            strokeWidth={THICKNESS}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${seg.dash} ${100 - seg.dash}`}
            strokeDashoffset={-seg.offset}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="num font-semibold leading-none tracking-tight text-ink" style={{ fontSize: 22 * scale }}>
          {total ?? "—"}
        </div>
        <div className="num mt-1 text-muted" style={{ fontSize: 11 * scale }}>
          {total === null ? "Not scored" : `/ ${max}`}
        </div>
      </div>
    </div>
  );
}
