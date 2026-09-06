// Today's motivational line: read the cache, or ask once and cache it.
//
// Server-only and deliberately not a "use server" module, the same way
// dailyChecklistStore and dailyKpiStore are: the dashboard reads through it on
// its way past, and nothing in the browser may call it.
//
// The cache is one row per day keyed by the day itself (DailyQuote in
// prisma/schema.prisma), so the model is asked once a day at most however many
// times the dashboard is loaded. A day whose call failed writes nothing, which
// is what lets a fallback show now and the real line arrive on the next load
// once the key is set — caching a failure would hold the dashboard on its
// fallback until midnight.
//
// This never throws and never shows an error. There is always a line: the
// cached one, the one just fetched, or one of the fallbacks.

import { prisma } from "@/lib/prisma";
import {
  dayKey as toDayKey,
  toChecklistDay,
} from "@/lib/dailyChecklist";
import {
  DAILY_GOAL_KEYS,
  allGoalsMet,
  dailyScore,
  goalMet,
  streakLength,
  toUtcDay,
} from "@/lib/dailyKpi";
import { loadDailyKpiGoals, loadDailyKpiRange } from "@/lib/dailyKpiStore";
import { deepSeekJson } from "@/lib/deepseek";
import {
  DAILY_QUOTE_SYSTEM_PROMPT,
  DAILY_QUOTE_TREND_DAYS,
  DailyQuoteContext,
  DailyQuoteText,
  buildDailyQuotePrompt,
  fallbackDailyQuote,
  parseDailyQuote,
  readTrend,
} from "@/lib/dailyQuote";

// One line is a short answer. This is a ceiling against a runaway generation,
// not a target.
const MAX_QUOTE_TOKENS = 200;

// Shorter than the app's default minute, and deliberately: this renders a line
// of decoration rather than answering a press, and it has a fallback ready the
// moment it gives up. A dashboard should not sit on a spinner for a quotation.
const QUOTE_TIMEOUT_MS = 12_000;

// Above the transport's default of zero, and this is the whole reason the
// quote rotates.
//
// At temperature 0 the model is a function of its prompt, and the prompt for a
// Tuesday and the prompt for a Wednesday differ by one word when the numbers
// underneath have not moved — so it returned the same famous line morning
// after morning, each one duly cached under its own day. The cache was doing
// exactly what it was told; there was simply nothing new to cache. This, plus
// the list of recent quotations in the prompt, is what makes tomorrow's answer
// a different one.
const QUOTE_TEMPERATURE = 1;

// How many days back the "do not repeat these" list reaches.
const RECENT_QUOTE_DAYS = 30;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface DailyQuoteResult extends DailyQuoteText {
  // Whether this is the model's line for today or one of the hardcoded ones.
  // Nothing is drawn differently for it — the dashboard shows a quote either
  // way — but it is the difference the copilot and anybody debugging want, and
  // the line carries it into the markup as a data attribute so "is today's
  // quote real or is it the fallback again" is a question you can answer by
  // looking rather than by reading the server log.
  source: DailyQuoteSource;
  // The day it is filed under, "2026-09-06" — the cache key itself. In the
  // markup beside the source, because the other half of a stuck quote is a day
  // key that is not moving, and this makes that visible too.
  day: string;
  // When the cached row was written, for a quote that came from the cache.
  // Absent for a fallback, which is never stored, and for a quote generated on
  // this very request.
  cachedAt?: Date;
}

// "model" is a line this app asked a model for and stored under today. "cached"
// is that same line read back later the same day — the ordinary case, and the
// one that proves the cache is holding rather than the generator repeating.
// "fallback" is one of the hardcoded quotations, shown because there was no key,
// no answer, or no answer anything could read.
export type DailyQuoteSource = "model" | "cached" | "fallback";

