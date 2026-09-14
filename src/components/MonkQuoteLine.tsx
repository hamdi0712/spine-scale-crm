// The quotation on the Monk Mode banner.
//
// Chosen once a day by a model given the day the person is actually having —
// which day of the challenge, what the streak is doing, whether yesterday held
// — and cached for the rest of it (src/lib/monkModeQuoteStore.ts), with a
// hardcoded set behind it for a missing key or a failed call.
//
// The same mechanism as the dashboard's MotivationalLine and deliberately a
// separate cache: see the head of src/lib/monkModeQuote.ts. There is no error
// state here on purpose, for the same reason there is none there — a line of
// encouragement that sometimes says "DeepSeek rejected the API key" is worse
// than one that is occasionally generic.

import {
  MonkChallenge,
  MonkHabit,
  MonkProgressMap,
  dayKey,
  toChecklistDay,
} from "@/lib/monkMode";
import { fallbackMonkQuote } from "@/lib/monkModeQuote";
import { loadMonkQuote } from "@/lib/monkModeQuoteStore";

// One class list for the real line and the placeholder, so the two cannot
// drift into different shapes and make the swap visible.
const QUOTE_CLASS =
  "text-pretty break-words text-[15px] leading-relaxed text-white/90";

export default async function MonkQuoteLine({
  challenge,
  habits,
  progress,
  now,
}: {
  challenge: MonkChallenge;
  habits: MonkHabit[];
  progress: MonkProgressMap;
  now: Date;
}) {
  const quote = await loadMonkQuote({ now, challenge, habits, progress });
  return (
    // The day and where the line came from, in the markup rather than on the
    // screen — "is this today's quote or the fallback again" is then a question
    // you answer by inspecting the element rather than by reading a server log.
    <figure data-quote-source={quote.source} data-quote-day={quote.day}>
      <blockquote className={QUOTE_CLASS}>“{quote.text}”</blockquote>
      <figcaption className="mt-2 text-[11px] font-medium tracking-[0.12em] text-white/50">
        — {quote.author.toUpperCase()}
      </figcaption>
    </figure>
  );
}

// What stands in the line's place while the day's quote is being fetched — the
// first load of a new day, and only that one. A real fallback quote rather
// than a shimmer: a line replaced by another line of the same shape is a change
// nobody has to watch happen.
export function MonkQuoteLineFallback() {
  const day = dayKey(toChecklistDay(new Date()));
  const quote = fallbackMonkQuote(day);
  return (
    <figure data-quote-source="fallback" data-quote-day={day}>
      <blockquote className={QUOTE_CLASS}>“{quote.text}”</blockquote>
      <figcaption className="mt-2 text-[11px] font-medium tracking-[0.12em] text-white/50">
        — {quote.author.toUpperCase()}
      </figcaption>
    </figure>
  );
}
