"use client";

// The four US zones with the local time and whether the clinics there are
// likely to be at their desks. Live, so it renders a placeholder on the server
// and starts ticking on mount — the same hydration deal as the other clocks.

import { useEffect, useState } from "react";
import { businessHours, OpenState } from "@/lib/businessHours";
import { US_TIME_ZONES, fmtTimeInZone, zoneAbbr } from "@/lib/timezones";
import Icon from "@/components/Icons";

const DOT: Record<OpenState, string> = {
  open: "bg-ok",
  "opening-soon": "bg-warn",
  closed: "bg-line",
};

const BADGE: Record<OpenState, string> = {
  open: "bg-ok-soft text-ok",
  "opening-soon": "bg-warn-soft text-warn",
  closed: "bg-wash text-muted",
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
            className="flex items-center gap-3 border-b border-line/60 py-3.5 last:border-b-0"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${now ? DOT[state] : "bg-line"}`}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {zone.label}
              <span className="ml-1.5 text-xs font-normal text-muted">
                {now ? `(${zoneAbbr(now, zone.id)})` : ""}
              </span>
            </span>
            <span className="num shrink-0 text-sm font-medium">
              {now ? fmtTimeInZone(now, zone.id) : "—:—"}
            </span>
            <span
              className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${
                now ? BADGE[state] : "bg-wash text-muted"
              }`}
            >
              {hours ? hours.label : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
