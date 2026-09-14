// The glass strip at the foot of a panel: a mark, and a line about what the
// panel just showed.
//
// Two places use it — the encouraging line under Overall Progress and the
// month's count under the calendar — and they are one object rather than two
// because they are the same idea: the panel's number, restated as a sentence
// somebody can act on. Drawn as a soft inset panel rather than plain text so
// it reads as a footer belonging to the card, not as a stray caption.
//
// It is deliberately quiet. The chart above it is the subject; this is the
// remark underneath.

import {
  IconFlameFilled,
  IconSeeding,
  IconShieldCheckFilled,
  IconSparkles,
  IconStarFilled,
  IconTrophyFilled,
} from "@tabler/icons-react";
import { MonkBadgeTone, MonkNoteIcon } from "@/lib/monkMode";

// The marks a progress line can carry, keyed by the band that chose it (see
// monkProgressNote). A seedling for a bad patch and a trophy for a finished
// one say more than the same star would twice.
const NOTE_ICONS: Record<MonkNoteIcon, typeof IconSparkles> = {
  sparkles: IconSparkles,
  seeding: IconSeeding,
  star: IconStarFilled,
  flame: IconFlameFilled,
  shield: IconShieldCheckFilled,
  trophy: IconTrophyFilled,
};

const TONES: Record<MonkBadgeTone, { token: string; text: string }> = {
  gold: { token: "var(--c-warn)", text: "text-warn-on-soft" },
  green: { token: "var(--c-ok)", text: "text-ok-on-soft" },
  blue: { token: "var(--c-accent)", text: "text-accent" },
  muted: { token: "var(--c-muted)", text: "text-muted" },
};

export default function MonkStatBadge({
  icon,
  tone = "blue",
  children,
}: {
  icon: MonkNoteIcon;
  tone?: MonkBadgeTone;
  children: React.ReactNode;
}) {
  const Glyph = NOTE_ICONS[icon];
  const t = TONES[tone];
  return (
    <div
      className="flex items-center gap-2.5 rounded-[12px] border px-2.5 py-2"
      style={{
        // Composed from the tone's own variable rather than a fixed fill, so
        // the strip follows light and dark the way every other surface here
        // does, and a tone change is one word rather than four values.
        background: `rgb(${t.token} / 0.08)`,
        borderColor: `rgb(${t.token} / 0.2)`,
      }}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ${t.text}`}
        style={{
          background: `rgb(${t.token} / 0.16)`,
          boxShadow: `0 0 12px -2px rgb(${t.token} / 0.45)`,
        }}
      >
        <Glyph size={14} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-pretty text-[11px] leading-snug text-ink-soft">
        {children}
      </span>
    </div>
  );
}
