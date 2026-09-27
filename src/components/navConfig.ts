// The app's navigation, read by both of the shells that draw it: the sidebar
// at tablet width and up, and the bottom tab bar and its More sheet on a
// phone (MobileNav). One list, so a page added here appears in both.

import {
  IconBook,
  IconBulb,
  IconCalendarEvent,
  IconChartBar,
  IconChecklist,
  IconGitBranch,
  IconLayoutDashboard,
  IconMoonStars,
  IconRadar2,
  IconSend,
  IconSettings,
  IconTargetArrow,
  IconUsers,
} from "@tabler/icons-react";

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
export const DASHBOARD = {
  href: "/",
  label: "Dashboard",
  Glyph: IconLayoutDashboard,
} as const;

export interface NavGroup {
  label: string;
  items: { href: string; label: string; Glyph: typeof IconLayoutDashboard }[];
}

export const NAV_GROUPS: NavGroup[] = [
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
  {
    // Monk Mode, alone under its own heading, and that is the point of the
    // heading. The three groups above are the agency's work — the funnel, the
    // day, what feeds the funnel — and this is the one item in the sidebar
    // that is not about the business at all. Folding it into Operations would
    // say it was another piece of the day's admin; a group of its own says
    // what it is. Last, because it is the one thing here nobody opens in
    // order to do their job.
    label: "Personal",
    items: [{ href: "/monk-mode", label: "Monk Mode", Glyph: IconMoonStars }],
  },
];

// Every nav item, flat — what the active-item match below reads.
export const NAV = [DASHBOARD, ...NAV_GROUPS.flatMap((g) => g.items)];

// Settings is not in NAV. It is the one thing in the sidebar that is not a
// place in the funnel — it changes how the app runs rather than showing what is
// in it — and it is drawn below the divider at the foot rather than in the list.
// Everything under /settings lights it, including the pipeline settings that
// used to be a nav item of their own.

// Iman is not in NAV either, and for the same reason Settings is not: it sits
// below the list rather than in it. It was the "AI Copilot" button here until
// the copilot became a page; the row it replaced that button with is the one
// place in the sidebar that carries the assistant's own face rather than a
// glyph.
export const COPILOT = {
  href: "/copilot",
  label: "Iman",
} as const;

export const SETTINGS = {
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
export function activeHref(pathname: string): string | null {
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

// Whether the path is the page itself or anywhere under it.
export function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
