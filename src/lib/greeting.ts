// The dashboard's greeting — the set of them, and which one a moment gets.
//
// Pure: no clock of its own, no React. It is handed an hour and a weekday and
// returns one of the greetings that fit them, which is what lets the server
// pick the line and the component (src/components/Greeting.tsx) stay the few
// lines that read the browser's clock.
//
// The pick is fresh on every render rather than seeded off the day. It used to
// be the latter — one greeting held for a whole day — which meant a morning
// spent refreshing the dashboard was a morning of reading the same three words
// at 32px. The quotation underneath is the line that holds all day; the
// greeting is the one that moves.

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

// One greeting for one moment, picked at random from the ones that fit it.
//
// The randomness is injected rather than reached for, so a test can pin the
// pick and the whole of the behaviour stays readable as a function of its
// arguments.
export function greetingFor(
  hour: number,
  weekday: number,
  random: () => number = Math.random,
): string {
  const fits = candidates(hour, weekday);
  const i = Math.min(fits.length - 1, Math.floor(random() * fits.length));
  return fits[i].text;
}

// Whether a greeting already on the page is one this moment could have
// produced. The server picks the greeting and the browser checks it against
// its own clock (see src/components/Greeting.tsx): a server in another zone
// can hand down "Good evening" to somebody having a morning, and this is what
// notices. A greeting that still fits is left alone, so the heading does not
// re-roll itself a second after the page settles.
export function greetingFits(
  text: string,
  hour: number,
  weekday: number,
): boolean {
  return candidates(hour, weekday).some((g) => g.text === text);
}
