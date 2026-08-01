"use client";

// Live clocks. Both pieces render a dash placeholder on the server and on the
// first client render, then start ticking from an effect — the current time is
// not knowable at render time, and rendering it directly would mismatch on
// hydration.

import { useEffect, useState } from "react";
import {
  US_TIME_ZONES,
  fmtDateTimeInZone,
  fmtDayInZone,
  fmtTimeInZone,
  fmtTimeWithSecondsInZone,
  sameWallClock,
  zoneAbbr,
  zoneLabel,
} from "@/lib/timezones";
import { fmtDateTime } from "@/lib/format";
import Icon from "@/components/Icons";

// Ticks every second so the minute never lags behind by more than that.
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// The client's current local time, sized and shaped like a status pill so it
// sits beside one without arguing with it.
export function LocalTimeBadge({
  timeZone,
  className = "",
}: {
  timeZone: string;
  className?: string;
}) {
  const now = useNow();
  return (
    <span
      title={`Local time for this client — ${zoneLabel(timeZone)} (${timeZone})`}
      className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-wash px-2.5 text-xs font-medium text-muted ${className}`}
    >
      <Icon name="clock" className="h-3 w-3" />
      <span className="num text-ink">
        {now ? fmtTimeInZone(now, timeZone) : "—:—"}
      </span>
      <span>{now ? zoneAbbr(now, timeZone) : zoneLabel(timeZone)}</span>
    </span>
  );
}

// A stored instant printed in the viewer's own zone. Only the browser knows
// what that zone is, so the server renders a placeholder and the real value
// arrives on mount — the same deal as the clocks above.
export function LocalDateTime({
  at,
  className = "",
}: {
  at: string; // ISO instant
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <span className={`num ${className}`}>
      {mounted ? fmtDateTime(new Date(at)) : "—"}
    </span>
  );
}

// A scheduled instant read out in both zones. Which zone the viewer is in is
// only knowable in the browser, so this waits for mount like the clocks do.
export function KickoffTime({
  at,
  timeZone,
}: {
  at: string; // ISO instant
  timeZone: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="num text-muted">—</span>;

  const when = new Date(at);
  const yours = `${fmtDateTimeInZone(when)} ${zoneAbbr(when)}`;
  return (
    <span className="num">
      {yours}
      <span className="text-muted">
        {sameWallClock(when, undefined, timeZone)
          ? " · same for the client"
          : ` · ${fmtTimeInZone(when, timeZone)} ${zoneAbbr(when, timeZone)} for the client`}
      </span>
    </span>
  );
}

// Dashboard strip: one tile per US zone, with the viewer's own zone marked so
// the row reads as a comparison rather than four unrelated numbers.
export function WorldClock() {
  const now = useNow();
  const localAbbr = now ? zoneAbbr(now) : null;
  return (
    <div className="card flex divide-x divide-line">
      {US_TIME_ZONES.map((zone) => {
        const abbr = now ? zoneAbbr(now, zone.id) : "";
        const isYours = localAbbr !== null && abbr === localAbbr;
        return (
          <div
            key={zone.id}
            className={`min-w-0 flex-1 px-5 py-4 ${isYours ? "bg-accent/[0.04]" : ""}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium tracking-[0.02em] text-muted">
                {zone.label}
              </span>
              <span className="num shrink-0 text-[11px] text-muted">
                {isYours ? "you" : abbr}
              </span>
            </div>
            <div className="num mt-2 text-xl font-semibold leading-none tracking-tight">
              {now ? fmtTimeWithSecondsInZone(now, zone.id) : "—:—:—"}
            </div>
            <div className="mt-2 truncate text-xs text-muted">
              {now ? fmtDayInZone(now, zone.id) : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
