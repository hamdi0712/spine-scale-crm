// The journal: one day open for writing, and everything already written below
// it.
//
// ?date= opens a day — which is what the calendar's squares link to. Today is
// the default and the only day that can be edited; a past day shows what it
// was left as, alongside the habits it recorded, because a note about a day
// reads differently next to what actually happened on it.

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
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="display text-[32px] font-semibold">Journal</h1>
        <p className="mt-1.5 text-sm text-muted">
          One note a day, written on the day. Past days stay as they were left.
        </p>
      </div>

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
          <MonkNote
            day={key}
            content={note}
            readOnly={past || future}
            rows={6}
          />
        </div>

        {/* What the day actually did, under what was written about it. Read-only
            here whatever day it is: this page is for the writing, and the
            habits are logged on the dashboard. */}
        {!future && dayRows.length > 0 && (
          <div className="mt-6 border-t border-line/60 pt-4">
            <h3 className="mb-2 text-sm font-semibold">That day&rsquo;s habits</h3>
            <MonkTodayList rows={dayRows} day={key} readOnly />
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
