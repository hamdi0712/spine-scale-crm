"use client";

// Live clocks. Both pieces render a dash placeholder on the server and on the
// first client render, then start ticking from an effect — the current time is
// not knowable at render time, and rendering it directly would mismatch on
// hydration.

import { useEffect, useState } from "react";
import {
  fmtDateTimeInZone,
  fmtTimeInZone,
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

// A lead's local time, small enough to sit beside the tier badge on a queue
// card without competing with it: muted text at the same size as the rest of
// the card's meta, and the badge's height so the two share a baseline.
//
// Nothing at all when the lead has no zone stored. A dash here would be a
// second thing to read on every card that has no answer, and the queue is
// scanned rather than read — an absent element is quieter than an empty one.
export function LeadLocalTime({
  timeZone,
  className = "",
}: {
  timeZone: string | null | undefined;
  className?: string;
}) {
  const now = useNow();
  if (!timeZone) return null;
  return (
    <span
      title={`Local time for this lead — ${zoneLabel(timeZone)} (${timeZone})`}
      className={`inline-flex h-[28px] shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted ${className}`}
    >
      <Icon name="clock" className="h-3 w-3 text-muted/70" />
      <span className="num leading-none">
        {now ? fmtTimeInZone(now, timeZone) : "—:—"}
      </span>
    </span>
  );
}

// The dashboard's four-zone strip lives in BusinessHoursPanel: it needs to say
// whether each zone is inside working hours, not just what the clock reads.
