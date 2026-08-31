// The dashboard's daily motivational line — the prompt behind it, the shape of
// the answer, and the quotes shown when there is no answer to be had.
//
// One short quote from a real source, chosen for the day the person is actually
// having: the KPI score against goals, the streak, whether the last fortnight
// has been quiet or busy, what day of the week it is. A line that fits a strong
// Friday is not the line for a flat Monday, and a generic one fits neither —
// which is the whole reason it is asked for rather than rotated.
//
// Pure. No database, no network, no clock beyond the situation it is handed —
// the call and the cache live in src/lib/dailyQuoteStore.ts, the same split as
// src/lib/icpAssist.ts and its action.

// ─── The day, as the model is told it ──────────────────────────────────────

export interface DailyQuoteContext {
  // "Sunday" … "Saturday". Named rather than numbered because the model reads
  // it and a 0 means nothing to it.
  weekday: string;
  // Today's Daily KPI score, 0–100, and how many of the daily goals are met.
  score: number;
  goalsMet: number;
  goalsTotal: number;
  // Consecutive days ending today on which every daily goal was met.
  streak: number;
  // The fortnight behind today, as a word: what has actually been happening,
  // rather than a table of numbers the model would have to read the mood out
  // of itself.
  trend: DailyQuoteTrend;
}

export type DailyQuoteTrend = "quiet" | "steady" | "building" | "strong";

export const DAILY_QUOTE_TREND_DAYS = 14;

// How the fortnight reads. Off the share of days in it that hit both daily
// goals, which is the same test the streak is made of — so the trend and the
// streak can never tell two different stories about the same fortnight.
export function readTrend(daysHit: number, daysCounted: number): DailyQuoteTrend {
  if (daysCounted === 0) return "quiet";
  const share = daysHit / daysCounted;
  if (share >= 0.6) return "strong";
  if (share >= 0.35) return "building";
  if (share > 0) return "steady";
  return "quiet";
}

const TREND_SENTENCES: Record<DailyQuoteTrend, string> = {
  quiet:
    "The last two weeks have been quiet — few days hit their goals. They may be discouraged, or coming back after a break.",
  steady:
    "The last two weeks have been light but not empty — the odd day hit its goals.",
  building:
    "The last two weeks have been picking up — a good share of days hit their goals.",
  strong:
    "The last two weeks have been strong — most days hit their goals. They are in a real run of form.",
};

// ─── The prompt ────────────────────────────────────────────────────────────

export const DAILY_QUOTE_SYSTEM_PROMPT = [
  "You pick one short quotation to put at the top of a working dashboard, under the greeting. One person reads it: the operator of a small marketing agency that works with chiropractic and spine clinics. They are doing daily prospecting and outreach work and tracking it against daily goals.",
  "",
  "WHAT TO PICK",
  "- A real quotation from a real source: a historical figure, a philosopher (Greek philosophy, Stoicism and the rest), a religious text (the Quran, the Bible, the Dhammapada, and so on), or a well-known modern figure. Attribute it accurately.",
  "- It must fit the situation described below specifically. A quote about patience through a lean stretch is right for a quiet fortnight and wrong for a strong one; a quote about not being satisfied with a good run is right for a streak and wrong for a flat Monday.",
  "- Never invent a quotation and never attribute a real one to the wrong person. If you are not certain of the wording or the source, pick something you are certain of.",
  "- 20 words maximum, and shorter is better. It sits on one line.",
  "- Plain and grounded. No emoji, no hashtags, no exclamation marks, no coaching-slogan register, no addressing the reader by name.",
  "",
  "REPLY FORMAT",
  'Reply with json and nothing else, in exactly this shape: {"quote": "the quotation itself, without surrounding quote marks", "author": "who said or wrote it — a person, or a text and its reference"}',
].join("\n");

export function buildDailyQuotePrompt(context: DailyQuoteContext): string {
  return [
    "TODAY",
    `- Day of the week: ${context.weekday}`,
    `- Daily KPI score today: ${context.score} out of 100, with ${context.goalsMet} of ${context.goalsTotal} daily goals met so far.`,
    context.streak > 0
      ? `- Current streak: ${context.streak} consecutive ${
          context.streak === 1 ? "day" : "days"
        } hitting every daily goal.`
      : "- Current streak: none — the run of goal-hitting days is broken or has not started.",
    `- Recent activity: ${TREND_SENTENCES[context.trend]}`,
    "",
    "Pick the one quotation that fits this particular day. Reply as json.",
  ].join("\n");
}

// ─── Reading the answer ────────────────────────────────────────────────────

export interface DailyQuoteText {
  text: string;
  author: string;
}

// A ceiling on both fields. The prompt asks for one line; this is what stops a
// model that ignored it from putting a paragraph on the dashboard.
const MAX_QUOTE_CHARS = 200;
const MAX_AUTHOR_CHARS = 80;

// The model's JSON, or null if it is not the object that was asked for. Null
// rather than a throw: the caller has a fallback for exactly this, and a
// malformed quote is not worth an error page on the dashboard.
export function parseDailyQuote(content: string): DailyQuoteText | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const obj = parsed as { quote?: unknown; author?: unknown };
  if (typeof obj?.quote !== "string" || typeof obj?.author !== "string") {
    return null;
  }
  // Models like to wrap a quotation in quote marks even when told not to, and
  // the line draws its own — so they come off here rather than being asked for
  // twice.
  const text = obj.quote.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  const author = obj.author.trim().replace(/^[—–-]\s*/, "").trim();
  if (text === "" || author === "") return null;
  if (text.length > MAX_QUOTE_CHARS || author.length > MAX_AUTHOR_CHARS) {
    return null;
  }
  return { text, author };
}

// ─── The fallback ──────────────────────────────────────────────────────────

// Shown when there is no key set, or the call failed, or the answer came back
// in a shape nothing could read. General rather than fitted — that is the point
// of a fallback — and real quotations, held to the same standard the prompt
// asks for.
export const FALLBACK_DAILY_QUOTES: DailyQuoteText[] = [
  {
    text: "You have power over your mind — not outside events. Realise this, and you will find strength.",
    author: "Marcus Aurelius",
  },
  {
    text: "We are what we repeatedly do. Excellence, then, is not an act but a habit.",
    author: "Will Durant, on Aristotle",
  },
  {
    text: "Indeed, with hardship comes ease.",
    author: "Quran 94:6",
  },
  {
    text: "It is not that we have a short time to live, but that we waste much of it.",
    author: "Seneca",
  },
  {
    text: "The journey of a thousand miles begins with a single step.",
    author: "Lao Tzu",
  },
  {
    text: "Nothing in the world can take the place of persistence.",
    author: "Calvin Coolidge",
  },
  {
    text: "He who has a why to live can bear almost any how.",
    author: "Friedrich Nietzsche",
  },
  {
    text: "The best time to plant a tree was twenty years ago. The second best time is now.",
    author: "Chinese proverb",
  },
];

// Which fallback, for a given day. Seeded off the day so it is stable through
// the day and different tomorrow, the same way the greeting beside it is.
export function fallbackDailyQuote(dayKey: string): DailyQuoteText {
  let hash = 0;
  for (const ch of dayKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_DAILY_QUOTES[hash % FALLBACK_DAILY_QUOTES.length];
}
