// Monk Mode's daily line — the prompt behind it, and the quotes shown when
// there is no answer to be had.
//
// The same mechanism as the dashboard's quote (src/lib/dailyQuote.ts): one
// short quotation from a real source, asked for once a day, cached under the
// day, with a hardcoded set behind it. What differs is the question. The
// dashboard's line is about a day of prospecting against a set of KPI goals;
// this one is about a day of personal discipline, and the situation it is
// handed is the challenge — which day of it, what the streak is doing, and
// whether yesterday held.
//
// The two caches are separate tables on purpose. Sharing one would mean
// whichever page was opened first each morning decided which of the two
// questions got asked, and the other page spent the day on somebody else's
// quote.
//
// Pure. The call and the cache live in src/lib/monkModeQuoteStore.ts.

import { MAX_QUOTE_WORDS, capQuote } from "@/lib/dailyQuote";

export { MAX_QUOTE_WORDS };

// ─── The day, as the model is told it ──────────────────────────────────────

export interface MonkQuoteContext {
  // Which day of the challenge, out of how many.
  day: number;
  total: number;
  // Consecutive days ending today on which every habit hit its target.
  streak: number;
  // How the challenge has gone so far, as a word rather than a table — the
  // same reasoning dailyQuote's trend uses.
  trend: MonkQuoteTrend;
  // Whether yesterday was a clean sweep. The single most specific fact about
  // the morning somebody is having, and the one a fitted line hangs off.
  yesterdayComplete: boolean | null;
  // The lines already used, newest first, so a near-identical day does not
  // pull the same famous quotation back out every morning.
  recent: string[];
}

export type MonkQuoteTrend = "starting" | "slipping" | "holding" | "locked";

const TREND_SENTENCES: Record<MonkQuoteTrend, string> = {
  starting:
    "The challenge has only just begun — there is not much of a record yet, just a decision.",
  slipping:
    "It has been going badly. Most days so far have been left half done or missed.",
  holding:
    "It is holding together. A good share of the days have been complete, with some slippage.",
  locked:
    "It is going very well. Almost every day so far has been a clean sweep of every habit.",
};

// How the run reads, off the share of decided habit-days that were completed.
// The first two days are "starting" whatever the share is: a 0% on day one is
// one missed morning, not a pattern, and a line about a failing run would be
// wrong about the person's actual situation.
export function readMonkTrend(pct: number, dayNumber: number): MonkQuoteTrend {
  if (dayNumber <= 2) return "starting";
  if (pct >= 85) return "locked";
  if (pct >= 55) return "holding";
  return "slipping";
}

// ─── The prompt ────────────────────────────────────────────────────────────

export const MONK_QUOTE_SYSTEM_PROMPT = [
  "You pick one short quotation to put at the top of a personal discipline tracker. One person reads it: a young Muslim man running a 21-day challenge of daily non-negotiable habits — prayer, Quran, exercise, meditation, work on his business, and abstaining from what he has decided to abstain from. This is about self-mastery, not about his job.",
  "",
  "WHAT TO PICK",
  "- A real quotation from a real source: a philosopher (Stoicism, Greek philosophy and the rest), a religious text (the Quran, the hadith, the Bible, the Dhammapada, and so on), a historical figure, or a well-known modern one. Attribute it accurately.",
  "- It must fit the situation described below specifically. A line about beginning is right for day one and wrong for day nineteen; a line about getting back up is right after a broken streak and wrong in the middle of an unbroken one; a line about not easing off is right for a long clean run.",
  "- Islamic sources are welcome and appropriate here, but do not make every answer one — range across traditions and centuries.",
  "- Never invent a quotation and never attribute a real one to the wrong person. If you are not certain of the wording or the source, pick something you are certain of.",
  "- If a list of recent quotations is given below, pick something different from every one of them.",
  `- ${MAX_QUOTE_WORDS} words maximum, and shorter is better. It goes on a banner, not on a page.`,
  "- Plain and grounded. No emoji, no hashtags, no exclamation marks, no coaching-slogan register, no addressing the reader by name.",
  "",
  "REPLY FORMAT",
  'Reply with json and nothing else, in exactly this shape: {"quote": "the quotation itself, without surrounding quote marks", "author": "who said or wrote it — a person, or a text and its reference"}',
].join("\n");

