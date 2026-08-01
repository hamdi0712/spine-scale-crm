// A show-rate sparkline: five-ish weeks of history at thumbnail size, next to
// the health badge it explains. No axes, no labels — it is there to show the
// shape of the last few weeks, and the badge beside it carries the reading.

const W = 44;
const H = 20;
// Room for the end marker and the stroke's round cap, so neither is clipped
// by the viewBox at either edge.
const PAD = 3.5;

const STROKE: Record<string, string> = {
  green: "#1FAA6D",
  amber: "#D89B2D",
  red: "#E14C57",
  neutral: "#9AA1AE",
};

export default function Sparkline({
  points,
  tone = "neutral",
  label,
}: {
  points: (number | null)[]; // 0–1, oldest → newest; null = nothing booked
  tone?: keyof typeof STROKE;
  label?: string;
}) {
  const values = points.filter((p): p is number => p !== null);
  const stroke = STROKE[tone] ?? STROKE.neutral;

  // One point (or none) is not a line. Draw the baseline instead of inventing
  // a slope out of a single week.
  if (values.length < 2) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label ?? "Not enough history"}>
        <line
          x1={PAD}
          y1={H / 2}
          x2={W - PAD}
          y2={H / 2}
          stroke={STROKE.neutral}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="2 3"
          opacity="0.6"
        />
      </svg>
    );
  }

  // Scaled to the run's own range so a small movement is still visible, with a
  // floor on the range so a near-flat line does not blow up into a zigzag.
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.15);
  const mid = (max + min) / 2;
  const lo = mid - span / 2;

  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (values.length - 1);
  const y = (v: number) =>
    H - PAD - ((v - lo) / span) * (H - PAD * 2);

  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fill="none"
      role="img"
      aria-label={label ?? "Show rate over recent weeks"}
    >
      <path d={d} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last)} cy={y(values[last])} r="2.5" fill={stroke} />
    </svg>
  );
}
