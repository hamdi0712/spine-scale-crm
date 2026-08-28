// Iman's face — the copilot's one piece of branding.
//
// The same file at three sizes: the hero on the empty page, the small mark
// beside every answer, and the glyph on the sidebar's nav row. Kept in one
// component so the ring, the clip and the source can never drift between them.
//
// The source is a square PNG with its own background, so it is clipped to a
// circle and covered rather than padded. The ring is the AI violet at low
// alpha, which is the same edge the copilot's other furniture wears.

import Image from "next/image";

const SIZES = {
  // Sidebar nav row, matching the 20px Tabler glyphs beside it.
  nav: "h-5 w-5",
  // Beside an answer, and in the page's top bar.
  sm: "h-7 w-7",
  // The landing state's hero.
  hero: "h-[72px] w-[72px]",
} as const;

export default function ImanAvatar({
  size = "sm",
  className = "",
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-ai/25 ${SIZES[size]} ${className}`}
    >
      <Image
        src="/iman-avatar.png"
        alt="Iman"
        width={512}
        height={512}
        className="h-full w-full object-cover"
        priority={size === "hero"}
      />
    </span>
  );
}
