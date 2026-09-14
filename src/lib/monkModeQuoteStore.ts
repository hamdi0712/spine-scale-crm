// Monk Mode's line for today: read the cache, or ask once and cache it.
//
// The same shape as src/lib/dailyQuoteStore.ts, against its own table and its
// own question — see the head of src/lib/monkModeQuote.ts for why the two are
// separate rather than one cache serving both banners.
//
// Server-only and deliberately not a "use server" module. Never throws and
// never shows an error: there is always a line — the cached one, the one just
// fetched, or one of the fallbacks.

import { prisma } from "@/lib/prisma";
import { deepSeekJson } from "@/lib/deepseek";
import {
  MonkChallenge,
  MonkHabit,
  MonkProgressMap,
  addDays,
  challengeProgress,
  dayIsComplete,
  dayKey,
  monkStreaks,
  monkTally,
  readMonkDay,
  toChecklistDay,
} from "@/lib/monkMode";
import {
  MONK_QUOTE_SYSTEM_PROMPT,
  MonkQuoteContext,
  MonkQuoteText,
  buildMonkQuotePrompt,
  fallbackMonkQuote,
  parseMonkQuote,
  readMonkTrend,
} from "@/lib/monkModeQuote";

// One line is a short answer. A ceiling against a runaway generation, not a
// target.
const MAX_QUOTE_TOKENS = 200;

// Shorter than the app's default minute: this is a line of decoration on a
// banner with a fallback ready the moment it gives up.
const QUOTE_TIMEOUT_MS = 12_000;

// Above the transport's default of zero, and for the reason dailyQuoteStore
// gives at length: at temperature 0 two similar days produce the same famous
// line, each dutifully cached under its own day.
const QUOTE_TEMPERATURE = 1;

const RECENT_QUOTE_DAYS = 30;

export interface MonkQuoteResult extends MonkQuoteText {
  source: MonkQuoteSource;
  day: string;
  cachedAt?: Date;
}

// "model" is a line asked for and stored under today. "cached" is that same
// line read back later the same day. "fallback" is one of the hardcoded ones,
// shown because there was no key, no answer, or no answer anything could read.
export type MonkQuoteSource = "model" | "cached" | "fallback";

export async function loadMonkQuote({
  now,
  challenge,
  habits,
  progress,
}: {
  now: Date;
  challenge: MonkChallenge;
  habits: MonkHabit[];
  progress: MonkProgressMap;
}): Promise<MonkQuoteResult> {
  // The calendar day the person reading the banner is having, which is the
  // server's own — the same reading the habits themselves are filed under.
  const key = dayKey(toChecklistDay(now));

  const cached = await prisma.monkModeQuote.findUnique({ where: { id: key } });
  if (cached) {
    return {
      text: cached.text,
      author: cached.author,
      source: "cached",
      day: key,
      cachedAt: cached.createdAt,
    };
  }

  const fallback = {
    ...fallbackMonkQuote(key),
    source: "fallback" as const,
    day: key,
  };

  // A challenge with no habits in it has no situation to describe, and a
  // generic question would get the generic answer the fallback already is.
  if (habits.length === 0) return fallback;

  const recent = await recentQuotes(key);
  const context = buildContext({ now, challenge, habits, progress, recent });

  const reply = await deepSeekJson({
    system: MONK_QUOTE_SYSTEM_PROMPT,
    user: buildMonkQuotePrompt(context),
    maxTokens: MAX_QUOTE_TOKENS,
    timeoutMs: QUOTE_TIMEOUT_MS,
    temperature: QUOTE_TEMPERATURE,
  });
  if (!reply.ok) return fallback;

  const quote = parseMonkQuote(reply.content);
  if (!quote) return fallback;

  try {
    // An upsert rather than a create: two tabs opening the page on the same
    // morning both miss the cache and both ask, and the second write should
    // settle rather than throw on the primary key.
    await prisma.monkModeQuote.upsert({
      where: { id: key },
      create: { id: key, text: quote.text, author: quote.author },
      update: {},
    });
  } catch {
    // Storing it failed, which costs a call tomorrow morning and nothing else.
  }

  return { ...quote, source: "model", day: key };
}

// The lines behind today, newest first. The ids are day keys in ISO order, so
// "the days before today" is a string comparison and the newest is the
// largest. A read that fails comes back empty rather than throwing.
async function recentQuotes(today: string): Promise<string[]> {
  try {
    const rows = await prisma.monkModeQuote.findMany({
      where: { id: { lt: today } },
      orderBy: { id: "desc" },
      take: RECENT_QUOTE_DAYS,
      select: { text: true },
    });
    return rows.map((r) => r.text);
  } catch {
    return [];
  }
}

// The day as the model is told it, off the same readings the panels on the
// page are drawn from — so the line and the dashboard it sits on are talking
// about one challenge.
function buildContext({
  now,
  challenge,
  habits,
  progress,
  recent,
}: {
  now: Date;
  challenge: MonkChallenge;
  habits: MonkHabit[];
  progress: MonkProgressMap;
  recent: string[];
}): MonkQuoteContext {
  const shape = challengeProgress(challenge, now);
  const tally = monkTally(challenge, habits, progress, now);
  const streaks = monkStreaks(challenge, habits, progress, now);

  // Yesterday, unless today is the first day — in which case there is no
  // yesterday inside the challenge and the prompt says so rather than
  // reporting a day before the start as a failure.
  const yesterday = addDays(toChecklistDay(now), -1);
  const yesterdayComplete =
    shape.day <= 1
      ? null
      : dayIsComplete(readMonkDay(habits, progress, yesterday, now));

  return {
    day: shape.day,
    total: shape.total,
    streak: streaks.current,
    trend: readMonkTrend(tally.pct, shape.day),
    yesterdayComplete,
    recent,
  };
}
