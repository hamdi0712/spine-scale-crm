// Single outline icon set: 18px, 1.75px stroke, aligned to a 24px grid.

const PATHS: Record<string, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  pipeline: <path d="M4 6h16M7 12h10M10 18h4" />,
  clients: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" />
    </>
  ),
  reporting: <path d="M5 20v-8M12 20V5M19 20v-6" />,
  library: (
    <>
      <path d="M12 6.4C10.8 5.2 9 4.5 6.5 4.5H4v13h3c2 0 3.8.7 5 2 1.2-1.3 3-2 5-2h3v-13h-2.5c-2.5 0-4.3.7-5.5 1.9z" />
      <path d="M12 6.4v13" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5h4.5a1 1 0 011 1v13a1 1 0 01-1 1H14" />
      <path d="M4.5 12H15M11.5 8.5L15 12l-3.5 3.5" />
    </>
  ),
  chevronLeft: <path d="M14.5 6.5L9 12l5.5 5.5" />,
  dollar: (
    <path d="M12 4.5v15M16 8c-.8-1-2.2-1.6-4-1.6-2.2 0-3.8 1-3.8 2.7 0 3.5 7.8 1.9 7.8 5.5 0 1.7-1.7 2.9-4 2.9-2 0-3.6-.7-4.4-1.8" />
  ),
  trend: <path d="M4 16.5l5-5 3.5 3.5 7.5-8M14.5 7H20v5.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
};

export default function Icon({
  name,
  className = "h-[18px] w-[18px]",
}: {
  name: keyof typeof PATHS | string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
