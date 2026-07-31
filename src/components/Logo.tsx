// Spine Scale brand assets, recreated as vectors from the logo files.
// The turret-shell mark and the two-tone wordmark each sit on a small
// rounded chip carrying the blue gradient from the logo background.

const CHIP_GRADIENT = "bg-gradient-to-b from-[#1893F8] to-[#0765C4]";

// The shell: three light segments spiraling up into the teal mouth triangle.
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 72 72" className={className} aria-hidden>
      <g transform="translate(14 58) rotate(-40)">
        <polygon
          points="51,-18 51,22 73,4"
          fill="#2FB4AE"
          stroke="#2FB4AE"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <polygon
          points="49,-20 49,20 71,2"
          fill="#52D5CB"
          stroke="#52D5CB"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {[
          "1,-4 1,4 9,7.5 9,-7.5",
          "15,-9 15,9 25,13.5 25,-13.5",
          "31,-15 31,15 43,19.5 43,-19.5",
        ].map((pts) => (
          <polygon
            key={pts}
            points={pts}
            fill="#E9F1FB"
            stroke="#E9F1FB"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}

// Icon mark on its gradient chip — used in the collapsed sidebar.
export function LogoIconChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${CHIP_GRADIENT} ${className}`}
    >
      <LogoMark className="h-6 w-6" />
    </span>
  );
}

// Full wordmark on its gradient chip — used in the expanded sidebar header.
export function LogoWordmarkChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${CHIP_GRADIENT} ${className}`}
    >
      <LogoMark className="h-7 w-7 shrink-0" />
      <span className="text-[15px] font-extrabold leading-[1.05] tracking-tight">
        <span className="block text-[#E9F1FB]">Spine</span>
        <span className="block text-[#4FD8D4]">Scale</span>
      </span>
    </span>
  );
}
