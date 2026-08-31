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
import { dayKey as toDayKey } from "@/lib/dailyChecklist";
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
  // way — but it is the difference the copilot and anybody debugging want.
  source: "model" | "fallback";
}

export async function loadDailyQuote(now: Date): Promise<DailyQuoteResult> {
  const day = toUtcDay(now);
  const key = toDayKey(day);

  const cached = await prisma.dailyQuote.findUnique({ where: { id: key } });
  if (cached) {
    return { text: cached.text, author: cached.author, source: "model" };
  }

  const fallback = { ...fallbackDailyQuote(key), source: "fallback" as const };

  let context: DailyQuoteContext;
  try {
    context = await buildContext(day);
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

  return { ...quote, source: "model" };
}

// The day as the model is told it: the score against the daily goals, the
// streak, and how the fortnight behind today has been going. Read off the same
// Daily KPI pass the /daily-kpi page uses, so the line and the page it is
// about are talking about one set of numbers.
async function buildContext(day: Date): Promise<DailyQuoteContext> {
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
  };
}
