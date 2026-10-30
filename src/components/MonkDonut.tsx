"use client";

import useTheme from "@/components/useTheme";
import { MonkTally, monkProgressNote } from "@/lib/monkMode";
import MonkStatBadge from "@/components/MonkStatBadge";

// Overall progress: every habit-day of the challenge so far, split three ways,
// with the completion percentage in the middle.
//
// It began as a copy of the dashboard's PipelineDonut — flat ring, square
// ends — and has deliberately stopped being one. The pipeline donut is a chart
// on a white card in a row of businesslike panels; this one sits on a dark
// dashboard between a painted banner and seven illustrated cards, and a flat
// two-tone ring in that company looked like a placeholder somebody forgot to
// finish. It is a lit object now: a bevel across the thickness, rounded ends
// where the colours meet, and the light it throws falling outside it.
//
// Three things make it, and each is a specific correction:
//
//   The bevel, and it is faceted rather than rounded. A radial gradient in
//   user space banded across the ring's own thickness, but with every stop
//   doubled so the colour steps rather than blends: three flat planes meeting
//   at two hard creases. A smooth ramp across the same three values reads as a
//   cylinder — a piece of tube — and what this wants to be is a strip of
//   something flat, bent along its length. The creases are the whole
//   difference, and they only exist if nothing interpolates across them.
//
//   Rounded ends, which is why this is no longer a Recharts pie. Its
//   cornerRadius rounds each sector's four corners, and on a sector narrower
//   than twice that radius the arc collapses into a rhombus — three
//   habit-days out of ninety-one came out as a small blue diamond floating in
//   the ring. So the ring is a stroked circle with a dash per segment and a
//   round linecap: a sliver becomes a short pill, which is the right answer
//   at any size, and where two colours meet their caps overlap into the
//   curved seam the reference has instead of a radius ruled straight across.
//
//   The glow, outside. It used to be a blurred disc sitting in the hole,
//   which lit the middle of the ring from within and muddied the figure
//   printed over it. Light comes off the ring outward now, into the card.
//
// Today's untouched habits are counted as pending and kept out of both the
// ring and the percentage: a habit nobody has got to yet at nine in the
// morning is not a failure, and folding it into "Missed" would open every day
// at zero and walk it up to something respectable by bedtime.

// Drawn here rather than as tokens: the stops go onto SVG as attributes, so —
// as with every other chart in the app — the ramp has to be a real value
// picked against the theme rather than a variable the stylesheet swaps.
// Three stops per state rather than one: the shadowed inner edge, the lit
// face, and the rim. Hand-picked rather than computed from a single hue,
// because a mechanical lighten/darken of a green and of a grey do not read as
// the same material — the grey needs far less separation than the green to
// look like the same lighting.
interface Shade {
  deep: string;
  base: string;
  lit: string;
}

const RAMP: Record<"light" | "dark", Record<string, Shade>> = {
  light: {
    complete: { deep: "#128552", base: "#1FAA6D", lit: "#57D39B" },
    partial: { deep: "#0B4FBB", base: "#126DFB", lit: "#5E9BFF" },
    missed: { deep: "#A9B2C4", base: "#C3C9D6", lit: "#DCE1EA" },
  },
  dark: {
    complete: { deep: "#1C7F5C", base: "#34D399", lit: "#7DF0C4" },
    partial: { deep: "#2D5CB8", base: "#4D8DFF", lit: "#8FB8FF" },
    missed: { deep: "#333A47", base: "#4A5262", lit: "#697386" },
  },
};

// The ring's geometry, in the SVG's own units. Declared once because the bevel
// gradient has to be expressed as offsets along the radius, which means the
// gradient and the arc cannot be allowed to disagree about where the ring is.
const BOX = 104;
const CENTRE = BOX / 2;
const INNER = 38;
const OUTER = 49;
// The stroke runs down the middle of the band, so the circle's radius is the
// band's midline and its width is the band's thickness.
const RADIUS = (INNER + OUTER) / 2;
const THICKNESS = OUTER - INNER;

// Where the creases fall across the ring's thickness, as fractions from the
// inner edge.
//
// The first is the fold itself and it sits at the middle: two planes of equal
// width, one turned away from the light and one towards it, is what makes the
// band read as a flat strip bent along its length. Three bands of similar
// width — which is where this started — read as three concentric rings
// instead, because nothing about them says which is the near face and which
// is the far one.
//
// The second is much closer to the rim and is doing a different job: a narrow
// chamfer so the outer edge turns away rather than running to the very edge at
// full brightness, which would make the strip look like it was glowing rather
// than lit.
const FACET_FOLD = 0.5;
const FACET_RIM = 0.88;

// An offset along the gradient's radius, given a position across the ring's
// thickness. `0` is the inner edge, `1` the rim.
function acrossRing(t: number): number {
  return (INNER + t * (OUTER - INNER)) / OUTER;
}

