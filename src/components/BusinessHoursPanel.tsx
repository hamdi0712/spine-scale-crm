"use client";

// The four US zones with the local time and whether the clinics there are
// likely to be at their desks. Live, so it renders a placeholder on the server
// and starts ticking on mount — the same hydration deal as the other clocks.

import { useEffect, useState } from "react";
import { businessHours, fmtUntil, OpenState, zoneDay } from "@/lib/businessHours";
import { US_TIME_ZONES, fmtTimeInZone, zoneAbbr } from "@/lib/timezones";
import Icon from "@/components/Icons";
import { IconMoon, IconSun, IconSunrise } from "@tabler/icons-react";

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

// Ticks every fifteen seconds. Not the second — nothing here is measured
// finer than a minute — but not the half-minute it used to be either: the
// badge counts down in whole minutes inside the last hour before a zone opens,
// and a thirty-second tick left it up to half a minute behind its own clock,
// which is visible when the minute it is counting to is the one on the tile
// above it.
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
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
    <span className="inline-flex h-[42px] items-center gap-2 rounded-[10px] border border-line bg-surface px-[18px] text-sm font-medium text-ink-soft">
      <Icon name="clock" className="h-4 w-4 text-muted" />
      US business hours
      <span className="num text-muted">
        {open === null ? "—" : `${open} of ${US_TIME_ZONES.length} open`}
      </span>
    </span>
  );
}

