// Spine Scale brand assets. Both source files are square tiles with the blue
// logo gradient baked in, so each chip is just the image clipped to the rounded
// shape — the gradient class stays as the backdrop behind it while it loads.

import Image from "next/image";

const CHIP_GRADIENT = "bg-gradient-to-b from-[#1893F8] to-[#0765C4]";

// Icon mark on its gradient chip — used in the sidebar header, collapsed and
// expanded alike (expanded pairs it with a plain "Spine Scale" title).
// The mark fills ~67% of its square file, which matches the 24px mark the
// vector version drew inside this same 36px chip.
export function LogoIconChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-9 w-9 overflow-hidden rounded-lg ${CHIP_GRADIENT} ${className}`}
    >
      <Image
        src="/logo-icon.png"
        alt="Spine Scale"
        width={500}
        height={500}
        className="h-full w-full object-cover"
        priority
      />
    </span>
  );
}

// Full wordmark on its gradient chip — used on the login card.
// The wordmark file is square but its ink is 1.54:1, so the
// chip is sized to that ratio and object-cover trims the surrounding gradient
// padding. Keeps the chip 44px tall, as the vector lockup was.
export function LogoWordmarkChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-11 w-[68px] overflow-hidden rounded-lg ${CHIP_GRADIENT} ${className}`}
    >
      <Image
        src="/logo-wordmark.png"
        alt="Spine Scale"
        width={500}
        height={500}
        className="h-full w-full object-cover"
        priority
      />
    </span>
  );
}
