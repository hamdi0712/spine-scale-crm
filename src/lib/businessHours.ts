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
