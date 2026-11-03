// Whether a US time zone is inside typical business hours right now.
//
// 9–5 local, Monday to Friday. That is a convention, not a measurement — it is
// what "business hours" means for a clinic, and it is stated here once so the
// dashboard strip never has to guess. Nothing in here recommends a time to
// call: which hour actually converts is a question the reporting data has not
// answered yet, and a made-up answer would read like a real one.

export const BUSINESS_OPEN_HOUR = 9;
export const BUSINESS_CLOSE_HOUR = 17;

// How far ahead an upcoming open is worth flagging, in hours.
const OPENING_SOON_HOURS = 3;

// Minutes as the badge says them: whole hours while there is more than an hour
// to go, and a live minute countdown inside the last one.
//
// The countdown is not decoration. "Opening within the hour" was the old
// wording for that last stretch, and it had two things wrong with it: it was
// the longest string any badge could hold — long enough to overflow a tile a
// quarter of the dashboard wide — and it said the same thing for fifty-nine
// minutes running. "Opening in 12m" is shorter than the tile, and it moves.
//
// Exactly an hour reads as "1h" rather than "60m", which is where the two
// halves meet without either repeating the other.
function untilLabel(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  return `${minutes}m`;
}

export type OpenState = "open" | "opening-soon" | "closed";

export interface BusinessHours {
  state: OpenState;
  label: string; // what the badge reads
}

// The hour and weekday it is in a given zone, read off Intl rather than
// arithmetic on the offset — daylight saving is then handled for us.
function zoneParts(date: Date, timeZone: string): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    // hourCycle h23 can render midnight as "24" — fold it back to 0.
    hour: Number(value("hour")) % 24,
    minute: Number(value("minute")),
    weekday: Math.max(0, days.indexOf(value("weekday"))),
  };
}

export function businessHours(date: Date, timeZone: string): BusinessHours {
  const { hour, minute, weekday } = zoneParts(date, timeZone);
  const isWeekday = weekday >= 1 && weekday <= 5;

  if (isWeekday && hour >= BUSINESS_OPEN_HOUR && hour < BUSINESS_CLOSE_HOUR) {
    const minutesLeft = (BUSINESS_CLOSE_HOUR - hour) * 60 - minute;
    // The same countdown on the way out as on the way in — the last hour of a
    // working day is worth knowing the size of, and "Closing in 1h" said that
    // it was an hour for the whole of it.
    return {
      state: "open",
      label: minutesLeft <= 60 ? `Closing in ${untilLabel(minutesLeft)}` : "Open",
    };
  }

  // Before opening on a working day: say how long the wait is, but only when
  // it is short enough to be worth waiting for.
  if (isWeekday && hour < BUSINESS_OPEN_HOUR) {
    const minutesUntil = (BUSINESS_OPEN_HOUR - hour) * 60 - minute;
    if (minutesUntil <= OPENING_SOON_HOURS * 60) {
      return {
        state: "opening-soon",
        label: `Opening in ${untilLabel(minutesUntil)}`,
      };
    }
  }

  return { state: "closed", label: isWeekday ? "Closed" : "Weekend" };
}

// ─── The big-monitor tiles ─────────────────────────────────────────────────

// What the wide Dashboard's richer tile says about a zone: how far through
// its working day it is, exactly how long is left or how long until it opens,
// and whether it is day, the hour before opening, or night there.
export interface ZoneDay {
  state: OpenState;
  // 0–1 through 9–5 while open; null otherwise.
  progress: number | null;
  // "Open · 5h 18m left", "Opens in 18m", "Opens in 2h 18m", "Opens Monday".
  label: string;
  // Minutes until it next opens: for the "next to open" line. Null while open.
  minutesUntilOpen: number | null;
  phase: "day" | "dawn" | "night";
}

// "5h 18m", "18m".
function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}

// Inside the hour before opening it is "opening soon" here — amber — and
// further out it is simply closed with a countdown.
const OPENING_SOON_MINUTES = 60;

export function zoneDay(date: Date, timeZone: string): ZoneDay {
  const { hour, minute, weekday } = zoneParts(date, timeZone);
  const now = hour * 60 + minute;
  const open = BUSINESS_OPEN_HOUR * 60;
  const close = BUSINESS_CLOSE_HOUR * 60;
  const isWeekday = weekday >= 1 && weekday <= 5;

  if (isWeekday && now >= open && now < close) {
    return {
      state: "open",
      progress: (now - open) / (close - open),
      label: `Open · ${hm(close - now)} left`,
      minutesUntilOpen: null,
      phase: "day",
    };
  }

  // Minutes until the next 9 AM on a weekday: today's, if it is still ahead
  // on a weekday, else the next weekday's.
  let days = 0;
  let wd = weekday;
  if (!(isWeekday && now < open)) {
    do {
      days++;
      wd = (wd + 1) % 7;
    } while (wd === 0 || wd === 6);
  }
  const until = days * 24 * 60 + open - now;
  const soon = until <= OPENING_SOON_MINUTES;
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return {
    state: soon ? "opening-soon" : "closed",
    progress: null,
    label: until < 24 * 60 ? `Opens in ${hm(until)}` : `Opens ${names[wd]}`,
    minutesUntilOpen: until,
    phase: soon ? "dawn" : "night",
  };
}

export function fmtUntil(minutes: number): string {
  return minutes < 24 * 60 ? `in ${hm(minutes)}` : `in ${Math.round(minutes / 60 / 24)}d`;
}
