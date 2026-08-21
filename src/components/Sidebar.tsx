"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconBook,
  IconBulb,
  IconCalendarEvent,
  IconChartBar,
  IconChecklist,
  IconGitBranch,
  IconLayoutDashboard,
  IconRadar2,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { logout } from "@/lib/actions/auth";
import AiButton from "@/components/AiButton";
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
  // With the dashboard and the calendar rather than with the funnel: a task is
  // work you owe today, not a stage a clinic is at, and the board is read from
  // the same standing start those two are.
  { href: "/activities", label: "Activities", Glyph: IconChecklist },
  // Immediately before Pipeline, because that is where it sits in the funnel:
  // everything scraped lands in Discovery and only what scores gets through.
  { href: "/discovery", label: "Discovery", Glyph: IconRadar2 },
  { href: "/pipeline", label: "Pipeline", Glyph: IconGitBranch },
  { href: "/clients", label: "Clients", Glyph: IconUsers },
  { href: "/reporting", label: "Reporting", Glyph: IconChartBar },
  { href: "/ad-hub", label: "Ad Hub", Glyph: IconBulb },
  { href: "/library", label: "Library", Glyph: IconBook },
];

// Settings is not in NAV. It is the one thing in the sidebar that is not a
// place in the funnel — it changes how the app runs rather than showing what is
// in it — and it is drawn below the divider at the foot rather than in the list.
// Everything under /settings lights it, including the pipeline settings that
// used to be a nav item of their own.
const SETTINGS = {
  href: "/settings",
  label: "Settings",
  Glyph: IconSettings,
} as const;

// Which nav item the current path belongs to: the longest href that is a
// prefix of it, and exactly one of them.
//
// A plain startsWith would light two items at once if one nav item ever sat
// inside another's path. Longest match settles it, and settles it the same way
// for any nested item added later. Dashboard is the exception it always was:
// "/" is a prefix of everything, so it only matches itself.
function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of NAV) {
    if (item.href === "/") {
      if (pathname === "/") return "/";
      continue;
    }
    const matches =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === null || item.href.length > best.length)) {
      best = item.href;
    }
  }
  return best;
}

// Long enough to read as a fade, short enough to stay out of the way. Colour,
// border and the active card's shadow all ease together; nothing moves.
const NAV_MOTION =
  "transition-[color,background-color,border-color,box-shadow] duration-150 ease-out";

export default function Sidebar({
  collapsed,
  onToggle,
  onOpenCopilot,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onOpenCopilot: () => void;
}) {
  const pathname = usePathname();
  const settingsActive =
    pathname === SETTINGS.href || pathname.startsWith(`${SETTINGS.href}/`);
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
          const active = item.href === activeHref(pathname);
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
      {/* The copilot's trigger. It wears .btn-ai through <AiButton> for the
          reason every other assist does: a violet pill with a sparkle on it
          spends a model call, and this is the only control in the nav that
          does. It is a button rather than a nav item because it opens a panel
          over whatever page you are on instead of taking you somewhere —
          which is also why it sits below the nav rather than in it. */}
      <div className={`py-3 ${collapsed ? "px-2" : "px-3"}`}>
        <AiButton
          onClick={onOpenCopilot}
          title={collapsed ? "AI Copilot" : undefined}
          aria-label={collapsed ? "AI Copilot" : undefined}
          className={`w-full ${collapsed ? "justify-center !px-0" : ""}`}
        >
          {!collapsed && "AI Copilot"}
        </AiButton>
      </div>
      {/* Settings, alone at the foot behind a rule. It is a real nav item —
          same 42px row, same active treatment — held apart from the group above
          because it is not a stage of the work, and kept directly over Sign out
          because the two together are the account-and-app block at the bottom
          of the sidebar rather than part of the funnel. */}
      <div
        className={`border-t border-line/60 pb-1 pt-3 ${collapsed ? "px-2" : "px-3"}`}
      >
        <Link
          href={SETTINGS.href}
          title={collapsed ? SETTINGS.label : undefined}
          className={`flex h-[42px] items-center gap-2 rounded-[10px] text-sm font-normal ${NAV_MOTION} ${
            collapsed ? "justify-center px-0" : "px-3"
          } ${
            settingsActive
              ? "nav-active"
              : "text-muted hover:bg-wash hover:text-ink"
          }`}
        >
          <SETTINGS.Glyph size={20} stroke={1.75} className="shrink-0" />
          {!collapsed && SETTINGS.label}
        </Link>
      </div>
      <form
        action={logout}
        className={`pb-3 ${collapsed ? "px-2" : "px-3"}`}
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
