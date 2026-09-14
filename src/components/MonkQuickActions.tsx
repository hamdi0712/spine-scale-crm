// The three places the dashboard does not have room for, as rows.
//
// Each panel on the dashboard is a glance; these are the pages behind them —
// the whole calendar rather than one month's widget, the journal rather than
// today's box, and the stats rather than one donut. Drawn as rows with a
// tinted mark, a line of copy and a chevron, which is the shape the Now card's
// call to action already uses.

import Link from "next/link";
import {
  IconCalendarEvent,
  IconChartBar,
  IconNotebook,
} from "@tabler/icons-react";
import Icon from "@/components/Icons";

const ACTIONS = [
  {
    href: "/monk-mode/calendar",
    label: "View Calendar",
    detail: "The whole challenge, day by day",
    Glyph: IconCalendarEvent,
    tone: "bg-accent/10 text-accent",
  },
  {
    href: "/monk-mode/journal",
    label: "Journal",
    detail: "Everything you have written down",
    Glyph: IconNotebook,
    tone: "bg-purple/10 text-purple",
  },
  {
    href: "/monk-mode/progress",
    label: "View Progress",
    detail: "Per-habit stats for the challenge",
    Glyph: IconChartBar,
    tone: "bg-teal/10 text-teal",
  },
] as const;

export default function MonkQuickActions() {
  return (
    <ul className="-mx-2 space-y-1">
      {ACTIONS.map((action) => (
        <li key={action.href}>
          <Link
            href={action.href}
            className="flex items-center gap-3 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-wash/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${action.tone}`}
            >
              <action.Glyph size={18} stroke={1.75} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{action.label}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {action.detail}
              </span>
            </span>
            <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
