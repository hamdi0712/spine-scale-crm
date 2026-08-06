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

// ─── Reading a zone off a location ─────────────────────────────────────────

// Locations arrive as free text — "Austin, TX", "Portland, Oregon", "Greater
// Chicago Area" — from a CSV column or a scraped profile. This reads the US
// state out of one and reports the zone that state keeps, so an import can
// fill a zone that would otherwise be set by hand fifty times.
//
// It answers null far more readily than it guesses. A location with no state
// in it, a state that spans zones the app doesn't offer, anything ambiguous:
// null, and the field stays empty and editable. A blank zone somebody fills in
// beats a wrong one nobody notices, and the wrong one here would be quietly
// wrong — a call booked an hour out is not obviously a time zone problem.

const EASTERN = "America/New_York";
const CENTRAL = "America/Chicago";
const MOUNTAIN = "America/Denver";
const PACIFIC = "America/Los_Angeles";

interface UsState {
  abbr: string;
  name: string;
  // null where none of the four zones is a fair reading.
  zone: string | null;
}

// Every state's majority zone.
//
// Eight of them are split by a zone line — Florida, Texas, Kentucky, Indiana,
// Michigan, Tennessee, Idaho and Oregon — and each is recorded as the zone most
// of its people live in. That is wrong in the Florida panhandle and in eastern
// Oregon, and being wrong there is the accepted cost of being right in Miami
// and Portland. Kansas, Nebraska and the Dakotas are split the same way across
// a thinner slice and are treated the same.
//
// Arizona keeps Mountain, which is its winter reading. It does not observe
// daylight saving and America/Phoenix is not one of the four zones offered
// here, so half the year this is an hour out — still the closest of the four,
// and visible on the lead where it can be corrected.
//
// Alaska and Hawaii map to nothing at all: their zones are not in the list and
// no reading of the four is close enough to be worth writing down.
const US_STATES: UsState[] = [
  { abbr: "AL", name: "Alabama", zone: CENTRAL },
  { abbr: "AK", name: "Alaska", zone: null },
  { abbr: "AZ", name: "Arizona", zone: MOUNTAIN },
  { abbr: "AR", name: "Arkansas", zone: CENTRAL },
  { abbr: "CA", name: "California", zone: PACIFIC },
  { abbr: "CO", name: "Colorado", zone: MOUNTAIN },
  { abbr: "CT", name: "Connecticut", zone: EASTERN },
  { abbr: "DE", name: "Delaware", zone: EASTERN },
  { abbr: "DC", name: "District of Columbia", zone: EASTERN },
  { abbr: "FL", name: "Florida", zone: EASTERN },
  { abbr: "GA", name: "Georgia", zone: EASTERN },
  { abbr: "HI", name: "Hawaii", zone: null },
  { abbr: "ID", name: "Idaho", zone: MOUNTAIN },
  { abbr: "IL", name: "Illinois", zone: CENTRAL },
  { abbr: "IN", name: "Indiana", zone: EASTERN },
  { abbr: "IA", name: "Iowa", zone: CENTRAL },
  { abbr: "KS", name: "Kansas", zone: CENTRAL },
  { abbr: "KY", name: "Kentucky", zone: EASTERN },
  { abbr: "LA", name: "Louisiana", zone: CENTRAL },
  { abbr: "ME", name: "Maine", zone: EASTERN },
  { abbr: "MD", name: "Maryland", zone: EASTERN },
  { abbr: "MA", name: "Massachusetts", zone: EASTERN },
  { abbr: "MI", name: "Michigan", zone: EASTERN },
  { abbr: "MN", name: "Minnesota", zone: CENTRAL },
  { abbr: "MS", name: "Mississippi", zone: CENTRAL },
  { abbr: "MO", name: "Missouri", zone: CENTRAL },
  { abbr: "MT", name: "Montana", zone: MOUNTAIN },
  { abbr: "NE", name: "Nebraska", zone: CENTRAL },
  { abbr: "NV", name: "Nevada", zone: PACIFIC },
  { abbr: "NH", name: "New Hampshire", zone: EASTERN },
  { abbr: "NJ", name: "New Jersey", zone: EASTERN },
  { abbr: "NM", name: "New Mexico", zone: MOUNTAIN },
  { abbr: "NY", name: "New York", zone: EASTERN },
  { abbr: "NC", name: "North Carolina", zone: EASTERN },
  { abbr: "ND", name: "North Dakota", zone: CENTRAL },
  { abbr: "OH", name: "Ohio", zone: EASTERN },
  { abbr: "OK", name: "Oklahoma", zone: CENTRAL },
  { abbr: "OR", name: "Oregon", zone: PACIFIC },
  { abbr: "PA", name: "Pennsylvania", zone: EASTERN },
  { abbr: "RI", name: "Rhode Island", zone: EASTERN },
  { abbr: "SC", name: "South Carolina", zone: EASTERN },
  { abbr: "SD", name: "South Dakota", zone: CENTRAL },
  { abbr: "TN", name: "Tennessee", zone: CENTRAL },
  { abbr: "TX", name: "Texas", zone: CENTRAL },
  { abbr: "UT", name: "Utah", zone: MOUNTAIN },
  { abbr: "VT", name: "Vermont", zone: EASTERN },
  { abbr: "VA", name: "Virginia", zone: EASTERN },
  { abbr: "WA", name: "Washington", zone: PACIFIC },
  { abbr: "WV", name: "West Virginia", zone: EASTERN },
  { abbr: "WI", name: "Wisconsin", zone: CENTRAL },
  { abbr: "WY", name: "Wyoming", zone: MOUNTAIN },
];

// Longest name first, so "West Virginia" is tested before "Virginia" and
// "Indiana, Pennsylvania" reads as Pennsylvania.
const STATES_BY_NAME_LENGTH = [...US_STATES].sort(
  (a, b) => b.name.length - a.name.length,
);

const ABBR_TO_STATE = new Map(US_STATES.map((s) => [s.abbr, s]));

// "Washington, DC" is not Washington state, and it is written half a dozen
// ways. Caught before anything else, because the name that would otherwise
// match is a state on the far side of the country.
const DC_PATTERN = /\bd\.?\s?c\.?\b|\bdistrict of columbia\b/i;

export function zoneFromLocation(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return null;

  if (DC_PATTERN.test(text)) return EASTERN;

  // Spelled-out names are unambiguous, so they are read first and win over a
  // two-letter token elsewhere in the same string.
  for (const state of STATES_BY_NAME_LENGTH) {
    if (new RegExp(`\\b${state.name}\\b`, "i").test(text)) return state.zone;
  }

  // Abbreviations only where they read as one: capitalised, and after a comma
  // or standing alone. Two capital letters loose in a sentence are not a
  // state — "IN" and "OR" and "ME" are words, and "Recruiting IN Austin"
  // should not come back as Indiana.
  const abbrPattern = /,\s*([A-Z]{2})\b/g;
  let match: RegExpExecArray | null;
  while ((match = abbrPattern.exec(text)) !== null) {
    const state = ABBR_TO_STATE.get(match[1]);
    if (state) return state.zone;
  }
  const bare = ABBR_TO_STATE.get(text);
  return bare ? bare.zone : null;
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
