import Link from "next/link";
import {
  addDays,
  dayKey as toDayKey,
  parseDayKey,
} from "@/lib/dailyChecklist";
import {
  DAILY_GOAL_KEYS,
  DAILY_KPI_HUES,
  DAILY_KPI_KEYS,
  DAILY_KPI_LABELS,
  DAILY_KPI_TREND_DAYS,
  DailyKpiDay,
  MONTHLY_GOAL_KEYS,
  MonthlyPace,
  allGoalsMet,
  averageFor,
  creditedDays,
  dailyScore,
  emptyCounts,
  isMonthly,
  monthStart,
  monthlyPace,
  pctChange,
  progressPct,
  ROLLOVER_KEY,
  rolloverLedger,
  scoreNote,
  streakLength,
  sumCounts,
  toUtcDay,
} from "@/lib/dailyKpi";
import { loadDailyKpiGoals, loadDailyKpiRange } from "@/lib/dailyKpiStore";
import { saveDailyKpiGoals } from "@/lib/actions/dailyKpi";
import { fmtDate } from "@/lib/format";
import DailyKpiCard, { KpiMark } from "@/components/DailyKpiCard";
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
  // Today read in UTC, the same reading the counts are filed under. Read off
  // the local calendar instead, "today" east of UTC would be a day the store
  // has no bucket for — which is what made this page throw.
  const today = toUtcDay(now);
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

  // ─── Qualified Leads' surplus rollover ───────────────────────────────────
  //
  // Qualified Leads banks its leftover: a day that overshoots the goal carries
  // the surplus into the next day, and the next day is credited with it before
  // it is scored (src/lib/dailyKpi.ts). Qualifying arrives in lumps — one good
  // discovery session surfaces a dozen clinics and the morning after has none
  // left to score — and a flat daily line would mark down the day after the
  // work rather than the day the work was skipped.
  //
  // The ledger is walked over the same history the rest of the page reads,
  // oldest first, so the carry arriving at the viewed day is the one the days
  // behind it actually produced. It is computed here and stored nowhere: a
  // stored carry would be the one number on this page that could disagree with
  // the records behind it, and it would go stale the moment the goal changed.
  //
  // Only what *judges* a day reads it — the card's ring, the score, the
  // streak. The trend chart and the breakdown table's day columns stay on the
  // raw counts below, because those two exist to show the real day-to-day
  // pattern, and a banked day drawn as activity would hide the very lumpiness
  // this rollover exists to forgive.
  const creditedHistory = creditedDays(history, goals.qualifiedLeads);
  const creditedByDay = new Map(
    creditedHistory.map((d) => [d.day.getTime(), d]),
  );
  const onCredited = (d: Date): DailyKpiDay =>
    creditedByDay.get(d.getTime()) ?? { day: d, counts: emptyCounts() };

  const credited = onCredited(day).counts;
  const creditedYesterday = onCredited(addDays(day, -1)).counts;
  // The viewed day's row of the ledger, for the card's banked line.
  const ledgerToday = rolloverLedger(history, goals.qualifiedLeads).find(
    (r) => r.day.getTime() === day.getTime(),
  );

  // ─── Trend ───────────────────────────────────────────────────────────────

  const trendDays = history.slice(-DAILY_KPI_TREND_DAYS);
  const trend: DailyKpiPoint[] = trendDays.map((d) => ({
    day: d.day.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    qualifiedLeads: d.counts.qualifiedLeads,
    messagesSent: d.counts.messagesSent,
  }));

  // ─── Month to date ───────────────────────────────────────────────────────
  //
  // What the two monthly metrics are read against. Summed out of the same
  // history the rest of the page is read from rather than fetched again — the
  // window already covers this month unless the viewed day is its first.

  const mStart = monthStart(day);
  const monthDays = Math.round((day.getTime() - mStart.getTime()) / 86400000) + 1;
  const monthToDate = sumCounts(
    Array.from({ length: monthDays }, (_, i) => on(addDays(mStart, i)).counts),
  );
  const pace = Object.fromEntries(
    MONTHLY_GOAL_KEYS.map((key) => [
      key,
      monthlyPace(monthToDate[key], goals[key], day),
    ]),
  ) as Record<string, MonthlyPace>;

  // ─── Score and streak ────────────────────────────────────────────────────

  // Scored and streaked off the credited counts, so Qualified Leads' banked
  // surplus counts the same way here as it does on its card. Every other
  // metric passes through creditedDays untouched.
  const score = dailyScore(credited, goals);
  const note = scoreNote(score);
  const streak = streakLength(creditedHistory, goals);
  const metToday = allGoalsMet(credited, goals);

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
          <p className="mt-1.5 text-sm font-normal text-muted">
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

      {/* Tighter than the dashboard's headline row: four compact tiles on
          one line, at the gap the rest of this page's rows use. */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DAILY_KPI_KEYS.map((key) => {
          const monthly = isMonthly(key);
          return (
            <DailyKpiCard
              key={key}
              metric={key}
              count={
                monthly
                  ? monthToDate[key]
                  : key === ROLLOVER_KEY
                    ? credited[key]
                    : counts[key]
              }
              goal={goals[key]}
              yesterday={
                key === ROLLOVER_KEY ? creditedYesterday[key] : yesterday[key]
              }
              isToday={isToday}
              pace={monthly ? pace[key] : undefined}
              carryIn={key === ROLLOVER_KEY ? ledgerToday?.carryIn : undefined}
            />
          );
        })}
      </div>

      <div className="mt-5 grid items-stretch gap-6 lg:grid-cols-4">
        <section className="card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="display text-xl font-semibold">
                Daily progress overview
              </h2>
              <p className="mt-0.5 text-xs font-normal text-muted">
                The two metrics held to a daily goal
              </p>
            </div>
            <span className="chip-stat">Last {DAILY_KPI_TREND_DAYS} days</span>
          </div>
          <DailyKpiTrend data={trend} />
        </section>

        {/* The score. One ring and one line of encouragement, and nothing
            else: it is the average of the two daily metrics' percentages, each
            capped at 100 first (src/lib/dailyKpi.ts). A day where the outreach
            went out and nobody replied is a day's work done, and the score
            says so.

            The monthly pair's pace used to sit under a rule here, for
            reference and never for scoring. It was a third copy — the metric
            cards above carry it and Weekly summary carries it again — and it
            was the reason this card stood taller than the two beside it. The
            row is level now and the pace has lost nothing. */}
        <section className="card flex flex-col items-center p-6 text-center">
          <h2 className="display self-start text-xl font-semibold">
            {isToday ? "Today’s score" : "Score"}
          </h2>
          <div className="flex flex-1 flex-col items-center justify-center py-4">
            <ProgressRing
              pct={score}
              hue="rgb(var(--kpi-purple))"
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
          <p className="mt-1 text-xs font-normal text-muted">
            Week to date vs the same days last week
          </p>
          <ul className="mt-4 space-y-3">
            {DAILY_GOAL_KEYS.map((key) => {
              const change = pctChange(thisWeek[key], priorWeek[key]);
              return (
                <li key={key} className="flex items-center gap-2.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: DAILY_KPI_HUES[key] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted">
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

          {/* The monthly pair is not a week's work, so it is not reported as
              one: month to date against the monthly goal, and the pace that
              implies. Same rows, a different question. */}
          <p className="mt-5 border-t border-line/60 pt-4 text-xs font-normal text-muted">
            Month to date vs the monthly goal
          </p>
          <ul className="mt-3 space-y-3">
            {MONTHLY_GOAL_KEYS.map((key) => (
              <li key={key} className="flex items-center gap-2.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: DAILY_KPI_HUES[key] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted">
                  {DAILY_KPI_LABELS[key]}
                </span>
                <span className="num shrink-0 text-xs font-semibold">
                  {pace[key].monthToDate}
                  <span className="font-normal text-muted">/{pace[key].goal}</span>
                </span>
                <span
                  className={`num flex w-12 shrink-0 justify-end text-xs ${
                    pace[key].onTrack ? "text-ok" : "text-muted"
                  }`}
                >
                  {pace[key].pct}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-5 grid items-stretch gap-6 lg:grid-cols-4">
        <section className="card lg:col-span-3">
          <div className="border-b border-line/60 px-6 py-4">
            <h2 className="display text-xl font-semibold">
              Daily KPI breakdown
            </h2>
            <p className="mt-0.5 text-xs font-normal text-muted">
              Daily metrics by day; the monthly pair month to date
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
                  const monthly = isMonthly(key);
                  // The day columns stay raw (below), but whether the goal was
                  // met is the same question the card and the streak answer,
                  // and Qualified Leads answers it off its credited value.
                  const dayCount = key === ROLLOVER_KEY ? credited[key] : counts[key];
                  const met = monthly
                    ? pace[key].onTrack
                    : dayCount >= goals[key];
                  return (
                    <tr key={key}>
                      <td className="td">
                        <div className="flex items-center gap-2.5">
                          {/* The same flat two-tone mark the cards carry, at
                              table size — one object, drawn once, in
                              DailyKpiCard. */}
                          <KpiMark metric={key} size={26} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-normal">
                              {DAILY_KPI_LABELS[key]}
                            </div>
                            <div className="text-xs font-normal text-muted">
                              {monthly
                                ? `${pace[key].pct}% of the monthly goal`
                                : `${progressPct(dayCount, goals[key])}% of goal`}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="td num text-right text-muted">
                        {goals[key]}
                        <span className="ml-1 text-xs">
                          {monthly ? "/mo" : "/day"}
                        </span>
                      </td>

                      {monthly ? (
                        /* A monthly metric has no daily actual worth reading,
                           so it does not pretend to one: the day columns give
                           way to the month it is actually judged over. */
                        <td
                          className="td text-right text-sm font-normal text-muted"
                          colSpan={recent.length + 2}
                        >
                          <span className="num font-semibold text-ink">
                            {pace[key].monthToDate}
                          </span>{" "}
                          this month · on pace for{" "}
                          <span
                            className={`num ${met ? "text-ok" : "text-muted"}`}
                          >
                            {pace[key].projected}/{pace[key].goal}
                          </span>
                        </td>
                      ) : (
                        <>
                          {recent.map((d) => (
                            <td
                              key={d.day.getTime()}
                              className="td num text-right text-muted"
                            >
                              {d.counts[key]}
                            </td>
                          ))}
                          {/* The viewed day is the column the row is about, so
                              it is the one that carries the metric's own
                              colour — softly when the goal is not met yet,
                              because a tint is a highlight and not a verdict. */}
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
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* The streak. Counted from the same daily counts as everything else —
            consecutive days on which both daily goals were met — with today
            counted while it is still in progress and never counted against the
            run behind it. The monthly pair is not in it: a day cannot meet or
            miss a monthly goal (src/lib/dailyKpi.ts). */}
        <section className="card flex flex-col items-center p-6 text-center">
          <h2 className="display self-start text-xl font-semibold">
            Keep the streak 🔥
          </h2>
          <div className="flex flex-1 flex-col items-center justify-center py-4">
            <ProgressRing
              pct={streak > 0 ? 100 : 0}
              hue="rgb(var(--kpi-blue))"
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
                ? "No run going. Hit both daily goals in a day to start one."
                : metToday
                  ? `Both daily goals hit ${streak} ${streak === 1 ? "day" : "days"} in a row.`
                  : `${streak} ${streak === 1 ? "day" : "days"} in a row behind you — hit both daily goals ${isToday ? "today" : "that day"} to keep it.`}
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
