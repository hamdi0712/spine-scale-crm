// A goal, drawn as a ring.
//
// One SVG rather than a chart: a single-value ring is two circles and an arc
// length, and reaching for Recharts to draw it would pull a client bundle onto
// a page whose numbers are all computed on the server. The trend chart on the
// same page is the thing that genuinely needs one.
//
// The track is the app's own line colour and the arc is whatever hue the thing
// being measured wears, so a row of four rings is the same object in the KPI
// row's four colours — the same trick the tinted discs on the dashboard's
// cards play.

export default function ProgressRing({
  pct,
  hue,
  size = 56,
  stroke = 6,
  label,
  children,
}: {
  pct: number;
  hue: string;
  size?: number;
  stroke?: number;
  // What the ring means, for a reader who is not looking at it. The digits
  // inside are decoration to a screen reader; this is the reading.
  label: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      {/* Rotated so the arc starts at twelve o'clock and runs clockwise, which
          is the direction every ring in this app fills — the pipeline donut
          starts at the same place. */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E7E9EE"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={hue}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped / 100)}
          />
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
