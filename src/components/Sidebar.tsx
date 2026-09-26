"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconLayoutDashboard } from "@tabler/icons-react";
import { logout } from "@/lib/actions/auth";
import Icon from "@/components/Icons";
import ImanAvatar from "@/components/ImanAvatar";
import { LogoIconChip } from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import {
  activeHref,
  COPILOT,
  DASHBOARD,
  NAV_GROUPS,
  SETTINGS,
} from "@/components/navConfig";

// Colour, border and the active card's shadow all ease together; nothing
// moves. No duration or curve here: the app's shared timing is Tailwind's
// default (tailwind.config.ts), so this reads the same value every other
// transition in the app does.
const NAV_MOTION =
  "transition-[color,background-color,border-color,box-shadow]";

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const copilotActive =
    pathname === COPILOT.href || pathname.startsWith(`${COPILOT.href}/`);
  const settingsActive =
    pathname === SETTINGS.href || pathname.startsWith(`${SETTINGS.href}/`);
  return (
    <aside
      // Below md the sidebar is not drawn at all: a phone navigates by the
      // bottom tab bar instead (MobileNav). z-index only from md to lg, where
      // it is the icon rail and must sit over the page's sticky furniture.
      className={`fixed inset-y-0 left-0 flex flex-col border-r border-line/70 bg-panel max-md:hidden md:max-lg:z-30 ${
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
          // From md to lg the sidebar is held to the icon rail (AppShell), so
          // there is nothing for this to toggle there.
          className="rounded-[10px] p-2 md:max-lg:hidden text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
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
      {/* Iman, the copilot. A nav row rather than a button, because it is a
          page you go to now instead of a panel that opened over whatever you
          were looking at. It keeps its place below the nav all the same: it is
          not a stage of the funnel, and grouping it with one would say it was.
          Its glyph is Iman's own face, which is what the page is headed with. */}
      <div className={`py-3 ${collapsed ? "px-2" : "px-3"}`}>
        <Link
          href={COPILOT.href}
          title={collapsed ? COPILOT.label : undefined}
          className={`flex h-[42px] items-center gap-2 rounded-[10px] text-sm font-normal ${NAV_MOTION} ${
            collapsed ? "justify-center px-0" : "px-3"
          } ${
            copilotActive
              ? "nav-active"
              : "text-muted hover:bg-wash hover:text-ink"
          }`}
        >
          <ImanAvatar size="nav" />
          {!collapsed && COPILOT.label}
        </Link>
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
        {/* Directly under Settings, inside the same block behind the rule.
            It belongs with Settings rather than with the nav for the same
            reason Settings does: it changes how the app is drawn, not where
            you are in it. */}
        <ThemeToggle collapsed={collapsed} />
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
