// The non-negotiables: one card per active habit, showing where today stands.
//
// Every card is a control. Tapping it advances the habit by one and wraps back
// to zero at its target (bumpMonkHabit), which is a toggle on a habit that
// wants one a day and a counter on one that wants five — the same rule
// producing both, rather than two behaviours that have to agree. A
// multi-target card also draws its target as individual dots, and those are
// tappable in their own right: tapping the third of five means three, not
// "press this four more times".
//
// The card carries no description. It used to, and at seven across a page
// that is a subtitle wrapping to three lines under a name that wraps to two,
// with every card in the row stretched to whichever had the most words — the
// single raggedest thing on the page, in aid of telling somebody what their
// own habit means. The description is still edited in settings and still
// arrives as the card's tooltip; it is just not set in eleven-pixel type seven
// times across a dashboard.
//
// Two colour systems would fight here, so there is one: the habit's own accent
// colours its glyph, always, and completion is the card's state — a green rim,
// a tinted ground and a tick over the glyph. Accent says which habit; green
// says done.
//
// No client JavaScript. Every control is a form posting to a server action, so
// the grid works exactly as well before hydration as after it.
//
// A past day is a record, so its cards are drawn in the same states and
// disabled. The action refuses the write as well (src/lib/actions/monkMode.ts);
// this is the half of that rule the person can see.

import { MonkHabitDay, monkAccent } from "@/lib/monkMode";
import { bumpMonkHabit, setMonkHabitProgress } from "@/lib/actions/monkMode";
import MonkIcon from "@/components/MonkIcon";
import Icon from "@/components/Icons";

export default function MonkHabitGrid({
  rows,
  day,
  readOnly = false,
}: {
  rows: MonkHabitDay[];
  // The day these cards write to, bound into every action at render time — so
  // a page left open over midnight posts the day it was showing rather than
  // whatever "today" has become.
  day: string;
  readOnly?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No habits yet. Add your non-negotiables under{" "}
        <span className="font-medium text-ink">Habits</span>.
      </p>
    );
  }

  // The whole list on one row, on any screen with room for it. That is the
  // design of this panel and not a side effect of a column count: "your seven
  // non-negotiables" is a row of seven, and a seventh card orphaned onto a
  // second line by four pixels of width reads as an eighth habit somebody
  // forgot to fill in. So the column count is the number of habits, and the
  // cards share whatever width there is; below the breakpoint in .monk-habit-
  // grid they wrap properly instead, because seven cards across a phone is not
  // a row either.
  //
  // Past a dozen the row stops being readable at any width and the wrapping
  // rule takes over — a list that long is a different panel, and if anybody
  // ever keeps fourteen non-negotiables it can be designed then.
  const oneRow = rows.length <= 12;

  return (
    <div
      className={oneRow ? "monk-habit-grid" : "monk-habit-grid monk-habit-wrap"}
      style={{ "--monk-cols": rows.length } as React.CSSProperties}
    >
      {rows.map((row) => (
        <HabitCard key={row.habit.id} row={row} day={day} readOnly={readOnly} />
      ))}
    </div>
  );
}

function HabitCard({
  row,
  day,
  readOnly,
}: {
  row: MonkHabitDay;
  day: string;
  readOnly: boolean;
}) {
  const accent = monkAccent(row.habit.accent);
  const complete = row.status === "complete";
  const multi = row.target > 1;

  return (
    // A div rather than a form, because a multi-target card's dot row holds
    // forms of its own and a form cannot contain another one.
    <div
      className={`monk-tile relative flex flex-col rounded-[16px] border p-3.5 ${
        complete
          ? "border-ok/40 bg-ok/[0.06]"
          : row.status === "missed"
            ? "border-line bg-surface opacity-75"
            : "border-line bg-surface"
      }`}
    >
      <form action={bumpMonkHabit.bind(null, row.habit.id, day)}>
        <button
          type="submit"
          disabled={readOnly}
          title={row.habit.description ?? row.habit.name}
          aria-label={
            multi
              ? `${row.habit.name}: ${row.done} of ${row.target}`
              : `${row.habit.name}: ${complete ? "done" : "not yet"}`
          }
          className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          <span className="relative inline-flex">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-[12px] ${accent.soft} ${accent.text}`}
            >
              <MonkIcon name={row.habit.icon} size={20} />
            </span>
            {/* The tick sits over the glyph rather than beside it, so a
                finished card is read from the one place the eye already went. */}
            {complete && (
              <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-surface bg-ok text-white">
                <Icon name="check" className="h-2.5 w-2.5" />
              </span>
            )}
          </span>
          <span className="mt-2.5 block text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]">
            {row.habit.name}
          </span>
        </button>
      </form>

      {/* Pushed to the bottom so the progress row of every card in the grid
          lines up, whether its name took one line or two. */}
      <div className="mt-auto pt-3">
        {multi ? (
          <DotRow row={row} day={day} readOnly={readOnly} />
        ) : (
          <SingleState row={row} />
        )}
      </div>
    </div>
  );
}

// A single-target habit's state, in words. A label rather than a second
// control: the whole card already toggles it, and a button inside a button's
// card that does the same thing is one tab stop and one screen-reader
// announcement too many. Never a bare empty circle either — a card that says
// nothing is a card nobody can read at a glance.
function SingleState({ row }: { row: MonkHabitDay }) {
  const complete = row.status === "complete";
  return (
    <span
      className={`text-[11px] font-medium ${
        complete ? "text-ok" : "text-muted"
      }`}
    >
      {complete ? "Done" : row.status === "missed" ? "Missed" : "Not yet"}
    </span>
  );
}

// A multi-target habit: one dot per unit of the target, and the count beside
// them.
//
// Each dot posts the count it represents, so the row is a control rather than
// a readout — and tapping a filled dot posts one less than itself, which is
// how three becomes two without a second button to undo with.
function DotRow({
  row,
  day,
  readOnly,
}: {
  row: MonkHabitDay;
  day: string;
  readOnly: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {Array.from({ length: row.target }, (_, i) => {
          const n = i + 1;
          const filled = row.done >= n;
          return (
            <form
              key={n}
              action={setMonkHabitProgress.bind(
                null,
                row.habit.id,
                day,
                // A filled dot walks the count back to just before itself; an
                // empty one sets the count to itself.
                filled ? n - 1 : n,
              )}
            >
              <button
                type="submit"
                disabled={readOnly}
                aria-label={`${row.habit.name}: ${filled ? n - 1 : n} of ${row.target}`}
                title={`${filled ? n - 1 : n} of ${row.target}`}
                className={`block h-[9px] w-[9px] rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                  filled
                    ? "bg-ok"
                    : "border border-line bg-transparent hover:border-muted"
                }`}
              />
            </form>
          );
        })}
      </div>
      <span
        className={`num shrink-0 text-[11px] font-medium ${
          row.status === "complete" ? "text-ok" : "text-muted"
        }`}
      >
        {row.done}/{row.target}
      </span>
    </div>
  );
}

// The one mark the feature marks a day with: a filled green tick for done, a
// hollow ring for a day still open, a muted one for a day that ended without
// it. Same object in three states rather than three objects. Used by the
// streak row and the compact habit list.
export function CheckDot({
  filled,
  missed = false,
  size = 18,
}: {
  filled: boolean;
  missed?: boolean;
  size?: number;
}) {
  if (filled) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-ok text-white"
        style={{ width: size, height: size }}
      >
        <Icon name="check" className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span
      className={`shrink-0 rounded-full border ${
        missed ? "border-muted/40 bg-wash" : "border-line bg-transparent"
      }`}
      style={{ width: size, height: size }}
    />
  );
}
