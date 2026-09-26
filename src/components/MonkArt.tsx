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
    // Full strength, small, and sitting in the bottom-right corner — a painted
    // object on the card rather than a wash behind it. It was a masked,
    // 20%-opacity layer across the whole foot of the card, which made every
    // illustration read as a smudge and, worse, put the habit's status on top
    // of it. The text has moved up under the title (see MonkHabitGrid) and the
    // picture has moved into the space that left, so the two no longer share a
    // pixel and neither has to be faded out of the other's way.
    //
    // object-contain, because these are landscape paintings going into a
    // roughly square corner: cover would crop the subject out of most of them.
    <div
      aria-hidden
      className="pointer-events-none absolute -bottom-1.5 -right-1.5 h-[68px] w-[84px] max-md:h-[54px] max-md:w-[66px]"
    >
      <Image
        src={`/habit-bottom-${slug}.png`}
        alt=""
        fill
        sizes="120px"
        className="object-contain object-bottom-right"
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
    // Raised off the foot of the card to sit directly on the rule above the
    // two figures, rather than behind them. That is the whole change: held
    // under "best streak" it had to be faded to a haze to keep the numbers
    // readable, and a haze is not a treeline. Standing in the empty band
    // between the day dots and the rule it is over nothing, so it can be drawn
    // at something like full strength and actually be a picture.
    //
    // object-bottom so the trees stand on the cut rather than floating above
    // it, and the mask only fades the top, where the sky meets the card.
    <div
      aria-hidden
      // Anchored to the bottom of its own container rather than to a guessed
      // offset from the card. The container is the slack between the day dots
      // and the two figures (see MonkStreakPanel), so bottom-0 here *is* the
      // rule above them — no arithmetic, and nothing to re-derive when a row
      // is added. The negative insets bleed it back out through the card's
      // padding so the ridgeline runs the full width.
      className="pointer-events-none absolute -left-5 -right-5 bottom-0 h-[116px] opacity-90"
      style={{
        // Only the top quarter fades. The first pass dissolved nearly half the
        // image and left a pale band rather than a ridgeline — there is
        // nothing underneath it to protect, so it can be nearly all there.
        maskImage: "linear-gradient(to top, black 0%, black 74%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to top, black 0%, black 74%, transparent 100%)",
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
