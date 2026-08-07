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
  adhub: (
    <>
      <path d="M4.5 10.5A1.5 1.5 0 016 9h3l9-4.5v15L9 15H6a1.5 1.5 0 01-1.5-1.5z" />
      <path d="M8.6 15.2l1.1 4.3h2.6l-1.2-4.3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5l7 2.5v5.6c0 3.9-2.8 7-7 8.9-4.2-1.9-7-5-7-8.9V6z" />
      <path d="M9 12l2 2 4-4" />
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
  chevronRight: <path d="M9.5 6.5L15 12l-5.5 5.5" />,
  chevronDown: <path d="M6.5 9.5L12 15l5.5-5.5" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  doc: (
    <>
      <path d="M6 3.5h7l5 5v12a1 1 0 01-1 1H6a1 1 0 01-1-1v-16a1 1 0 011-1z" />
      <path d="M13 3.5v5h5M8.5 13h7M8.5 16.5h4.5" />
    </>
  ),
  signed: (
    <>
      <path d="M6 3.5h7l5 5v12a1 1 0 01-1 1H6a1 1 0 01-1-1v-16a1 1 0 011-1z" />
      <path d="M13 3.5v5h5M8.5 14.5l2.5 2.5 4.5-5" />
    </>
  ),
  pulse: <path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" />,
  phone: (
    <path d="M6.2 4h3l1.5 3.8-2 1.4a11 11 0 005.1 5.1l1.4-2 3.8 1.5v3a1.5 1.5 0 01-1.7 1.5C10.6 17.4 6.6 13.4 4.7 5.7A1.5 1.5 0 016.2 4z" />
  ),
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0111 0c0 3.2.8 5 1.5 6h-14c.7-1 1.5-2.8 1.5-6z" />
      <path d="M10 19.5a2.2 2.2 0 004 0" />
    </>
  ),
  checklist: (
    <>
      <path d="M4 6.5l1.8 1.8L9 5M4 16.5l1.8 1.8L9 15" />
      <path d="M12 7h8M12 17h8" />
    </>
  ),
  flag: <path d="M6 20V4.5h12l-2.5 4 2.5 4H6" />,
  // The tier marks, hottest to coldest, for the score badge on a discovery
  // card: A burns, B is warm, C is cold, and a disqualified clinic is struck
  // out rather than given a temperature it never earned.
  flame: (
    <path d="M12 3.5c3 2.9 5.5 5.4 5.5 9a5.5 5.5 0 01-11 0c0-1.7.6-3 1.7-4.2.3 1.1 1 1.9 2 2.4C10.1 8.5 10.7 5.9 12 3.5z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3.5v2M12 18.5v2M5.5 12h-2M20.5 12h-2M7.4 7.4L6 6M18 18l-1.4-1.4M7.4 16.6L6 18M18 6l-1.4 1.4" />
    </>
  ),
  snowflake: (
    <>
      <path d="M12 3.5v17M4.6 7.75l14.8 8.5M19.4 7.75L4.6 16.25" />
      <path d="M9.6 5.4L12 3.5l2.4 1.9M9.6 18.6L12 20.5l2.4-1.9" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.3 6.3l11.4 11.4" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 20.5s6-5.3 6-9.5a6 6 0 10-12 0c0 4.2 6 9.5 6 9.5z" />
      <circle cx="12" cy="11" r="2.25" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4.6 7.6L12 13l7.4-5.4" />
    </>
  ),
  building: (
    <>
      <path d="M4.5 20.5V5.5a1 1 0 011-1h8a1 1 0 011 1v15" />
      <path d="M14.5 10.5h4a1 1 0 011 1v9M3 20.5h18" />
      <path d="M8 8.5h3M8 12h3M8 15.5h3" />
    </>
  ),
  tag: (
    <>
      <path d="M4.5 11.2V5.5a1 1 0 011-1h5.7a1 1 0 01.71.3l7.29 7.29a1 1 0 010 1.42l-5.7 5.7a1 1 0 01-1.42 0L4.8 11.91a1 1 0 01-.3-.71z" />
      <circle cx="8.6" cy="8.6" r="1.2" />
    </>
  ),
  arrowUp: <path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" />,
  arrowDown: <path d="M12 5v13M6.5 12.5L12 18l5.5-5.5" />,
  arrowRight: <path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5" />,
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
