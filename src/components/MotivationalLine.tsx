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

import { loadDailyQuote } from "@/lib/dailyQuoteStore";
import { fallbackDailyQuote } from "@/lib/dailyQuote";
import { dayKey } from "@/lib/dailyChecklist";

export default async function MotivationalLine() {
  const quote = await loadDailyQuote(new Date());
  return (
    <p className="mt-1.5 text-sm text-muted">
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
  const quote = fallbackDailyQuote(dayKey(new Date()));
  return (
    <p className="mt-1.5 text-sm text-muted">
      {quote.text} <span className="opacity-70">— {quote.author}</span>
    </p>
  );
}
