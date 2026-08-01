// US time zones and the formatting helpers that render a moment in one of
// them. Zones are stored as IANA ids so daylight saving is handled by Intl
// rather than by a stored offset that would go stale twice a year.

export interface UsTimeZone {
  id: string; // IANA id, what gets stored
  label: string; // how it reads in the UI
}

export const US_TIME_ZONES: UsTimeZone[] = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Los_Angeles", label: "Pacific" },
];

export const DEFAULT_TIME_ZONE = US_TIME_ZONES[0].id;

export function isUsTimeZone(id: string | null | undefined): boolean {
  return US_TIME_ZONES.some((z) => z.id === id);
}

// Falls back to the stored id for anything not in the list, so a zone set
// outside the dropdown (or a future addition) still reads sensibly.
export function zoneLabel(id: string | null | undefined): string {
  if (!id) return zoneLabel(DEFAULT_TIME_ZONE);
  return US_TIME_ZONES.find((z) => z.id === id)?.label ?? id;
}

// Passing timeZone: undefined to Intl means "the viewer's own zone", which is
// exactly what the kickoff comparison and the dashboard's local column want.
type Zone = string | undefined;

function parts(date: Date, timeZone: Zone, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(date);
}

// "3:42 PM"
export function fmtTimeInZone(date: Date, timeZone?: Zone): string {
  return parts(date, timeZone, { hour: "numeric", minute: "2-digit" });
}

// "3:42:07 PM" — used where the tick should be visible, like the world clock.
export function fmtTimeWithSecondsInZone(date: Date, timeZone?: Zone): string {
  return parts(date, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

// "Fri, Aug 1"
export function fmtDayInZone(date: Date, timeZone?: Zone): string {
  return parts(date, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// "Fri, Aug 1 · 3:42 PM"
export function fmtDateTimeInZone(date: Date, timeZone?: Zone): string {
  return `${fmtDayInZone(date, timeZone)} · ${fmtTimeInZone(date, timeZone)}`;
}

// The zone's abbreviation at that moment — "EDT" in summer, "EST" in winter.
// Derived rather than stored so it is always right for the date in hand.
export function zoneAbbr(date: Date, timeZone?: Zone): string {
  const found = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  return found?.value ?? "";
}

// True when the two zones show the same wall-clock time right now — lets the
// kickoff step say "same as yours" instead of printing the identical time
// twice.
export function sameWallClock(date: Date, a: Zone, b: Zone): boolean {
  return fmtDateTimeInZone(date, a) === fmtDateTimeInZone(date, b);
}

// ─── <input type="datetime-local"> ─────────────────────────────────────────

// A datetime-local value is wall-clock text with no zone, so it can only be
// read or written in the browser's own zone. Both helpers below are therefore
// browser-side only; the server never parses the raw input value (it stores
// the ISO instant the client component posts alongside it).

// Date → "2026-08-05T14:00" in the viewer's local zone.
export function toDateTimeLocalInput(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// "2026-08-05T14:00" in the viewer's local zone → Date, or null if incomplete.
export function fromDateTimeLocalInput(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Google Calendar ───────────────────────────────────────────────────────

// Calendar's TEMPLATE link wants a UTC range: 20260805T180000Z/20260805T183000Z
export function calendarDateRange(start: Date, minutes: number): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  return `${stamp(start)}/${stamp(end)}`;
}
