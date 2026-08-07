"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconBook,
  IconBulb,
  IconCalendarEvent,
  IconChartBar,
  IconGitBranch,
  IconLayoutDashboard,
  IconRadar2,
  IconUsers,
} from "@tabler/icons-react";
import { logout } from "@/lib/actions/auth";
import Icon from "@/components/Icons";
import { LogoIconChip } from "@/components/Logo";

// Nav glyphs come from Tabler; the rest of the app (including the collapse
// chevron and Sign out below) stays on the in-house set. Stroke is dialled
// from Tabler's default 2 down to 1.75 so the two sets sit together.
const NAV = [
  { href: "/", label: "Dashboard", Glyph: IconLayoutDashboard },
  // Sits with the dashboard: both read across every record rather than owning
  // one, and the pair is where a day starts.
  { href: "/calendar", label: "Calendar", Glyph: IconCalendarEvent },
  // Immediately before Pipeline, because that is where it sits in the funnel:
  // everything scraped lands in Discovery and only what scores gets through.
  { href: "/discovery", label: "Discovery", Glyph: IconRadar2 },
  { href: "/pipeline", label: "Pipeline", Glyph: IconGitBranch },
  { href: "/clients", label: "Clients", Glyph: IconUsers },
  { href: "/reporting", label: "Reporting", Glyph: IconChartBar },
  { href: "/ad-hub", label: "Ad Hub", Glyph: IconBulb },
  { href: "/library", label: "Library", Glyph: IconBook },
];

// Long enough to read as a fade, short enough to stay out of the way. Colour,
// border and the active card's shadow all ease together; nothing moves.
const NAV_MOTION =
  "transition-[color,background-color,border-color,box-shadow] duration-150 ease-out";

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  return (
    <aside
      className={`fixed inset-y-0 left-0 flex flex-col border-r border-line/70 bg-panel ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div
        className={`flex items-center px-4 pb-4 pt-5 ${
          collapsed ? "flex-col gap-3 px-0" : "justify-between"
        }`}
      >
        {collapsed ? (
          <LogoIconChip />
        ) : (
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <LogoIconChip />
            <span className="display truncate text-base font-semibold text-ink">
              Spine Scale
            </span>
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-[10px] p-2 text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          <Icon
            name="chevronLeft"
            className={`h-4 w-4 ${collapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {!collapsed && (
        <div className="px-6 pb-2 pt-2 text-xs font-medium tracking-[0.02em] text-muted">
          Internal ops
        </div>
      )}
      <nav className={`flex-1 space-y-1 py-1 ${collapsed ? "px-2" : "px-3"}`}>
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex h-[42px] items-center gap-2 rounded-[10px] text-sm font-normal ${NAV_MOTION} ${
                collapsed ? "justify-center px-0" : "px-3"
              } ${
                active
                  ? "nav-active"
                  : "text-muted hover:bg-wash hover:text-ink"
              }`}
            >
              <item.Glyph size={20} stroke={1.75} className="shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>
      <form
        action={logout}
        className={`border-t border-line/60 py-3 ${collapsed ? "px-2" : "px-3"}`}
      >
        <button
          type="submit"
          title={collapsed ? "Sign out" : undefined}
          className={`flex h-[42px] w-full items-center gap-2 rounded-[10px] text-left text-sm font-normal text-muted hover:bg-wash hover:text-ink ${NAV_MOTION} ${
            collapsed ? "justify-center px-0" : "px-3"
          }`}
        >
          <Icon name="logout" />
          {!collapsed && "Sign out"}
        </button>
      </form>
    </aside>
  );
}