export async function loadDailyQuote(now: Date): Promise<DailyQuoteResult> {
  // The calendar day the person reading the dashboard is having, which is the
  // server's own — the same reading the checklist and the activities page file
  // a day under (toChecklistDay). Deliberately not toUtcDay: read in UTC, "the
  // day" rolls over at 8am for anyone east of Greenwich, so a quote billed as
  // daily would change in the middle of a working morning and hold through the
  // evening and the night that followed. The KPI numbers below stay on their
  // own UTC bucketing, because they are the same numbers the /daily-kpi page
  // shows and the two must agree.
  const key = toDayKey(toChecklistDay(now));
  const kpiDay = toUtcDay(now);

  const cached = await prisma.dailyQuote.findUnique({ where: { id: key } });
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
    ...fallbackDailyQuote(key),
    source: "fallback" as const,
    day: key,
  };

  const recent = await recentQuotes(key);

  let context: DailyQuoteContext;
  try {
    context = await buildContext(kpiDay, recent);
  } catch {
    // The situation could not be read, so there is nothing specific to ask
    // about — and a generic question would get the generic answer the fallback
    // already is.
    return fallback;
  }

  const reply = await deepSeekJson({
    system: DAILY_QUOTE_SYSTEM_PROMPT,
    user: buildDailyQuotePrompt(context),
    maxTokens: MAX_QUOTE_TOKENS,
    timeoutMs: QUOTE_TIMEOUT_MS,
    temperature: QUOTE_TEMPERATURE,
  });
  if (!reply.ok) return fallback;

  const quote = parseDailyQuote(reply.content);
  if (!quote) return fallback;

  try {
    // An upsert rather than a create: two tabs opening the dashboard on the
    // same morning both miss the cache and both ask, and the second write
    // should settle rather than throw on the primary key.
    await prisma.dailyQuote.upsert({
      where: { id: key },
      create: { id: key, text: quote.text, author: quote.author },
      update: {},
    });
  } catch {
    // Storing it failed, which costs a call tomorrow morning and nothing else.
    // The line itself is already in hand.
  }

  return { ...quote, source: "model", day: key };
}

// The quotations behind today, newest first, for the "do not repeat these"
// block in the prompt. A read that fails comes back empty rather than throwing:
// a missing list makes tomorrow's line likelier to repeat, which is worth less
// than the line itself.
//
// The ids are day keys in ISO order, so "the days before today" is a string
// comparison and the newest is the largest — no dates parsed to sort them.
async function recentQuotes(today: string): Promise<string[]> {
  try {
    const rows = await prisma.dailyQuote.findMany({
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

// The day as the model is told it: the score against the daily goals, the
// streak, and how the fortnight behind today has been going. Read off the same
// Daily KPI pass the /daily-kpi page uses, so the line and the page it is
// about are talking about one set of numbers.
async function buildContext(
  day: Date,
  recent: string[],
): Promise<DailyQuoteContext> {
  const [goals, days] = await Promise.all([
    loadDailyKpiGoals(),
    loadDailyKpiRange(
      new Date(day.getTime() - (DAILY_QUOTE_TREND_DAYS - 1) * 86_400_000),
      day,
    ),
  ]);

  const today = days[days.length - 1]?.counts;
  const score = today ? dailyScore(today, goals) : 0;
  const goalsMet = today
    ? DAILY_GOAL_KEYS.filter((k) => goalMet(today[k], goals[k])).length
    : 0;

  // The streak, and the fortnight's hit rate, off the same test — see
  // allGoalsMet. Today is left out of the trend on the reasoning streakLength
  // uses for it: a day still in progress is not a day that was missed.
  const past = days.slice(0, -1);
  const daysHit = past.filter((d) => allGoalsMet(d.counts, goals)).length;
  const streak = streakLength(days, goals);

  return {
    weekday: WEEKDAYS[day.getUTCDay()],
    score,
    goalsMet,
    goalsTotal: DAILY_GOAL_KEYS.length,
    streak,
    trend: readTrend(daysHit, past.length),
    recent,
  };
}
