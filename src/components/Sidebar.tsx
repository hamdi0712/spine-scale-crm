"use client";

// The sidebar, grouped by how the work goes (navConfig.ts): Ask Iman at the
// top, the day's own pages straight under Dashboard, then Sales, Clients,
// Marketing and Personal under small sentence-case headings that fold. Counts
// sit beside the places with something waiting (src/lib/navCounts.ts). The
// account controls — theme, Guided/Pro, sign out — live in one profile menu at
// the foot, beside Settings.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconChevronDown,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSelector,
  IconSparkles,
} from "@tabler/icons-react";
import CommandSearch from "@/components/CommandSearch";
import { readStoredMode } from "@/lib/displayMode";
import { logout } from "@/lib/actions/auth";
import Icon from "@/components/Icons";
import ImanAvatar from "@/components/ImanAvatar";
import { LogoIconChip } from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import DisplayModeToggle from "@/components/DisplayModeToggle";
import { JobPill } from "@/components/JobProgress";
import { activeHref, COPILOT, DASHBOARD, NAV_GROUPS, SETTINGS } from "@/components/navConfig";
import type { NavCount, NavCounts } from "@/lib/navCounts";

const NAV_MOTION = "transition-[color,background-color,border-color,box-shadow]";
const FOLDED_KEY = "sidebar-folded-groups";
const USER_NAME = "Hamdi";

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const copilotActive = pathname === COPILOT.href || pathname.startsWith(`${COPILOT.href}/`);
  const settingsActive = pathname === SETTINGS.href || pathname.startsWith(`${SETTINGS.href}/`);
  const counts = useNavCounts(pathname);

  // Which groups are folded, remembered per browser.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setFolded(new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]")));
    } catch {}
  }, []);
  function toggleGroup(label: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }

  return (
    <aside
      className={`sidebar-compact fixed inset-y-0 left-0 flex flex-col border-r border-line/70 bg-panel max-md:hidden md:max-lg:z-30 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className={`flex items-center px-4 pb-3 pt-4 ${collapsed ? "flex-col gap-3 px-0" : "justify-between"}`}>
        {collapsed ? (
          <LogoIconChip className="!h-6 !w-6 !rounded-[7px]" />
        ) : (
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <LogoIconChip className="!h-6 !w-6 !rounded-[7px]" />
            <span className="display truncate text-[14px] font-semibold text-ink">Spine Scale</span>
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-[8px] p-1.5 text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 md:max-lg:hidden"
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand size={17} stroke={1.75} aria-hidden />
          ) : (
            <IconLayoutSidebarLeftCollapse size={17} stroke={1.75} aria-hidden />
          )}
        </button>
      </div>

      {/* Search: pages and every clinic in the app, also on ⌘K. */}
      <div className={collapsed ? "flex justify-center px-2 pb-2" : "px-3 pb-2"}>
        <CommandSearch collapsed={collapsed} />
      </div>

      {/* Ask Iman: something you use from anywhere, so it sits above the list
          rather than in it. */}
      <div className={collapsed ? "flex justify-center px-2 pb-2" : "px-3 pb-2"}>
        <Link
          href={COPILOT.href}
          title={collapsed ? "Ask Iman" : undefined}
          className={`flex h-[34px] items-center gap-2 rounded-[10px] border text-[13px] font-medium ${NAV_MOTION} ${
            collapsed ? "w-10 justify-center px-0" : "px-2.5"
          } ${
            copilotActive
              ? "border-ai/40 bg-ai/15 text-ink"
              : "border-ai/20 bg-gradient-to-br from-ai/10 to-accent/[0.07] text-ink hover:border-ai/35"
          }`}
        >
          <ImanAvatar size="nav" />
          {!collapsed && (
            <>
              <span className="flex-1">Ask Iman</span>
              <IconSparkles size={14} stroke={1.75} className="text-ai" aria-hidden />
            </>
          )}
        </Link>
      </div>

      {/* A long-running job, while one runs — on every page. */}
      <div className={collapsed ? "flex justify-center pb-1" : "px-3 pb-1"}>
        <JobPill variant={collapsed ? "rail" : "sidebar"} />
      </div>

      <nav className={`flex-1 overflow-y-auto py-1 ${collapsed ? "px-2" : "px-3"}`}>
        <div className="space-y-px">
          <NavItem item={DASHBOARD} collapsed={collapsed} pathname={pathname} />
        </div>
        {NAV_GROUPS.map((group) => {
          const isFolded = !collapsed && !group.headless && folded.has(group.label);
          return (
            <div
              key={group.label}
              className={group.headless ? "" : `mt-3.5 ${collapsed ? "border-t border-line/50 pt-2" : ""}`}
            >
              {!collapsed && !group.headless && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={!isFolded}
                  className="group/head flex w-full items-center justify-between rounded-md px-3 pb-1 text-left text-[11px] font-medium text-muted hover:text-ink"
                >
                  {group.label}
                  <IconChevronDown
                    size={12}
                    stroke={2}
                    aria-hidden
                    className={`opacity-60 transition-transform ${isFolded ? "-rotate-90" : ""}`}
                  />
                </button>
              )}
              {!isFolded && (
                <div className="space-y-px">
                  {group.items.map((item) => (
                    <NavItem
                      key={item.href}
                      item={item}
                      collapsed={collapsed}
                      pathname={pathname}
                      count={counts?.[item.href]}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className={`border-t border-line/60 pb-3 pt-2 ${collapsed ? "px-2" : "px-3"}`}>
        <Link
          href={SETTINGS.href}
          title={collapsed ? SETTINGS.label : undefined}
          className={`flex h-[42px] items-center gap-2 rounded-[10px] text-sm font-normal ${NAV_MOTION} ${
            collapsed ? "justify-center px-0" : "px-3"
          } ${settingsActive ? "nav-active" : "text-muted hover:bg-wash hover:text-ink"}`}
        >
          <SETTINGS.Glyph size={20} stroke={1.75} className="shrink-0" />
          {!collapsed && SETTINGS.label}
        </Link>
        <ProfileMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}

// The counts, fetched on load, on every page change and once a minute.
function useNavCounts(pathname: string): NavCounts | null {
  const [counts, setCounts] = useState<NavCounts | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/nav-counts", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((c) => live && c && setCounts(c))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [pathname]);
  return counts;
}

const BADGE_TONE: Record<NavCount["tone"], string> = {
  muted: "bg-wash text-muted",
  warn: "bg-warn-soft text-warn-on-soft",
  bad: "bg-bad-soft text-bad-on-soft",
};
const DOT_TONE: Record<NavCount["tone"], string> = { muted: "bg-muted", warn: "bg-warn", bad: "bg-bad" };

function NavItem({
  item,
  collapsed,
  pathname,
  count,
}: {
  item: { href: string; label: string; Glyph: typeof IconLayoutDashboard };
  collapsed: boolean;
  pathname: string;
  count?: NavCount;
}) {
  const active = item.href === activeHref(pathname);
  const show = count && count.n > 0;
  return (
    <Link
      href={item.href}
      title={collapsed ? `${item.label}${show ? ` · ${count.n}` : ""}` : undefined}
      className={`relative flex h-[42px] items-center gap-2 rounded-[10px] text-sm font-normal ${NAV_MOTION} ${
        collapsed ? "justify-center px-0" : "px-3"
      } ${active ? "nav-active" : "text-muted hover:bg-wash hover:text-ink"}`}
    >
      <item.Glyph size={20} stroke={1.75} className="shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {show &&
        (collapsed ? (
          <span className={`absolute right-2 top-2 h-1.5 w-1.5 rounded-full ${DOT_TONE[count.tone]}`} aria-hidden />
        ) : (
          <span
            className={`num inline-flex h-[18px] min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold ${BADGE_TONE[count.tone]}`}
          >
            {count.n > 99 ? "99+" : count.n}
          </span>
        ))}
    </Link>
  );
}

// You, at the foot: one row that opens a small menu holding the light/dark
// switch, Guided/Pro and Sign out — four rows of controls folded into one.
function ProfileMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const modeLine = useModeLine();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={collapsed ? USER_NAME : undefined}
        className={`flex w-full items-center gap-2.5 rounded-[10px] py-1.5 text-left hover:bg-wash ${
          collapsed ? "justify-center px-0" : "px-2"
        } ${open ? "bg-wash" : ""}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ai to-accent text-[11px] font-semibold text-white">
          HD
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{USER_NAME}</span>
              <span className="block truncate text-[11px] text-muted">{modeLine}</span>
            </span>
            <IconSelector size={14} stroke={1.75} className="text-muted" aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={`card absolute bottom-full z-40 mb-2 w-56 overflow-visible p-2 shadow-card-hover ${collapsed ? "left-0" : "left-0 right-0 w-auto"}`}
        >
          <ThemeToggle collapsed={false} />
          <DisplayModeToggle variant="sidebar" />
          <div className="my-1.5 border-t border-line/60" />
          <form action={logout}>
            <button
              type="submit"
              className="flex h-[42px] w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm font-normal text-muted hover:bg-wash hover:text-ink"
            >
              <Icon name="logout" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// "Guided · Light": the display mode and theme in force, kept current as
// either is switched (both toggles announce themselves).
function useModeLine(): string {
  const [line, setLine] = useState("Account & display");
  useEffect(() => {
    const read = () => {
      const mode = readStoredMode() === "pro" ? "Pro" : "Guided";
      const theme = document.documentElement.classList.contains("dark") ? "Dark" : "Light";
      setLine(`${mode} · ${theme}`);
    };
    read();
    window.addEventListener("display-mode", read);
    window.addEventListener("storage", read);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.removeEventListener("display-mode", read);
      window.removeEventListener("storage", read);
      mo.disconnect();
    };
  }, []);
  return line;
}
