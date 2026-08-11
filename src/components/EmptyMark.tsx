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

const TONES: Record<MarkTone, { disc: string; glyph: string; halo: string }> = {
  blue: {
    disc: "linear-gradient(135deg, #EAF1FE, #D6E5FD)",
    glyph: "#126DFB",
    halo: "rgba(18, 109, 251, 0.07)",
  },
  teal: {
    disc: "linear-gradient(135deg, #E3F7F5, #CBEFEA)",
    glyph: "#0E9F94",
    halo: "rgba(14, 159, 148, 0.07)",
  },
  indigo: {
    disc: "linear-gradient(135deg, #EDEEFD, #DEE0FB)",
    glyph: "#5A5FE0",
    halo: "rgba(90, 95, 224, 0.07)",
  },
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
          color: t.glyph,
          "--empty-halo": t.halo,
        } as React.CSSProperties
      }
    >
      <Glyph size={20} stroke={1.75} aria-hidden />
    </div>
  );
}
