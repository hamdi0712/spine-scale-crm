// The dashboard's one colour system, in one place.
//
// It is the pipeline donut's ramp, and the KPI row reads from the same array so
// the four cards at the top of the page and the chart at the bottom are visibly
// one system at two sizes. It lives here rather than in the chart because a
// server component and a client component both need it, and a shared constant
// should not drag recharts into the server graph to get at it.
//
// Pure data. Nothing here imports anything.

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
export const STAGE_RAMP = ["#0C46A2", "#0959D2", "#126DFB", "#00A2B0", "#38BCB4"];

// Each segment is filled with a gradient rather than a flat colour: the ramp's
// own step, lightened at the top of the arc and landing on the step itself at
// the bottom. The step stays the darker stop on purpose — the contrast floor
// documented above is measured against it, so lightening the top adds depth
// without moving the number the ramp was checked at.
export const RAMP_LIGHT = ["#1A63C8", "#2D7BEA", "#4C93FF", "#22BFCB", "#63D3CB"];

// An empty pipeline. It used to be one flat grey ring, which was honest and
// looked broken. This is the same shape in a soft blue → indigo → teal ramp:
// desaturated well below the live ramp above, so a populated donut and an empty
// one are never mistaken for each other, and paired — as it always was — with
// zeroes in the legend and a zero in the middle. The colour is the card being
// composed rather than the pipeline being described.
export const EMPTY_RAMP = ["#9CC4F2", "#A8B8EE", "#B2ADE9", "#9FCBDD", "#8FD6CC"];
export const EMPTY_LIGHT = ["#C8DDF8", "#CFD8F5", "#D5D2F2", "#CBE2EC", "#C2EAE3"];

// ─── Dark ──────────────────────────────────────────────────────────────────
// The same two ramps, rebuilt for a dark card.
//
// The light ramp is spaced by lightness starting from a deep #0C46A2, which is
// what gives it its order — and on a #161B24 card that first step is very
// nearly the card itself, so the sequence loses its darkest two segments to
// the background. The dark ramp keeps the identical construction (deep primary
// blue → primary → secondary teal, each step ≥0.06 OKLCH L from its
// neighbour) and slides the whole run upward, so the order still reads and
// every segment clears the card it is drawn on.
//
// The empty ramp moves the other way. Its light values are pale pastels chosen
// to sit *below* the live ramp in saturation; on a dark card pale pastels are
// the loudest thing on the page, so the dark empty ramp is a set of muted
// mid-tones instead — still desaturated relative to the live ramp, which is
// the property that matters, just approached from the other side.
export const STAGE_RAMP_DARK = ["#3B82F6", "#4C93FF", "#60A5FA", "#2DD4BF", "#5EEAD4"];
export const RAMP_LIGHT_DARK = ["#5B9CFF", "#6BA9FF", "#7DB8FF", "#4EE0CE", "#7FF0E0"];
export const EMPTY_RAMP_DARK = ["#3E5473", "#455172", "#4B4E70", "#3F5A6B", "#3C6068"];
export const EMPTY_LIGHT_DARK = ["#4D688C", "#55648B", "#5B6189", "#4E6E82", "#4A7580"];
