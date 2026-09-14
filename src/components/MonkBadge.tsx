// One pill, wherever Monk Mode states a status.
//
// The crown on the banner, the streak tier, the trophy on the month's line —
// all the same object, so a pill always means "a status, stated" rather than
// being a shape the reader has to recognise again in every card. The shape is
// .monk-pill in globals.css; the tones are here.
//
// The gold is the app's own --c-warn, the amber every warning pill in the CRM
// already wears. It is not a new colour introduced for a crown: a feature that
// starts its own palette is a feature that stops matching the app six months
// later.
//
// `glow` adds the soft halo — worth it on something earned, wrong on something
// that is simply true, so it is opt-in rather than the default.

import { MonkBadgeTone } from "@/lib/monkMode";

interface BadgeTone {
  className: string;
  // The token triple the halo is mixed from, when one is asked for.
  glow: string;
}

const MONK_BADGE_TONES: Record<MonkBadgeTone, BadgeTone> = {
  gold: {
    className: "border-warn/35 bg-warn/12 text-warn-on-soft",
    glow: "var(--c-warn)",
  },
  green: {
    className: "border-ok/35 bg-ok/12 text-ok-on-soft",
    glow: "var(--c-ok)",
  },
  blue: {
    className: "border-accent/30 bg-accent/10 text-accent",
    glow: "var(--c-accent)",
  },
  muted: {
    className: "border-line bg-wash text-muted",
    glow: "var(--c-muted)",
  },
};

export default function MonkBadge({
  label,
  tone = "muted",
  icon,
  glow = false,
  className = "",
}: {
  label: string;
  tone?: MonkBadgeTone;
  // A 12px glyph, or nothing. Passed in rather than named, so this component
  // stays about the pill and does not grow an icon registry of its own.
  icon?: React.ReactNode;
  glow?: boolean;
  className?: string;
}) {
  const t = MONK_BADGE_TONES[tone];
  return (
    <span
      className={`monk-pill ${t.className} ${glow ? "monk-glow" : ""} ${className}`}
      style={glow ? ({ "--monk-glow": t.glow } as React.CSSProperties) : undefined}
    >
      {icon}
      {label}
    </span>
  );
}

// The same halo, for an icon that is not in a pill — the trophy beside a
// figure, the crown on the banner's mark. A wrapper rather than a class at the
// call site, because the glow needs its colour passed as a variable and that
// is two things to remember rather than one.
export function MonkGlowMark({
  tone = "gold",
  children,
  className = "",
}: {
  tone?: MonkBadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  const t = MONK_BADGE_TONES[tone];
  return (
    <span
      className={`monk-glow inline-flex items-center justify-center rounded-full ${t.className} ${className}`}
      style={{ "--monk-glow": t.glow } as React.CSSProperties}
    >
      {children}
    </span>
  );
}