// Four glass tiles across, not four rows down. The zones are peers — nobody
// reads this list top to bottom looking for one of them, they scan it for
// which are lit — and a row of tiles says "four places, at once" where a
// stacked list said "a ranking".
//
// Sized to the card rather than the other way round. The tiles were what made
// this panel too tall the first time, so the padding, the time and the gaps
// are all a notch down from where they started, and the tile carries no
// stretched-out column: it is label, time, zone, badge, tight.
//
// Two columns below the sm breakpoint: at four across, a tile is narrower than
// the time inside it.
//
// leadCounts: open leads per zone id, for the big monitor's richer tiles.
export default function BusinessHoursPanel({ leadCounts = {} }: { leadCounts?: Record<string, number> }) {
  const now = useNow();

  return (
    <>
    <RichTiles now={now} leadCounts={leadCounts} />
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 wide:hidden">
      {US_TIME_ZONES.map((zone) => {
        const hours = now ? businessHours(now, zone.id) : null;
        const state: OpenState = hours?.state ?? "closed";
        return (
          // h-full with the badge pushed down by mt-auto: the four tiles are
          // the same height whatever their contents, so the badges sit on one
          // line across the row rather than stepping with the text above them.
          <li
            key={zone.id}
            className="zone-tile flex h-full flex-col rounded-[14px] p-2.5 backdrop-blur-md"
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  now ? DOT[state] : "bg-white/25"
                }`}
                aria-hidden
              />
              <span className="min-w-0 truncate text-[11px] font-medium text-white/75">
                {zone.label}
              </span>
            </span>
            {/* nowrap at 16px: four tiles across a half-width card leaves about
                120px of room, and the time at a larger size spent it by
                breaking over two lines. */}
            <span className="num mt-1.5 block whitespace-nowrap text-[16px] font-semibold leading-none tracking-tight text-white">
              {now ? fmtTimeInZone(now, zone.id) : "\u2014:\u2014"}
            </span>
            <span className="mt-1 block text-[10px] leading-none text-white/60">
              {now ? zoneAbbr(now, zone.id) : " "}
            </span>
            <span className="mt-auto block pt-2">
              <span
                className={`inline-flex h-[20px] shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[11px] font-medium ${
                  now ? BADGE[state] : "bg-white/10 text-white/70"
                }`}
              >
                {hours ? hours.label : "\u2014"}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
    </>
  );
}

// ─── The big monitor ───────────────────────────────────────────────────────

// From the wide breakpoint up the tiles have the room to say more than the
// time: a 9-to-5 track with where the day is, exactly how long is left or
// how long until it opens, day or night there, and how many open leads sit in
// that zone. The tile takes the state's colour — green open, amber in the hour
// before, glass closed. Below the breakpoint this is hidden and the compact
// tiles above are the panel, unchanged.
const RICH_TILE: Record<OpenState, string> = {
  open: "border-[#4ADE80]/45 bg-gradient-to-b from-[#22C55E]/[0.16] to-white/[0.05]",
  "opening-soon": "border-[#FBBF24]/40 bg-gradient-to-b from-[#F59E0B]/[0.12] to-white/[0.05]",
  closed: "border-white/[0.14] bg-white/[0.05]",
};
const RICH_DOT: Record<OpenState, string> = {
  open: "bg-[#4ADE80]",
  "opening-soon": "bg-[#FBBF24]",
  closed: "bg-white/40",
};
const RICH_BADGE: Record<OpenState, string> = {
  open: "bg-[#4ADE80]/20 text-[#86EFAC]",
  "opening-soon": "bg-[#FBBF24]/[0.18] text-[#FCD34D]",
  closed: "bg-white/10 text-white/75",
};

function RichTiles({ now, leadCounts }: { now: Date | null; leadCounts: Record<string, number> }) {
  return (
    <ul className="hidden grid-cols-4 gap-3.5 wide:grid">
      {US_TIME_ZONES.map((zone) => {
        const day = now ? zoneDay(now, zone.id) : null;
        const state: OpenState = day?.state ?? "closed";
        const PhaseIcon = day?.phase === "day" ? IconSun : day?.phase === "dawn" ? IconSunrise : IconMoon;
        const leads = leadCounts[zone.id] ?? 0;
        return (
          <li key={zone.id} className={`flex flex-col gap-2.5 rounded-[14px] border p-4 backdrop-blur-md ${RICH_TILE[state]}`}>
            <span className="flex items-center justify-between text-[13px] text-white/80">
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${RICH_DOT[state]}`} aria-hidden />
                {zone.label}
              </span>
              <PhaseIcon size={17} stroke={1.75} aria-hidden className="text-white/70" />
            </span>
            <span className="num whitespace-nowrap text-white">
              <span className="text-[26px] font-bold leading-none tracking-tight">
                {now ? fmtTimeInZone(now, zone.id).replace(/\s?[AP]M$/i, "") : "\u2014:\u2014"}
              </span>
              <span className="ml-1.5 text-sm text-white/65">
                {now ? `${fmtTimeInZone(now, zone.id).match(/[AP]M$/i)?.[0] ?? ""} · ${zoneAbbr(now, zone.id)}` : ""}
              </span>
            </span>
            {/* 9 to 5, and where the day is: filled to now while open. */}
            <span className="relative mt-1 block h-1.5 rounded-full bg-white/[0.14]" aria-hidden>
              {day?.progress != null && (
                <>
                  <span className="absolute inset-y-0 left-0 rounded-full bg-[#4ADE80]" style={{ width: `${day.progress * 100}%` }} />
                  <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-white" style={{ left: `${day.progress * 100}%` }} />
                </>
              )}
            </span>
            <span className="flex justify-between text-[11px] text-white/55">
              <span>9 AM</span>
              <span>5 PM</span>
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ${RICH_BADGE[state]}`}>
                {day ? day.label : "\u2014"}
              </span>
              <span className="whitespace-nowrap text-xs text-white/75">
                <b className="num font-semibold text-white">{leads}</b> {leads === 1 ? "lead" : "leads"}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// The header line on a big monitor: which zone opens next and how many leads
// are waiting there — or, while any are open, how many leads are reachable now.
export function NextOpenLine({ leadCounts = {} }: { leadCounts?: Record<string, number> }) {
  const now = useNow();
  if (!now) return <span className="text-xs text-white/60">Mon–Fri · 9–5 local</span>;
  const days = US_TIME_ZONES.map((z) => ({ zone: z, day: zoneDay(now, z.id) }));
  const open = days.filter((d) => d.day.state === "open");
  if (open.length > 0) {
    const reachable = open.reduce((n, d) => n + (leadCounts[d.zone.id] ?? 0), 0);
    return (
      <span className="text-[13px] text-white/70">
        <b className="font-semibold text-white">{open.length} of 4 open</b> · {reachable} {reachable === 1 ? "lead" : "leads"} reachable now
      </span>
    );
  }
  const next = days
    .filter((d) => d.day.minutesUntilOpen !== null)
    .sort((a, b) => a.day.minutesUntilOpen! - b.day.minutesUntilOpen!)[0];
  const waiting = next ? leadCounts[next.zone.id] ?? 0 : 0;
  return (
    <span className="text-[13px] text-white/70">
      Next to open:{" "}
      <b className="font-semibold text-white">
        {next?.zone.label} {next ? fmtUntil(next.day.minutesUntilOpen!) : ""}
      </b>{" "}
      · {waiting} {waiting === 1 ? "lead" : "leads"} waiting
    </span>
  );
}