// A segment's dash, as a share of the circle.
//
// pathLength="100" on the circle rescales the dash units to hundredths of the
// circumference, so a slice's share is its dash length and there is no 2πr in
// this file at all. The floor keeps a segment that rounds to nothing from
// vanishing: one habit-day out of three hundred is still a thing that
// happened, and a round cap draws it as a dot.
const MIN_DASH = 1.2;

interface Segment {
  key: string;
  shade: Shade;
  dash: number;
  offset: number;
}

function toSegments(
  slices: { key: string; value: number; shade: Shade }[],
  total: number,
): Segment[] {
  const out: Segment[] = [];
  let run = 0;
  for (const slice of slices) {
    if (slice.value <= 0) continue;
    const dash = Math.max((slice.value / total) * 100, MIN_DASH);
    out.push({ key: slice.key, shade: slice.shade, dash, offset: run });
    run += (slice.value / total) * 100;
  }
  return out;
}

export default function MonkDonut({ tally }: { tally: MonkTally }) {
  const ramp = useTheme() === "dark" ? RAMP.dark : RAMP.light;
  const note = monkProgressNote(tally.pct, tally.decided);

  const slices = [
    { key: "completed", label: "Completed", value: tally.completed, shade: ramp.complete },
    { key: "inProgress", label: "In Progress", value: tally.inProgress, shade: ramp.partial },
    { key: "missed", label: "Missed", value: tally.missed, shade: ramp.missed },
  ];

  // Recharts draws nothing for an all-zero dataset and an empty ring reads as
  // a bug, so the first morning of a challenge — nothing decided yet — is
  // drawn as a full muted ring with honest zeroes beside it.
  const empty = tally.decided === 0;
  // The glow takes the colour of the largest slice — the chart's own summary,
  // rather than a fixed accent that would say "going well" through a bad week.
  const glow = (
    empty
      ? ramp.missed
      : tally.completed >= tally.missed
        ? ramp.complete
        : ramp.missed
  ).base;
  const drawn = empty
    ? [{ key: "empty", label: "", value: 1, shade: ramp.missed }]
    : slices;
  const segments = toSegments(drawn, empty ? 1 : tally.decided);

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
      <div
        className="relative mx-auto my-auto"
        style={{ height: BOX, width: BOX }}
      >
        {/* The glow, and it is outside the ring. A transparent circle sitting
            exactly on the rim, throwing a soft shadow outward — box-shadow on
            an unfilled element draws beyond its edge and nothing within it, so
            the hole stays dark and the figure printed there keeps its
            contrast. The blurred disc this replaced sat in that hole and lit
            the percentage from behind. */}
        <div
          aria-hidden
          className="absolute rounded-full"
          style={{
            inset: CENTRE - OUTER,
            boxShadow: `0 0 26px 2px ${glow}59, 0 0 10px 0 ${glow}40`,
          }}
        />

        <svg
          viewBox={`0 0 ${BOX} ${BOX}`}
          className="h-full w-full -rotate-90"
          aria-hidden
        >
          <defs>
            {segments.map((seg) => (
              // One gradient per segment, in user space and centred on the
              // ring, so its stops fall across the band's thickness rather
              // than across the bounding box. Four bands: a shadowed inner
              // lip, the lit face a third of the way out, a highlight just
              // inside the rim, and the rim easing back down.
              <radialGradient
                key={seg.key}
                id={`monk-bevel-${seg.key}`}
                gradientUnits="userSpaceOnUse"
                cx={CENTRE}
                cy={CENTRE}
                r={OUTER}
              >
                {/* Doubled stops: each pair sits at one offset, closing one
                    plane and opening the next in a different colour, so the
                    boundary is a crease and nothing interpolates across it.
                    The inner face turned away from the light, the outer face
                    turned towards it, and a narrow chamfer at the rim. */}
                <stop offset={acrossRing(0)} stopColor={seg.shade.deep} />
                <stop offset={acrossRing(FACET_FOLD)} stopColor={seg.shade.deep} />
                <stop offset={acrossRing(FACET_FOLD)} stopColor={seg.shade.lit} />
                <stop offset={acrossRing(FACET_RIM)} stopColor={seg.shade.lit} />
                <stop offset={acrossRing(FACET_RIM)} stopColor={seg.shade.base} />
                <stop offset={acrossRing(1)} stopColor={seg.shade.base} />
              </radialGradient>
            ))}
          </defs>

          {/* The unlit band the segments are laid into. Without it a ring that
              is mostly one colour has nothing behind the rest of the circle,
              and the arc reads as a stray stroke rather than as a gauge that
              is partly filled. */}
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS}
            fill="none"
            stroke={ramp.missed.deep}
            strokeWidth={THICKNESS}
            opacity={0.35}
          />

          {segments.map((seg) => (
            <circle
              key={seg.key}
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS}
              fill="none"
              stroke={`url(#monk-bevel-${seg.key})`}
              strokeWidth={THICKNESS}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${seg.dash} ${100 - seg.dash}`}
              strokeDashoffset={-seg.offset}
            />
          ))}
        </svg>
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
              style={{ background: slice.shade.base }}
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