export function buildMonkQuotePrompt(context: MonkQuoteContext): string {
  return [
    "TODAY",
    `- Day ${context.day} of a ${context.total}-day challenge.`,
    context.streak > 0
      ? `- Current streak: ${context.streak} consecutive ${
          context.streak === 1 ? "day" : "days"
        } with every single habit completed.`
      : "- Current streak: none — the run of complete days is broken, or has not started yet.",
    context.yesterdayComplete === null
      ? "- Yesterday: there was no yesterday — this is the first day."
      : context.yesterdayComplete
        ? "- Yesterday: every habit was completed."
        : "- Yesterday: not every habit was completed.",
    `- How it has gone: ${TREND_SENTENCES[context.trend]}`,
    "",
    ...(context.recent.length > 0
      ? [
          "ALREADY USED — DO NOT REPEAT ANY OF THESE",
          ...context.recent.map((q) => `- ${q}`),
          "",
        ]
      : []),
    "Pick the one quotation that fits this particular day of this particular challenge. Reply as json.",
  ].join("\n");
}

// ─── Reading the answer ────────────────────────────────────────────────────

export interface MonkQuoteText {
  text: string;
  author: string;
}

const MAX_AUTHOR_CHARS = 80;

// The model's JSON, or null if it is not the object that was asked for. The
// same parse the dashboard's line uses, down to stripping the quote marks a
// model adds however firmly it is told not to — the banner draws its own.
export function parseMonkQuote(content: string): MonkQuoteText | null {
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
  const text = obj.quote.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  const author = obj.author.trim().replace(/^[—–-]\s*/, "").trim();
  if (text === "" || author === "") return null;
  if (author.length > MAX_AUTHOR_CHARS) return null;
  return { text: capQuote(text), author };
}

// ─── The fallback ──────────────────────────────────────────────────────────

// Shown when there is no key set, or the call failed, or the answer came back
// in a shape nothing could read. A different set from the dashboard's: these
// are about discipline and the self rather than about work and persistence,
// which is the whole reason this feature asks its own question.
export const FALLBACK_MONK_QUOTES: MonkQuoteText[] = [
  {
    text: "No man is free who is not master of himself.",
    author: "Epictetus",
  },
  {
    text: "Indeed, Allah will not change the condition of a people until they change what is in themselves.",
    author: "Quran 13:11",
  },
  {
    text: "Discipline is the bridge between goals and accomplishment.",
    author: "Jim Rohn",
  },
  {
    text: "The strong man is not the good wrestler; the strong man is the one who controls himself when angry.",
    author: "Prophet Muhammad ﷺ, Sahih al-Bukhari",
  },
  {
    text: "You have power over your mind — not outside events. Realise this, and you will find strength.",
    author: "Marcus Aurelius",
  },
  {
    text: "We are what we repeatedly do. Excellence, then, is not an act but a habit.",
    author: "Will Durant, on Aristotle",
  },
  {
    text: "Conquer yourself rather than the world.",
    author: "René Descartes",
  },
  {
    text: "Though he should conquer a thousand men, he who conquers himself is the greater warrior.",
    author: "The Dhammapada",
  },
  {
    text: "It is not that we have a short time to live, but that we waste much of it.",
    author: "Seneca",
  },
  {
    text: "Endurance is patience concentrated.",
    author: "Thomas Carlyle",
  },
];

// Which fallback, for a given day. Seeded off the day so it is stable through
// the day and different tomorrow — the same rule the generated quote follows.
// Offset from the dashboard's hash so the two fallbacks do not land on the
// same index on the same morning: they share two of their quotations, and the
// one day they would both be shown is the day everything is failing.
export function fallbackMonkQuote(dayKey: string): MonkQuoteText {
  let hash = 7;
  for (const ch of dayKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_MONK_QUOTES[hash % FALLBACK_MONK_QUOTES.length];
}
