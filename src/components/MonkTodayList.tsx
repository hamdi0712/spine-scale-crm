// Today's habits as a compact list — the same day the cards above show, read
// as rows.
//
// Not a duplicate of the grid but the other way of reading it: the grid is
// seven tiles you tap, and this is the day as a checklist you scan. Same
// actions behind it, so a tick here and a tap up there are one write — and
// the day is whichever day the page is holding, today or one behind it.

import { MonkHabitDay } from "@/lib/monkMode";
import { monkAccent } from "@/lib/monkMode";
import { bumpMonkHabit } from "@/lib/actions/monkMode";
import MonkIcon from "@/components/MonkIcon";
import { CheckDot } from "@/components/MonkHabitGrid";

export default function MonkTodayList({
  rows,
  day,
  readOnly = false,
}: {
  rows: MonkHabitDay[];
  day: string;
  readOnly?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-muted">No habits yet.</p>;
  }

  return (
    <ul className="-mx-2">
      {rows.map((row) => {
        const accent = monkAccent(row.habit.accent);
        const complete = row.status === "complete";
        return (
          <li key={row.habit.id}>
            <form action={bumpMonkHabit.bind(null, row.habit.id, day)}>
              <button
                type="submit"
                disabled={readOnly}
                title={
                  readOnly
                    ? "Not editable"
                    : complete
                      ? "Done — tap to clear"
                      : "Log one"
                }
                className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2.5 text-left transition-colors hover:bg-wash/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:hover:bg-transparent"
              >
                <span className={`shrink-0 ${accent.text}`}>
                  <MonkIcon name={row.habit.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {row.habit.name}
                </span>
                {/* The count only appears where there is a count to show. A
                    one-a-day habit says "Done" or "Not yet" and nothing else —
                    "1 / 1" is a fraction nobody needed. */}
                {row.target > 1 && (
                  <span
                    className={`num shrink-0 text-xs font-medium ${
                      complete ? "text-ok" : "text-muted"
                    }`}
                  >
                    {row.done} / {row.target}
                  </span>
                )}
                <span
                  className={`shrink-0 text-xs ${complete ? "text-ok" : "text-muted"}`}
                >
                  {complete ? "Done" : row.status === "missed" ? "Missed" : "Not yet"}
                </span>
                <CheckDot filled={complete} missed={row.status === "missed"} />
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
