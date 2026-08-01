// The Ad Hub's own section header: title, tab strip, and a slot for the
// page's primary action. Same segmented control the pipeline uses for its
// board/table toggle.

import Link from "next/link";

const TABS = [
  { href: "/ad-hub", label: "Browse", key: "browse" },
  { href: "/ad-hub/desires", label: "Desires & benefits", key: "desires" },
  { href: "/ad-hub/research", label: "Research notes", key: "research" },
] as const;

export type AdHubTab = (typeof TABS)[number]["key"];

export default function AdHubNav({
  current,
  blurb,
  action,
}: {
  current: AdHubTab;
  blurb: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[32px] font-bold tracking-[-0.02em]">Ad Hub</h1>
        <p className="mt-1.5 text-sm text-muted">{blurb}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-[42px] items-center gap-1 rounded-[10px] border border-line bg-surface p-1">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`flex h-[32px] items-center rounded-lg px-3.5 text-sm ${
                tab.key === current
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        {action}
      </div>
    </div>
  );
}
