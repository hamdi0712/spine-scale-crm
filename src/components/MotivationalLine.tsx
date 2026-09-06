// The line under the dashboard's greeting.
//
// It replaced "Agency at a glance", which was a label for the page rather than
// anything to read twice, and it wears exactly that line's typography and
// place — same size, same muted tier, same margin — so the header is the shape
// it always was and only the sentence in it changed.
//
// The quote itself is chosen once a day by a model given the day's real
// situation and cached for the rest of it (src/lib/dailyQuoteStore.ts), with a
// hardcoded set behind it for a missing key or a failed call. There is no error
// state here on purpose: this is a line of encouragement, and a line of
// encouragement that sometimes says "DeepSeek rejected the API key" is worse
// than one that is occasionally generic.
//
// The attribution is the same size as the quote in a lighter weight rather than
// a second, smaller tier: at 13px muted there is no tier below this one, and
// the em dash is what separates them anyway.
//
// It wraps rather than clips. A quotation is capped at twenty words where it is
// generated (capQuote in src/lib/dailyQuote.ts), so what arrives here is one
// short sentence — but "short" is a word count and the container is a number of
// pixels, and on a narrow screen even a short sentence is three lines. So this
// is a paragraph that flows: no truncation, no fixed height, a line-height with
// room in it, and a wrapping rule that breaks a pathological unbroken string
// rather than letting it run out of the column.

import { loadDailyQuote } from "@/lib/dailyQuoteStore";
import { fallbackDailyQuote } from "@/lib/dailyQuote";
import { dayKey, toChecklistDay } from "@/lib/dailyChecklist";

// One class list, used by the real line and by the placeholder below, so the
// two cannot drift into different shapes and make the swap visible.
const LINE_CLASS =
  "mt-1.5 max-w-prose text-sm leading-relaxed text-pretty break-words text-muted";

export default async function MotivationalLine() {
  const quote = await loadDailyQuote(new Date());
  return (
    // The day and where the line came from, in the markup rather than on the
    // screen: "is this today's quote or the fallback again, and what day does
    // the server think it is" is then a question you answer by inspecting the
    // element. See DailyQuoteSource — "model" is freshly generated on this
    // request, "cached" is today's generated line read back, "fallback" is one
    // of the hardcoded ones.
    <p
      className={LINE_CLASS}
      data-quote-source={quote.source}
      data-quote-day={quote.day}
    >
      {quote.text} <span className="opacity-70">— {quote.author}</span>
    </p>
  );
}

// What stands in the line's place while the day's quote is being fetched — the
// first load of a new day, and only that one, since every load after it reads
// the cached row. It is a real fallback quote rather than a shimmer or a blank:
// the header should never be a hole, and a line that is replaced by another
// line of the same shape is a change nobody has to watch happen.
export function MotivationalLineFallback() {
  const day = dayKey(toChecklistDay(new Date()));
  const quote = fallbackDailyQuote(day);
  return (
    <p className={LINE_CLASS} data-quote-source="fallback" data-quote-day={day}>
      {quote.text} <span className="opacity-70">— {quote.author}</span>
    </p>
  );
}
