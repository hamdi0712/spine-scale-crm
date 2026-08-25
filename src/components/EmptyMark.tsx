// The glyph over an empty dashboard card.
//
// The three cards along the bottom of the dashboard each spend their first days
// empty, and an empty card that is only a paragraph reads as something that
// failed to load. This is the composition that says the opposite: a large, soft
// disc with the card's own glyph in it and a wide halo behind, centred above
// the copy that was already there.
//
// It says nothing the copy does not. Every one of these cards already explains
// in words what will appear in it and when — this is the picture over that
// sentence, not a replacement for it.
//
// Glyphs come from Tabler at the sidebar's 1.75 stroke, the same family the KPI
// marks and the navigation are drawn in.

import { IconActivity, IconUsers } from "@tabler/icons-react";

const GLYPHS = {
  activity: IconActivity,
  clients: IconUsers,
} as const;

export type EmptyGlyph = keyof typeof GLYPHS;

type MarkTone = "blue" | "teal" | "indigo";

// Two custom properties per tone: the disc's own gradient, and the hue the
// glyph and the halo are drawn from. Both move with the theme (see
// globals.css) — light keeps the exact washes this file used to hard-code,
// dark swaps them for a deep tint of the same hue rather than the pastel,
// which on a near-black card would read as a bright sticker.
const TONES: Record<MarkTone, { disc: string; hue: string }> = {
  blue: { disc: "var(--empty-disc-blue)", hue: "var(--c-accent)" },
  teal: { disc: "var(--empty-disc-teal)", hue: "var(--c-teal)" },
  indigo: { disc: "var(--empty-disc-indigo)", hue: "var(--c-indigo)" },
};

export default function EmptyMark({
  icon,
  tone = "blue",
}: {
  icon: EmptyGlyph;
  tone?: MarkTone;
}) {
  const t = TONES[tone];
  const Glyph = GLYPHS[icon];
  return (
    <div
      className="empty-mark"
      style={
        {
          background: t.disc,
          color: `rgb(${t.hue})`,
          "--empty-halo": `rgb(${t.hue} / var(--empty-halo-a))`,
        } as React.CSSProperties
      }
    >
      <Glyph size={20} stroke={1.75} aria-hidden />
    </div>
  );
}
