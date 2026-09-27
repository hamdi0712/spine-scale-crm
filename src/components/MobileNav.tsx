"use client";

// The phone's shell, drawn only below md where the sidebar is not: a slim
// sticky bar across the top and a tab bar along the bottom.
//
// The tab bar carries the four places a phone is actually opened for — the
// dashboard, the outreach queue, Monk Mode and Iman — and a More tab that
// raises a sheet holding every other page, grouped exactly as the sidebar
// groups them, with Settings, the theme toggle and Sign out at its foot.
//
// The top bar names the page and holds the page's own actions behind a ⋯
// button (PageActions portals into it). Its title stays out of the way while
// the page's own heading is on screen, and fades in once that heading has
// scrolled under the bar — the page is never titled twice at once.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconChevronLeft,
  IconDots,
  IconLayoutDashboard,
  IconMoonStars,
  IconSend,
} from "@tabler/icons-react";
import { logout } from "@/lib/actions/auth";
import Icon from "@/components/Icons";
import ImanAvatar from "@/components/ImanAvatar";
import { LogoIconChip } from "@/components/Logo";
import Sheet from "@/components/Sheet";
import ThemeToggle from "@/components/ThemeToggle";
import {
  activeHref,
  COPILOT,
  isUnder,
  NAV,
  NAV_GROUPS,
  SETTINGS,
} from "@/components/navConfig";

// The id PageActions portals a page's actions menu into.
export const TOPBAR_ACTIONS_ID = "mobile-topbar-actions";

const TABS = [
  { href: "/", label: "Dashboard", Glyph: IconLayoutDashboard },
  { href: "/outreach", label: "Outreach", Glyph: IconSend },
  { href: "/monk-mode", label: "Monk Mode", Glyph: IconMoonStars },
] as const;

// Everything the tab bar does not already carry, in the sidebar's groups.
// Monk Mode and the outreach queue are tabs, so they are left out here; a
// group they empty is dropped rather than drawn as a heading over nothing.
const TAB_HREFS = new Set<string>([...TABS.map((t) => t.href), COPILOT.href]);
const MORE_GROUPS = NAV_GROUPS.map((g) => ({
  ...g,
  items: g.items.filter((i) => !TAB_HREFS.has(i.href)),
})).filter((g) => g.items.length > 0);

function tabActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : isUnder(pathname, href);
}

// The page's name, from the same nav the sidebar lights. Pages that are not a
// nav item of their own (the activity log) fall back to the app's name.
function titleFor(pathname: string): { title: string; href: string | null } {
  if (isUnder(pathname, COPILOT.href)) return { title: COPILOT.label, href: COPILOT.href };
  if (isUnder(pathname, SETTINGS.href)) return { title: SETTINGS.label, href: SETTINGS.href };
  if (isUnder(pathname, "/activity")) return { title: "Activity", href: "/activity" };
  const href = activeHref(pathname);
  const item = NAV.find((n) => n.href === href);
  return item ? { title: item.label, href: item.href } : { title: "Spine Scale", href: null };
}

