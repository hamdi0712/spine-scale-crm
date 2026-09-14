// Monk Mode's painted artwork, and the rules for holding it back.
//
// Every picture in the feature is drawn through next/image, without exception
// and for one reason: the source files are 1500-pixel PNGs of up to 1.8MB, and
// the habits panel alone puts seven of them on screen at once. Referenced raw
// that is thirteen megabytes before the page has said anything; through the
// optimizer each one is resized to the handful of pixels it is actually drawn
// at and re-encoded, and the same panel costs a few tens of kilobytes. The
// middleware carries a bypass for these paths so the optimizer can fetch them
// — see the note on the matcher in src/middleware.ts.
//
// The other rule is that none of it is allowed to win. These are illustrations
// behind a tool somebody is trying to read a number off: everything here is
// aria-hidden, pointer-events-none, held at low opacity, and masked so it
// fades out before it reaches the text. A card whose habit name is competing
// with a mountain is a worse card than one with no mountain in it.

import Image from "next/image";

// Transparent at the top, solid through the middle, and mostly gone again at
// the foot. Shared by the card illustrations and the treeline, because both
// have a line of text sitting along the bottom edge they must not compete
// with, and the two should fade identically.
const MASK_BOTH_ENDS =
  "linear-gradient(to top, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.12) 18%, black 40%, black 66%, transparent 100%)";

// The picture behind the banner.
//
// A layer rather than a CSS background, which buys two things. The optimizer
// gets to resize a 1.5MB PNG, and the dawn gradient that was standing in for
// this image stays underneath as the ground — so a missing or slow file leaves
// a banner that still looks deliberate rather than a black rectangle.
//
// The scrim over the top is what makes the white lettering legible on a
// photograph that is bright at the horizon. It is part of this component
// rather than the stylesheet so the three layers — picture, scrim, content —
// are readable in one place, the same way the business-hours widget stacks its
// map.
export function MonkHeroArt() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <Image
        src="/monk-hero-bg.png"
        alt=""
        fill
        // The banner is the widest thing on the page and the first picture
        // painted, so it is the one asset worth fetching eagerly.
        priority
        sizes="(max-width: 1100px) 100vw, 1150px"
        className="object-cover object-center"
      />
      {/* Dark on the left where the title, the counter and the day ticks sit,
          opening up across the middle so the picture is actually seen, and
          closing again under the quotation on the right. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(100deg, rgba(6,12,28,0.92) 0%, rgba(6,12,28,0.72) 38%, rgba(6,12,28,0.3) 68%, rgba(6,12,28,0.62) 100%)",
        }}
      />
    </div>
  );
}

// The illustration along the foot of a habit card.
//
// Anchored to the bottom and masked to nothing before it reaches the habit's
// name — a linear mask rather than a flat opacity, so there is no edge where
// the picture stops. Held lower in light mode than in dark: on a white card a
// painting at the same strength reads as a stain, and on a dark one the same
// value disappears.
export function MonkHabitBottomArt({ slug }: { slug: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[64%] opacity-[0.2] dark:opacity-[0.28]"
      style={{
        // Faded at both ends, not just the top. The habit's status — "Done", or
        // the row of dots and the count — sits along the very bottom of the
        // card, which is exactly where a bottom-anchored painting is densest;
        // the first pass put a mosque behind five check dots and you could not
        // read either. So the mask opens below the name, holds through the
        // middle where the picture is actually seen, and closes again before
        // the status line.
        maskImage: MASK_BOTH_ENDS,
        WebkitMaskImage: MASK_BOTH_ENDS,
      }}
    >
      <Image
        src={`/habit-bottom-${slug}.png`}
        alt=""
        fill
        sizes="200px"
        className="object-cover object-bottom"
      />
    </div>
  );
}

// The habit's own painted icon, in the badge slot the Tabler glyph used to
// occupy.
//
// Square and clipped to the same 12px radius, so the row of cards keeps one
// shape whether a habit has a painting or is falling back to a glyph. The
// tinted accent square goes when there is a painting: the artwork brings its
// own ground, and a painted icon inside a coloured tile reads as a sticker on
// a swatch.
export function MonkHabitIconArt({
  slug,
  size = 40,
}: {
  slug: string;
  size?: number;
}) {
  return (
    <Image
      src={`/habit-icon-${slug}.png`}
      alt=""
      width={size * 2}
      height={size * 2}
      sizes={`${size}px`}
      aria-hidden
      className="h-full w-full rounded-[12px] object-cover"
    />
  );
}

// The treeline along the foot of the streak card.
//
// Like every layer in this file it is absolutely positioned, which means its
// container must be positioned too. That is not a detail: .card sets
// overflow-hidden but not position, so dropped into a plain .card this strip
// takes its bounds from the page instead and draws a band straight across the
// viewport, over the sidebar and everything else. Whatever renders it owns
// putting `relative` on the card.
//
// The streak's two figures sit in this band, so the strip is held further back
// than the habit illustrations are and masked harder — it is the ground the
// panel stands on, and "best streak: 5 days" has to win over it every time.
export function MonkForestStrip() {
  return (
    <div
      aria-hidden
      // Lower than the habit illustrations. Those fade out under a one-word
      // status; this one sits under two figures somebody is reading, and at
      // matching strength it put a visible haze behind "10 of 13".
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[92px] opacity-[0.13] dark:opacity-[0.22]"
      style={{
        maskImage: MASK_BOTH_ENDS,
        WebkitMaskImage: MASK_BOTH_ENDS,
      }}
    >
      <Image
        src="/monk-forest-strip.png"
        alt=""
        fill
        sizes="340px"
        className="object-cover object-bottom"
      />
    </div>
  );
}

// The watermark in the corner of a completed habit card.
//
// Only on the completed ones, which is what stops it being wallpaper. The
// habit illustration is already fading out of the bottom of every card; adding
// a second picture to all seven would be two paintings competing in a hundred
// and fifty pixels. On a card that is finished it is a small mark that the day
// went well there — texture, at an opacity low enough that you notice it
// without being able to say what it is.
export function MonkCornerMountain() {
  return (
    <div
      aria-hidden
      // Sat over the illustration's own corner and vanished at first. It is
      // lifted clear of the status line and drawn a little stronger, so it
      // reads as a mark in the corner rather than as nothing at all.
      className="pointer-events-none absolute bottom-[26px] right-0 h-[46px] w-[46px] opacity-[0.22] dark:opacity-[0.3]"
    >
      <Image
        src="/monk-corner-mountain.png"
        alt=""
        fill
        sizes="52px"
        className="object-contain object-bottom"
      />
    </div>
  );
}
