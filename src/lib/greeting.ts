// The dashboard's greeting — the set of them, and which one a moment gets.
//
// Pure: no clock of its own, no React. It is handed an hour, a weekday and a
// day-seed and returns a string, which is what lets the server render the same
// greeting the browser will settle on and the component
// (src/components/Greeting.tsx) stay the four lines that read the clock.

// When a variant is allowed to come up. Most are anytime; the ones that name a
// part of the day only appear in it, and the one that names Sunday only on a
// Sunday. Written as a predicate over the local hour and weekday rather than as
// separate lists per slot, so adding a line is adding a line.
interface GreetingVariant {
  text: string;
  when?: (hour: number, weekday: number) => boolean;
}

const MORNING = (h: number) => h >= 5 && h < 12;
const AFTERNOON = (h: number) => h >= 12 && h < 17;
const EVENING = (h: number) => h >= 17 && h < 22;
const LATE = (h: number) => h >= 22 || h < 5;

// The set. Plain and casual, and deliberately not all about the clock — half
// of them are just an acknowledgement that you have sat down.
const GREETINGS: GreetingVariant[] = [
  { text: "Good morning", when: (h) => MORNING(h) },
  { text: "Morning", when: (h) => MORNING(h) },
  { text: "Early start", when: (h) => h >= 5 && h < 8 },
  { text: "Good afternoon", when: (h) => AFTERNOON(h) },
  { text: "Afternoon", when: (h) => AFTERNOON(h) },
  { text: "Evening", when: (h) => EVENING(h) },
  { text: "Good evening", when: (h) => EVENING(h) },
  { text: "Late session", when: (h) => LATE(h) || h >= 21 },
  { text: "Burning the midnight oil", when: (h) => LATE(h) },
  // 0 is Sunday, 6 Saturday — the two that get named.
  { text: "Sunday grind", when: (_h, d) => d === 0 },
  { text: "Weekend shift", when: (_h, d) => d === 0 || d === 6 },
  { text: "Monday reset", when: (_h, d) => d === 1 },
  { text: "Back at it" },
  { text: "Here we go" },
  { text: "Let’s get to work" },
  { text: "Round two" },
  { text: "Good to see you" },
];

// Every variant that fits the moment. Never empty: the unconditional ones are
// always in it, which is what makes the pick below safe without a fallback.
function candidates(hour: number, weekday: number): GreetingVariant[] {
  return GREETINGS.filter((g) => !g.when || g.when(hour, weekday));
}

// The greeting for one moment and one day-seed. Exported because it is the
// whole of the behaviour and is worth being readable on its own.
export function greetingFor(
  hour: number,
  weekday: number,
  seed: number,
): string {
  const fits = candidates(hour, weekday);
  // A cheap integer hash of the day, so consecutive days land in unrelated
  // places in the list rather than walking down it one line at a time.
  const scrambled = Math.abs(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b));
  return fits[scrambled % fits.length].text;
}

// The day a date falls on, as a plain integer — the seed. Days apart by one are
// integers apart by one, which is all the hash above needs.
export function daySeed(d: Date): number {
  return Math.floor(
    (d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000,
  );
}
