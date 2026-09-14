"use client";

// Monk Mode's own navigation.
//
// The four views of one challenge, plus the habit list behind them. Drawn as
// the app's segmented control (.segment / .segment-item) — the same treatment
// the settings sections and the pipeline's Table/Board toggle wear — so a
// sub-navigation looks like a control the app already has rather than a new
// pattern invented for this corner of it.
//
// It replaced a Quick Actions card on the dashboard that held three links and
// a card's worth of height. Three links do not need a panel; they need to be
// where you look for navigation, which is the top of the page.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconCalendarMonth,
  IconChartBar,
  IconNotebook,
  IconSettings,
  IconTargetArrow,
} from "@tabler/icons-react";

const SECTIONS = [
  { href: "/monk-mode", label: "Today", Glyph: IconTargetArrow },
  { href: "/monk-mode/calendar", label: "Calendar", Glyph: IconCalendarMonth },
  { href: "/monk-mode/journal", label: "Journal", Glyph: IconNotebook },
  { href: "/monk-mode/progress", label: "Progress", Glyph: IconChartBar },
  // The habit list. Last and behind a rule, the same place Settings sits in
  // the sidebar and for the same reason: it changes what the other four are
  // about rather than being another way of reading them.
  { href: "/monk-mode/settings", label: "Habits", Glyph: IconSettings },
] as const;

// "/monk-mode" is a prefix of every other href, so — as in the sidebar — it
// only ever matches itself.
function isActive(pathname: string, href: string): boolean {
  if (href === "/monk-mode") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MonkModeNav() {
  const pathname = usePathname();
  return (
    <nav className="segment w-fit" aria-label="Monk Mode sections">
      {SECTIONS.map((section) => {
        const active = isActive(pathname, section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={`segment-item ${active ? "segment-item-on" : ""} ${
              // The rule before Habits, drawn as a left border on the item
              // itself so it moves with the item rather than being a separate
              // element the flex row has to space around.
              section.href === "/monk-mode/settings"
                ? "ml-1 border-l border-line pl-3.5"
                : ""
            }`}
          >
            <section.Glyph size={16} stroke={1.75} aria-hidden />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
