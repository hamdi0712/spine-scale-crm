"use client";

// The four US zones with the local time and whether the clinics there are
// likely to be at their desks. Live, so it renders a placeholder on the server
// and starts ticking on mount — the same hydration deal as the other clocks.

import { useEffect, useState } from "react";
import { businessHours, OpenState } from "@/lib/businessHours";
import { US_TIME_ZONES, fmtTimeInZone, zoneAbbr } from "@/lib/timezones";
import Icon from "@/components/Icons";

// The panel sits on navy now, so the dot and the badge are drawn for a dark
// ground: the state colours lightened to stay legible on it, and the badge's
// fill turned translucent so it takes its body from whatever is behind it. The
// three states are the same three states, and Closed is deliberately the
// quietest of them — most of the map is closed most of the time.
const DOT: Record<OpenState, string> = {
  open: "bg-[#4ADE9E]",
  "opening-soon": "bg-[#F0C069]",
  closed: "bg-white/25",
};

const BADGE: Record<OpenState, string> = {
  open: "bg-[#1FAA6D]/25 text-[#8FE9C0]",
  "opening-soon": "bg-[#D89B2D]/25 text-[#F5D49B]",
  closed: "bg-white/10 text-white/70",
};

// Ticks slowly — the badges change on the hour, not the second.
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// The header's at-a-glance version: how many of the four zones are open right
// now. Sits where a control would in the mock-up, and says something true
// instead of pretending to be a menu.
export function BusinessHoursChip() {
  const now = useNow();
  const open = now
    ? US_TIME_ZONES.filter((z) => businessHours(now, z.id).state === "open").length
    : null;
  return (
    <span className="inline-flex h-[42px] items-center gap-2 rounded-[10px] border border-line bg-surface px-[18px] text-sm font-medium text-[#4B5563]">
      <Icon name="clock" className="h-4 w-4 text-muted" />
      US business hours
      <span className="num text-muted">
        {open === null ? "—" : `${open} of ${US_TIME_ZONES.length} open`}
      </span>
    </span>
  );
}

// Four rows, not four tiles. The tiles were taller than the strip needs to be
// and pushed this card — and Today's focus beside it, which matches its height
// — well past what the dashboard has room for. A row is a dot, a zone, its
// time and its badge on one line, which is all this has ever needed to say.
//
// The row itself is the original layout; only the materials changed for the
// dark ground it now sits on.
export default function BusinessHoursPanel() {
  const now = useNow();

  return (
    <ul>
      {US_TIME_ZONES.map((zone) => {
        const hours = now ? businessHours(now, zone.id) : null;
        const state: OpenState = hours?.state ?? "closed";
        return (
          <li
            key={zone.id}
            className="flex items-center gap-3 border-b border-white/10 py-2.5 last:border-b-0"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                now ? DOT[state] : "bg-white/25"
              }`}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
              {zone.label}
              <span className="ml-1.5 text-xs font-normal text-white/60">
                {now ? `(${zoneAbbr(now, zone.id)})` : ""}
              </span>
            </span>
            <span className="num shrink-0 text-sm font-medium text-white">
              {now ? fmtTimeInZone(now, zone.id) : "\u2014:\u2014"}
            </span>
            <span
              className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${
                now ? BADGE[state] : "bg-white/10 text-white/70"
              }`}
            >
              {hours ? hours.label : "\u2014"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
