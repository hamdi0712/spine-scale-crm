// The journal: one day open for writing, and everything already written below
// it.
//
// ?date= opens a day — which is what the calendar's squares link to. Today is
// the default, and any day up to it can be written: a note is editable
// whenever the day it is about is open, not only on the day itself. A day
// shows its habits alongside its note, because a note about a day reads
// differently next to what actually happened on it — and those are tickable
// here too, so a day you came back to can be corrected where you are reading
// it rather than only on the dashboard.
//
// A day that has not started yet is the one exception: nothing is offered,
// because the action would refuse it.

import Link from "next/link";
import {
  activeHabits,
  loadChallenge,
  loadHabits,
  loadNote,
  loadNotes,
  loadProgress,
} from "@/lib/monkModeStore";
import {
  dayIsOver,
  dayKey,
  dayNumber,
  indexProgress,
  readMonkDay,
  toChecklistDay,
} from "@/lib/monkMode";
import { parseDayKey } from "@/lib/dailyChecklist";
import { fmtDate } from "@/lib/format";
import MonkDayBar from "@/components/MonkDayBar";
import MonkHeader from "@/components/MonkHeader";
import MonkNote from "@/components/MonkNote";
import MonkTodayList from "@/components/MonkTodayList";

export const dynamic = "force-dynamic";

export default async function MonkJournalPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const now = new Date();
  const day = toChecklistDay(parseDayKey(searchParams.date, now));
  const key = dayKey(day);
  const today = toChecklistDay(now);
  const past = dayIsOver(day, now);
  // A day in the future is not writable either — the action refuses it, and
  // the page should not offer a box that will be ignored.
  const future = toChecklistDay(day).getTime() > toChecklistDay(now).getTime();

  const [challenge, habits, note, notes, rows] = await Promise.all([
    loadChallenge(now),
    loadHabits(),
    loadNote(day),
    loadNotes(),
    loadProgress(day, day),
  ]);
  const active = activeHabits(habits);
  const progress = indexProgress(rows);
  const dayRows = readMonkDay(active, progress, day, now);
  const n = dayNumber(challenge, day);

  return (
    <div className="max-w-5xl">
      <MonkHeader
        title={<h1 className="display text-[32px] font-semibold">Journal</h1>}
        subtitle="One note a day. Open any day you have lived and write it up — the habits on it are tickable too."
      />

      {/* Which day is open, and the way to another one. Says "Editing …" on
          anything but today, the same indicator the dashboard carries. */}
      {!future && <MonkDayBar day={day} today={today} basePath="/monk-mode/journal" />}

      <section className="card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-xl font-semibold">
            {past || future ? fmtDate(day) : "Today"}
          </h2>
          <span className="num text-xs text-muted">
            {n === null ? "Outside the challenge" : `Day ${n} of ${challenge.durationDays}`}
            {" · "}
            {fmtDate(day)}
          </span>
        </div>

        <div className="mt-4">
          {/* Read-only on a future day only. A past day is open: the note
              is about that day, and coming back to write it up an evening
              late is the ordinary way a journal gets kept. */}
          <MonkNote day={key} content={note} readOnly={future} rows={6} />
        </div>

        {/* What the day actually did, under what was written about it — and
            tickable, because the commonest reason to open a past day at all is
            that something on it went unlogged. The rows write to this day, not
            to today. */}
        {!future && dayRows.length > 0 && (
          <div className="mt-6 border-t border-line/60 pt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {past ? <>That day&rsquo;s habits</> : <>Today&rsquo;s habits</>}
              </h3>
              <Link
                href={past ? `/monk-mode?date=${key}` : "/monk-mode"}
                className="text-xs font-medium text-accent hover:underline"
              >
                Open the cards
              </Link>
            </div>
            <MonkTodayList rows={dayRows} day={key} />
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="display mb-3 text-xl font-semibold">Everything written</h2>
        {notes.length === 0 ? (
          <p className="card p-6 text-center text-sm text-muted">
            Nothing written down yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {notes.map((entry) => (
              <li key={entry.day} className="card p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/monk-mode/journal?date=${entry.day}`}
                    className="num text-sm font-medium text-accent hover:underline"
                  >
                    {fmtDate(new Date(`${entry.day}T00:00:00.000Z`))}
                  </Link>
                  <DayChip
                    challengeDay={dayNumber(
                      challenge,
                      new Date(`${entry.day}T00:00:00.000Z`),
                    )}
                  />
                </div>
                {/* Pre-wrapped: an entry is written with its own line breaks,
                    and collapsing them would be rewriting it. */}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                  {entry.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DayChip({ challengeDay }: { challengeDay: number | null }) {
  if (challengeDay === null) return null;
  return <span className="chip-stat num">Day {challengeDay}</span>;
}
