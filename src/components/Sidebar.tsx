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
  IconSend,
  IconSettings,
  IconTargetArrow,
  IconUsers,
} from "@tabler/icons-react";
import { logout } from "@/lib/actions/auth";
import AiButton from "@/components/AiButton";
import Icon from "@/components/Icons";
import { LogoIconChip } from "@/components/Logo";

// Nav glyphs come from Tabler; the rest of the app (including the collapse
// chevron and Sign out below) stays on the in-house set. Stroke is dialled
// from Tabler's default 2 down to 1.75 so the two sets sit together.
// The nav, in labelled groups. Dashboard stands on its own above them: it is
// the one item that is not a place in the work but a reading of all of it, and
// grouping it with anything would say otherwise.
//
// The three groups are the app's own structure rather than a taxonomy imposed
// on it — the funnel a clinic travels, the work a day is made of, and the
// tools that feed the top of the funnel. Every item is where it was, in a
// group that says why.
const DASHBOARD = {
  href: "/",
  label: "Dashboard",
  Glyph: IconLayoutDashboard,
} as const;

interface NavGroup {
  label: string;
  items: { href: string; label: string; Glyph: typeof IconLayoutDashboard }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    // The funnel, in the order a clinic travels it: everything scraped lands
    // in Discovery, only what scores gets through to Pipeline, the A- and
    // B-tier ones nobody has written to yet queue up for outreach, and what
    // closes becomes a client.
    label: "Pipeline",
    items: [
      { href: "/discovery", label: "Discovery", Glyph: IconRadar2 },
      { href: "/pipeline", label: "Pipeline", Glyph: IconGitBranch },
      // Between the pipeline and the clients because that is where it sits in
      // the work: a lead is in the pipeline before anybody has written to it,
      // and this is the list of the ones nobody has.
      { href: "/outreach", label: "Outreach Queue", Glyph: IconSend },
      { href: "/clients", label: "Clients", Glyph: IconUsers },
    ],
  },
  {
    // The day's own work — what is booked, what is owed, and what went out to
    // clients. None of the three owns a record in the funnel; they are read
    // from a standing start each morning.
    label: "Operations",
    items: [
      { href: "/calendar", label: "Calendar", Glyph: IconCalendarEvent },
      { href: "/activities", label: "Activities", Glyph: IconChecklist },
      { href: "/reporting", label: "Reporting", Glyph: IconChartBar },
    ],
  },
  {
    // What feeds the funnel rather than sitting in it: the ad workshop, the
    // day's own numbers against their goals, and the reusable copy.
    label: "Growth tools",
    items: [
      { href: "/ad-hub", label: "Ad Hub", Glyph: IconBulb },
      { href: "/daily-kpi", label: "Daily KPI", Glyph: IconTargetArrow },
      { href: "/library", label: "Library", Glyph: IconBook },
    ],
  },
];

// Every nav item, flat — what the active-item match below reads.
const NAV = [DASHBOARD, ...NAV_GROUPS.flatMap((g) => g.items)];

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
      <nav
        className={`flex-1 overflow-y-auto py-1 ${collapsed ? "px-2" : "px-3"}`}
      >
        <NavItem item={DASHBOARD} collapsed={collapsed} pathname={pathname} />
        {/* One group per section, each headed by its label. Collapsed, the
            headings go and the rule between groups stays: at 64px wide there
            is no room for a word, but the grouping is still worth keeping and
            a hairline is what is left of it. */}
        {NAV_GROUPS.map((group) => (
          <div
            key={group.label}
            className={`mt-2 pt-2 ${collapsed ? "border-t border-line/50" : ""}`}
          >
            {!collapsed && (
              <>
                <div className="px-3 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-muted/80">
                  {group.label.toUpperCase()}
                </div>
                {/* A hairline under the heading, the same border-line/60 rule
                    that separates Settings at the foot — so the label reads as
                    the head of the list beneath it rather than as another row
                    floating above it. Collapsed there is no heading and the
                    rule between groups above does this job instead. */}
                <div className="mx-3 mb-1.5 border-t border-line/60" />
              </>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  pathname={pathname}
                />
              ))}
            </div>
          </div>
        ))}
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

// One row of the nav. Lifted out of the list when the list became three lists:
// the row is the same object in every group, and it is drawn in exactly one
// place so it stays that way.
function NavItem({
  item,
  collapsed,
  pathname,
}: {
  item: { href: string; label: string; Glyph: typeof IconLayoutDashboard };
  collapsed: boolean;
  pathname: string;
}) {
  const active = item.href === activeHref(pathname);
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`flex h-[42px] items-center gap-2 rounded-[10px] text-sm font-normal ${NAV_MOTION} ${
        collapsed ? "justify-center px-0" : "px-3"
      } ${active ? "nav-active" : "text-muted hover:bg-wash hover:text-ink"}`}
    >
      <item.Glyph size={20} stroke={1.75} className="shrink-0" />
      {!collapsed && item.label}
    </Link>
  );
}
