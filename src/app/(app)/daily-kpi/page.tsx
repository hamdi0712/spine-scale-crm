import Link from "next/link";
import {
  addDays,
  dayKey as toDayKey,
  parseDayKey,
  toChecklistDay,
} from "@/lib/dailyChecklist";
import {
  DAILY_KPI_KEYS,
  DAILY_KPI_LABELS,
  DAILY_KPI_HUES,
  DAILY_KPI_TREND_DAYS,
  DailyKpiDay,
  DailyKpiKey,
  allGoalsMet,
  averageFor,
  dailyScore,
  emptyCounts,
  pctChange,
  progressPct,
  scoreNote,
  streakLength,
  sumCounts,
} from "@/lib/dailyKpi";
import { loadDailyKpiGoals, loadDailyKpiRange } from "@/lib/dailyKpiStore";
import { saveDailyKpiGoals } from "@/lib/actions/dailyKpi";
import { fmtDate } from "@/lib/format";
import DailyKpiCard from "@/components/DailyKpiCard";
import DailyKpiGoalsForm from "@/components/DailyKpiGoalsForm";
import DailyKpiTrend, { DailyKpiPoint } from "@/components/DailyKpiTrend";
import DayPicker from "@/components/DayPicker";
import Icon from "@/components/Icons";
import ProgressRing from "@/components/ProgressRing";

export const dynamic = "force-dynamic";

// How far back the page reads. Long enough for a streak worth having, short
// enough to stay one pass over a handful of indexed columns — the counts are
// all derived, so this is the only thing that bounds the work.
const HISTORY_DAYS = 90;

// The breakdown table's "last three days" columns, newest last so the row
// reads left to right into today.
const RECENT_DAYS = 3;

// Monday. The week the weekly summary totals is the one the viewed day falls
// in, which is the week a person means when they ask how the week is going.
function weekStart(day: Date): Date {
  const dow = day.getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((dow + 6) % 7));
}

