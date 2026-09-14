// The non-negotiables: one card per active habit, showing where today stands.
//
// Every card is a control. Tapping the body advances the habit by one and
// wraps back to zero at its target (bumpMonkHabit), which is a toggle on a
// habit that wants one a day and a counter on one that wants five — the same
// rule producing both, rather than two behaviours that have to agree. A
// multi-target card also draws its target as individual dots, and those are
// tappable in their own right: tapping the third of five means three, not
// "press this four more times".
//
// No client JavaScript. Every control is a form posting to a server action, so
// the grid works exactly as well before hydration as after it — the same way
// the daily checklist does.
//
// A past day is a record, so its cards are drawn in the same states and
// disabled. The action refuses the write as well (src/lib/actions/monkMode.ts);
// this is the half of that rule the person can see.

import {
  MonkHabitDay,
  MonkStatus,
  monkAccent,
} from "@/lib/monkMode";
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
        No habits yet. Add your non-negotiables in{" "}
        <span className="font-medium text-ink">Settings</span>.
      </p>
    );
  }

  return (
    // One column until there is room for two. The app shell keeps its
    // 224px sidebar at every width, so on a phone the content column is
    // narrow enough that two columns of habit card would be one character
    // per line — a single column is the honest fallback.
    <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
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
    // The card is a div rather than a form, because the dot row underneath
    // holds forms of its own and a form cannot contain another one.
    <div
      className={`card flex flex-col ${accent.border} ${complete ? accent.fill : ""}`}
    >
      <form action={bumpMonkHabit.bind(null, row.habit.id, day)}>
        <button
          type="submit"
          disabled={readOnly}
          title={
            readOnly
              ? "A past day — not editable"
              : complete
                ? "Done — tap to clear"
                : multi
                  ? `Log one (${row.done} of ${row.target})`
                  : "Mark as done"
          }
          className="monk-card w-full rounded-t-2xl px-4 pb-3 pt-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          <span
            className={`flex h-11 w-11 items-center justify-center rounded-[14px] ${accent.soft} ${accent.text}`}
          >
            <MonkIcon name={row.habit.icon} size={22} />
          </span>
          <span className="mt-3 block text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
            {row.habit.name}
          </span>
          {/* Clamped to two lines. At seven columns a card is about 150px wide
              and a long description is four lines of it, which pushes the
              progress row of every card in the grid down to match — the
              subtitle is a reminder of why the habit is on the list, not
              something to read. The whole of it is still in the DOM for a
              screen reader. */}
          {row.habit.description && (
            <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
              {row.habit.description}
            </span>
          )}
        </button>
      </form>

      {/* Pushed to the bottom so a card with a one-line description and a card
          with a two-line one still line their progress rows up across the
          grid. */}
      <div className="mt-auto border-t border-line/60 px-4 py-3">
        {multi ? (
          <DotRow row={row} day={day} readOnly={readOnly} />
        ) : (
          <SingleState row={row} day={day} readOnly={readOnly} />
        )}
      </div>
    </div>
  );
}

// A single-target habit: one state, stated in words. "Done" with a tick, or
// the invitation to do it — never a bare empty circle, because a card that
// says nothing is a card nobody can read at a glance.
function SingleState({
  row,
  day,
  readOnly,
}: {
  row: MonkHabitDay;
  day: string;
  readOnly: boolean;
}) {
  const complete = row.status === "complete";
  return (
    <form action={bumpMonkHabit.bind(null, row.habit.id, day)}>
      <button
        type="submit"
        disabled={readOnly}
        className={`flex items-center gap-2 rounded-full text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
          complete ? "text-ok" : "text-muted hover:text-ink"
        }`}
      >
        <CheckDot filled={complete} missed={row.status === "missed"} />
        {complete ? "Done" : row.status === "missed" ? "Missed" : "Not yet"}
      </button>
    </form>
  );
}

// A multi-target habit: X / Y, then one dot per unit of the target.
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
    <div>
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
                className="flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              >
                <CheckDot
                  filled={filled}
                  missed={!filled && row.status === "missed"}
                />
              </button>
            </form>
          );
        })}
      </div>
      <div
        className={`num mt-2 text-xs font-medium ${
          row.status === "complete" ? "text-ok" : "text-muted"
        }`}
      >
        {row.done} / {row.target}
      </div>
    </div>
  );
}

// The one mark the whole feature is drawn with: a filled green tick for done,
// a hollow ring for a day still open, and a muted one for a day that ended
// without it. Same object in three states rather than three objects.
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

// The legend the grid and the donut share, so "In Progress" means the same
// thing in both places and is explained in exactly one.
export function MonkLegend({ className = "" }: { className?: string }) {
  const items: { label: string; status: MonkStatus; dot: string }[] = [
    { label: "Completed", status: "complete", dot: "bg-ok" },
    { label: "In Progress", status: "partial", dot: "bg-accent" },
    { label: "Missed", status: "missed", dot: "bg-muted/50" },
  ];
  return (
    <div className={`flex flex-wrap items-center gap-4 ${className}`}>
      {items.map((item) => (
        <span
          key={item.status}
          className="flex items-center gap-1.5 text-xs text-muted"
        >
          <span className={`h-2 w-2 rounded-full ${item.dot}`} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  );
}