export function MobileTopBar() {
  const pathname = usePathname();
  const { title, href } = titleFor(pathname);
  // A page below its section's root (a lead, a client, a concept) gets a way
  // back up to the list it came from.
  const nested = href !== null && href !== "/" && pathname !== href;
  const [headingVisible, setHeadingVisible] = useState(true);

  useEffect(() => {
    const h1 = document.querySelector("main h1");
    if (!h1) {
      setHeadingVisible(false);
      return;
    }
    setHeadingVisible(true);
    const io = new IntersectionObserver(
      ([entry]) => setHeadingVisible(entry.isIntersecting),
      // The bar's own height is taken off the top, so the heading counts as
      // gone the moment it slides under the bar rather than off the screen.
      { rootMargin: "-56px 0px 0px 0px" },
    );
    io.observe(h1);
    return () => io.disconnect();
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-md backdrop-saturate-150 md:hidden">
      <div className="flex h-12 items-center gap-2 pl-2 pr-2">
        {nested ? (
          <Link
            href={href}
            aria-label={`Back to ${title}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-muted active:bg-wash"
          >
            <IconChevronLeft size={22} stroke={1.75} />
          </Link>
        ) : (
          <Link href="/" aria-label="Dashboard" className="flex h-11 w-11 shrink-0 items-center justify-center">
            <LogoIconChip className="!h-7 !w-7 !rounded-md" />
          </Link>
        )}
        <div
          className={`display min-w-0 flex-1 truncate text-[15px] font-semibold text-ink transition-opacity ${
            headingVisible ? "opacity-0" : "opacity-100"
          }`}
        >
          {title}
        </div>
        {/* PageActions portals the ⋯ button in here. */}
        <div id={TOPBAR_ACTIONS_ID} className="flex shrink-0 items-center" />
      </div>
    </header>
  );
}

// The on-screen keyboard, as far as a page can see it.
//
// Two things are kept on <html> for CSS to read: --vvh, the visual viewport's
// height (what is actually on screen above the keyboard), and data-keyboard
// while a keyboard is up. Android with interactive-widget=resizes-content
// shrinks the layout itself; iOS Safari ignores that key and only shrinks the
// visual viewport, so this is the fallback that lets the copilot's composer
// ride above the keyboard there too. With the keyboard up the tab bar steps
// out of the way (globals.css), because a bar of navigation squeezed between
// the keyboard and a text field is space the field needs.
function useKeyboardViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let tallest = vv.height;
    const update = () => {
      tallest = Math.max(tallest, vv.height, window.innerHeight);
      const el = document.activeElement as HTMLElement | null;
      const editing =
        !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      const open = editing && vv.height < tallest * 0.8;
      root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      if (open) root.dataset.keyboard = "";
      else delete root.dataset.keyboard;
    };
    // A rotation changes what "full height" means.
    const reset = () => {
      tallest = 0;
      update();
    };
    update();
    vv.addEventListener("resize", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    window.addEventListener("orientationchange", reset);
    return () => {
      vv.removeEventListener("resize", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
      window.removeEventListener("orientationchange", reset);
      root.style.removeProperty("--vvh");
      delete root.dataset.keyboard;
    };
  }, []);
}

export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  useKeyboardViewport();

  // Any navigation — a tile in the sheet, or the back gesture — puts it away.
  useEffect(() => setMoreOpen(false), [pathname]);

  const onTab = TABS.some((t) => tabActive(pathname, t.href)) || isUnder(pathname, COPILOT.href);
  const moreActive = moreOpen || !onTab;
  const current = activeHref(pathname);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-panel/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md backdrop-saturate-150 md:hidden"
      >
        <div className="mx-auto flex h-[var(--tabbar-h)] max-w-lg items-stretch">
          {TABS.map((t) => (
            <TabLink key={t.href} href={t.href} label={t.label} active={!moreOpen && tabActive(pathname, t.href)}>
              <t.Glyph size={22} stroke={1.75} />
            </TabLink>
          ))}
          <TabLink
            href={COPILOT.href}
            label={COPILOT.label}
            active={!moreOpen && isUnder(pathname, COPILOT.href)}
          >
            <ImanAvatar size="nav" />
          </TabLink>
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={`tab-item ${moreActive ? "tab-item-on" : ""}`}
          >
            <IconDots size={22} stroke={1.75} />
            <span>More</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="All pages">
        <div className="space-y-5 pt-1">
          {MORE_GROUPS.map((group) => (
            <section key={group.label}>
              <div className="pb-2 text-[11px] font-medium tracking-[0.06em] text-muted/80">
                {group.label.toUpperCase()}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {group.items.map((item) => {
                  const on = item.href === current;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[14px] border px-2 py-3 text-center text-xs font-medium transition-transform active:scale-[0.97] ${
                        on
                          ? "border-accent/30 bg-accent/10 text-accent"
                          : "border-line bg-surface text-ink-soft"
                      }`}
                    >
                      <item.Glyph size={22} stroke={1.75} />
                      <span className="leading-tight">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
          <section className="space-y-1 border-t border-line/60 pt-3">
            <Link
              href={SETTINGS.href}
              className={`flex h-11 items-center gap-2 rounded-[10px] px-3 text-sm ${
                isUnder(pathname, SETTINGS.href) ? "nav-active" : "text-muted active:bg-wash"
              }`}
            >
              <SETTINGS.Glyph size={20} stroke={1.75} className="shrink-0" />
              {SETTINGS.label}
            </Link>
            <ThemeToggle collapsed={false} />
            <form action={logout}>
              <button
                type="submit"
                className="flex h-11 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm text-muted active:bg-wash"
              >
                <Icon name="logout" />
                Sign out
              </button>
            </form>
          </section>
        </div>
      </Sheet>
    </>
  );
}

function TabLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`tab-item ${active ? "tab-item-on" : ""}`}
    >
      {children}
      <span>{label}</span>
    </Link>
  );
}