// The Daily KPI tracker — four goals, one day at a time.
//
// Nothing on this page is stored as a daily total. Every number is counted off
// records that already carry the instant they happened, which is what makes a
// past day show what it actually had rather than what somebody typed into it
// that evening: opening last Tuesday asks the same questions about Tuesday.
// That is also why a past day is not editable — there is nothing here to edit.
export default async function DailyKpiPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const now = new Date();
  const today = toChecklistDay(now);
  // A ?date= in the future would show a day that has not happened, so it is
  // pulled back to today the same way a junk one is.
  const asked = parseDayKey(searchParams.date, now);
  const day = asked > today ? today : asked;
  const isToday = day.getTime() === today.getTime();

  const goals = await loadDailyKpiGoals();
  const history = await loadDailyKpiRange(addDays(day, -(HISTORY_DAYS - 1)), day);

  const byDay = new Map(history.map((d) => [d.day.getTime(), d]));
  const on = (d: Date): DailyKpiDay =>
    byDay.get(d.getTime()) ?? { day: d, counts: emptyCounts() };

  const counts = on(day).counts;
  const yesterday = on(addDays(day, -1)).counts;

  // ─── Trend ───────────────────────────────────────────────────────────────

  const trendDays = history.slice(-DAILY_KPI_TREND_DAYS);
  const trend: DailyKpiPoint[] = trendDays.map((d) => ({
    day: d.day.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    ...d.counts,
  }));

  // ─── Score and streak ────────────────────────────────────────────────────

  const score = dailyScore(counts, goals);
  const note = scoreNote(score);
  const streak = streakLength(history, goals);
  const metToday = allGoalsMet(counts, goals);

  // ─── Weekly summary ──────────────────────────────────────────────────────
  //
  // Week to date against the same span of the week before, rather than against
  // that week's whole seven days: comparing three days of this week with seven
  // of last would report a collapse every Wednesday.
  const start = weekStart(day);
  const daysIn = Math.round((day.getTime() - start.getTime()) / 86400000) + 1;
  const thisWeek = sumCounts(
    Array.from({ length: daysIn }, (_, i) => on(addDays(start, i)).counts),
  );
  const priorWeek = sumCounts(
    Array.from({ length: daysIn }, (_, i) => on(addDays(start, i - 7)).counts),
  );

  // ─── Breakdown table ─────────────────────────────────────────────────────

  const recent = Array.from({ length: RECENT_DAYS }, (_, i) =>
    on(addDays(day, i - RECENT_DAYS)),
  );

  const dayLabel = fmtDate(day);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-2xl font-semibold">Daily KPI</h1>
          <p className="mt-1.5 text-sm text-muted">
            Track your daily progress. Small actions compound into clinic
            growth.
          </p>
        </div>

        {/* Day navigation. Forward stops at today for the reason the
            checklist's does: this is a record of days that have happened, and
            offering tomorrow would invite reading numbers off one. */}
        <div className="flex flex-wrap items-center gap-2">
          <DayPicker
            value={toDayKey(day)}
            max={toDayKey(today)}
            basePath="/daily-kpi"
          />
          <Link
            href={`/daily-kpi?date=${toDayKey(addDays(day, -1))}`}
            className="btn px-3"
            aria-label="Previous day"
          >
            <Icon name="chevronLeft" className="h-4 w-4" />
          </Link>
          {isToday ? (
            <span className="btn pointer-events-none px-3 opacity-40" aria-hidden>
              <Icon name="chevronRight" className="h-4 w-4" />
            </span>
          ) : (
            <Link
              href={`/daily-kpi?date=${toDayKey(addDays(day, 1))}`}
              className="btn px-3"
              aria-label="Next day"
            >
              <Icon name="chevronRight" className="h-4 w-4" />
            </Link>
          )}
          {!isToday && (
            <Link href="/daily-kpi" className="btn">
              Back to today
            </Link>
          )}
        </div>
      </div>

      {!isToday && (
        <p className="mt-4 text-xs text-muted">
          Showing {dayLabel} — the actuals that day had. Past days are read off
          the records and are not editable.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {DAILY_KPI_KEYS.map((key) => (
          <DailyKpiCard
            key={key}
            metric={key}
            count={counts[key]}
            goal={goals[key]}
            yesterday={yesterday[key]}
            isToday={isToday}
          />
        ))}
      </div>

      <div className="mt-5 grid items-stretch gap-6 lg:grid-cols-4">
        <section className="card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="display text-xl font-semibold">
              Daily progress overview
            </h2>
            <span className="chip-stat">Last {DAILY_KPI_TREND_DAYS} days</span>
          </div>
          <DailyKpiTrend data={trend} />
        </section>

        {/* The score. One ring, one line of encouragement, and no second
            statistic — a composite that needs explaining beside it is not
            doing its job. What it is, is the average of the four percentages
            with each capped at 100 first (src/lib/dailyKpi.ts). */}
        <section className="card flex flex-col items-center p-6 text-center">
          <h2 className="display self-start text-xl font-semibold">
            {isToday ? "Today’s score" : "Score"}
          </h2>
          <div className="flex flex-1 flex-col items-center justify-center py-4">
            <ProgressRing
              pct={score}
              hue="#7C3AED"
              size={132}
              stroke={12}
              label={`Score ${score} out of 100`}
            >
              <span className="num text-[34px] font-semibold leading-none tracking-tight">
                {score}
              </span>
              <span className="mt-1 text-[11px] text-muted">/100</span>
            </ProgressRing>
            <div className="mt-4 text-sm font-semibold">{note.headline}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {note.detail}
            </p>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="display text-xl font-semibold">Weekly summary</h2>
          <p className="mt-1 text-xs text-muted">
            Week to date vs the same days last week
          </p>
          <ul className="mt-4 space-y-3">
            {DAILY_KPI_KEYS.map((key) => {
              const change = pctChange(thisWeek[key], priorWeek[key]);
              return (
                <li key={key} className="flex items-center gap-2.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: DAILY_KPI_HUES[key] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {DAILY_KPI_LABELS[key]}
                  </span>
                  <span className="num shrink-0 text-xs font-semibold">
                    {thisWeek[key]}
                  </span>
                  {/* No base to change from is a dash, not a 100% rise. */}
                  <span
                    className={`num flex w-12 shrink-0 items-center justify-end gap-0.5 text-xs ${
                      change === null
                        ? "text-muted"
                        : change > 0
                          ? "text-ok"
                          : change < 0
                            ? "text-bad"
                            : "text-muted"
                    }`}
                  >
                    {change !== null && change !== 0 && (
                      <Icon
                        name={change > 0 ? "arrowUp" : "arrowDown"}
                        className="h-3 w-3"
                      />
                    )}
                    {change === null ? "—" : `${Math.abs(change)}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="mt-5 grid items-stretch gap-6 lg:grid-cols-4">
        <section className="card lg:col-span-3">
          <div className="border-b border-line/60 px-6 py-4">
            <h2 className="display text-xl font-semibold">
              Daily KPI breakdown
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Goal, the three days before, {isToday ? "today" : dayLabel}, and
              the {DAILY_KPI_TREND_DAYS}-day average
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">KPI</th>
                  <th className="th text-right">Goal</th>
                  {recent.map((d) => (
                    <th key={d.day.getTime()} className="th text-right">
                      {d.day.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </th>
                  ))}
                  <th className="th text-right">
                    {isToday ? "Today" : "That day"}
                  </th>
                  <th className="th text-right">
                    {DAILY_KPI_TREND_DAYS}-day avg
                  </th>
                </tr>
              </thead>
              <tbody>
                {DAILY_KPI_KEYS.map((key) => {
                  const hue = DAILY_KPI_HUES[key];
                  const met = counts[key] >= goals[key];
                  return (
                    <tr key={key}>
                      <td className="td">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: hue }}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm">
                              {DAILY_KPI_LABELS[key]}
                            </div>
                            <div className="text-xs text-muted">
                              {progressPct(counts[key], goals[key])}% of goal
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="td num text-right text-muted">
                        {goals[key]}
                      </td>
                      {recent.map((d) => (
                        <td
                          key={d.day.getTime()}
                          className="td num text-right text-muted"
                        >
                          {d.counts[key]}
                        </td>
                      ))}
                      {/* The viewed day is the column the row is about, so it
                          is the one that carries the metric's own colour —
                          softly when the goal is not met yet, because a tint
                          is a highlight and not a verdict. */}
                      <td className="td text-right">
                        <span
                          className="num inline-flex min-w-[46px] justify-center rounded-lg px-2 py-1 text-sm font-semibold"
                          style={{
                            color: hue,
                            background: met ? `${hue}1F` : `${hue}12`,
                          }}
                        >
                          {counts[key]}
                        </span>
                      </td>
                      <td className="td num text-right font-medium">
                        {averageFor(trendDays, key)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* The streak. Counted from the same daily counts as everything else —
            consecutive days on which all four goals were met — with today
            counted while it is still in progress and never counted against the
            run behind it (src/lib/dailyKpi.ts). */}
        <section className="card flex flex-col items-center p-6 text-center">
          <h2 className="display self-start text-xl font-semibold">
            Keep the streak 🔥
          </h2>
          <div className="flex flex-1 flex-col items-center justify-center py-4">
            <ProgressRing
              pct={streak > 0 ? 100 : 0}
              hue="#3B82F6"
              size={116}
              stroke={8}
              label={`${streak} day streak`}
            >
              <span className="num text-[30px] font-semibold leading-none tracking-tight">
                {streak}
              </span>
              <span className="mt-1 text-[11px] text-muted">
                {streak === 1 ? "Day" : "Days"}
              </span>
            </ProgressRing>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              {streak === 0
                ? "No run going. Hit all four goals in a day to start one."
                : metToday
                  ? `All four goals hit ${streak} ${streak === 1 ? "day" : "days"} in a row.`
                  : `${streak} ${streak === 1 ? "day" : "days"} in a row behind you — hit all four ${isToday ? "today" : "that day"} to keep it.`}
            </p>
          </div>
          <Link href="/activities?view=checklist" className="btn w-full justify-center">
            View habit tracker
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </section>
      </div>

      <div className="mt-5">
        <DailyKpiGoalsForm goals={goals} save={saveDailyKpiGoals} />
      </div>
    </div>
  );
}
