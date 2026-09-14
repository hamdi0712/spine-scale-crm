// The habit list, as something you edit.
//
// The daily checklist's routine is a constant in code, on the reasoning that a
// routine you can edit is a routine you stop following. This list is the
// opposite case and deliberately so: it is one person's own non-negotiables,
// not the shape of a working day, and the seven that arrive with it are a
// starting point rather than the content of the feature.
//
// No client JavaScript. Each row's editor is a <details> — the browser's own
// disclosure — so opening one to change a name needs no state, no hydration
// and no library. Every form posts to a server action bound to the row it
// belongs to.

import {
  MAX_DAILY_TARGET,
  MONK_ACCENTS,
  MONK_ICONS,
  MonkHabit,
  monkAccent,
} from "@/lib/monkMode";
import {
  addMonkHabit,
  deleteMonkHabit,
  moveMonkHabit,
  setMonkHabitActive,
  updateMonkHabit,
} from "@/lib/actions/monkMode";
import Icon from "@/components/Icons";
import MonkIcon from "@/components/MonkIcon";

export default function MonkHabitSettings({ habits }: { habits: MonkHabit[] }) {
  const active = habits.filter((h) => h.active);
  const retired = habits.filter((h) => !h.active);

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex items-center justify-between gap-3 border-b border-line/60 px-6 py-4">
          <div>
            <h2 className="display text-xl font-semibold">Your non-negotiables</h2>
            <p className="mt-0.5 text-xs text-muted">
              The habits on the dashboard, in the order they are drawn there
            </p>
          </div>
          <span className="chip-stat">
            {active.length} active
          </span>
        </div>

        {active.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted">
            No active habits. Add one below.
          </p>
        ) : (
          <ul>
            {active.map((habit, i) => (
              <HabitRow
                key={habit.id}
                habit={habit}
                first={i === 0}
                last={i === active.length - 1}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Retired habits, kept on the page rather than hidden: they are the
          reason a day last week counted eight habits and today counts seven,
          and somebody looking at an old week should be able to find out why
          without opening the database. */}
      {retired.length > 0 && (
        <section className="card">
          <div className="border-b border-line/60 px-6 py-4">
            <h2 className="display text-xl font-semibold">Retired</h2>
            <p className="mt-0.5 text-xs text-muted">
              Off the grid and out of the scoring. Their history is untouched
              and they can come back.
            </p>
          </div>
          <ul>
            {retired.map((habit) => (
              <li
                key={habit.id}
                className="flex items-center gap-3 border-b border-line/60 px-6 py-3 last:border-b-0"
              >
                <span className="shrink-0 text-muted">
                  <MonkIcon name={habit.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">
                  {habit.name}
                </span>
                <form action={setMonkHabitActive.bind(null, habit.id, true)}>
                  <button type="submit" className="btn h-[34px] px-3 text-xs">
                    Restore
                  </button>
                </form>
                <DeleteButton id={habit.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-6">
        <h2 className="display text-xl font-semibold">Add a habit</h2>
        <p className="mt-0.5 text-xs text-muted">
          It joins the end of the list and starts counting from today
        </p>
        <form action={addMonkHabit} className="mt-4">
          <HabitFields />
          <button type="submit" className="btn-primary mt-4">
            <Icon name="plus" className="h-4 w-4" />
            Add habit
          </button>
        </form>
      </section>
    </div>
  );
}

function HabitRow({
  habit,
  first,
  last,
}: {
  habit: MonkHabit;
  first: boolean;
  last: boolean;
}) {
  const accent = monkAccent(habit.accent);
  return (
    <li className="border-b border-line/60 last:border-b-0">
      <div className="flex items-center gap-3 px-6 py-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${accent.soft} ${accent.text}`}
        >
          <MonkIcon name={habit.icon} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {habit.name}
          </span>
          {habit.description && (
            <span className="mt-0.5 block truncate text-xs text-muted">
              {habit.description}
            </span>
          )}
        </span>
        {habit.dailyTarget > 1 && (
          <span className="chip-stat num shrink-0">
            {habit.dailyTarget}× a day
          </span>
        )}

        {/* Reordering, as two one-press forms. The disabled ends stay in place
            rather than disappearing, so the row of controls does not change
            width as you move a habit up the list. */}
        <div className="flex shrink-0 items-center">
          <MoveButton id={habit.id} direction="up" disabled={first} />
          <MoveButton id={habit.id} direction="down" disabled={last} />
        </div>
      </div>

      {/* The editor. Closed by default — this page is read far more often than
          it is written to, and seven open forms is not a list. */}
      <details className="group px-6 pb-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-accent">
          <Icon
            name="chevronRight"
            className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
          />
          Edit
        </summary>
        <form action={updateMonkHabit.bind(null, habit.id)} className="mt-3">
          <HabitFields habit={habit} />
          <button type="submit" className="btn mt-4 h-[38px] px-4 text-xs">
            Save changes
          </button>
        </form>
        {/* Retiring and deleting sit outside the edit form rather than inside
            it. They are forms of their own — a form cannot contain another one
            — and they are not edits: one takes the habit off the grid and the
            other takes it off the record. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form action={setMonkHabitActive.bind(null, habit.id, false)}>
            <button
              type="submit"
              className="btn-ghost h-[38px] px-4 text-xs"
              title="Takes it off the grid and out of the scoring, and keeps every day it was done"
            >
              Retire
            </button>
          </form>
          <DeleteButton id={habit.id} />
        </div>
      </details>
    </li>
  );
}

// The fields an add and an edit share, so the two cannot offer different
// choices of icon or disagree about what a target may be.
function HabitFields({ habit }: { habit?: MonkHabit }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="field-label" htmlFor={`name-${habit?.id ?? "new"}`}>
          Name
        </label>
        <input
          id={`name-${habit?.id ?? "new"}`}
          name="name"
          required
          maxLength={60}
          defaultValue={habit?.name ?? ""}
          placeholder="30 Minute Exercise"
          className="field"
        />
      </div>
      <div className="sm:col-span-2">
        <label
          className="field-label"
          htmlFor={`description-${habit?.id ?? "new"}`}
        >
          Description <span className="font-normal">— optional</span>
        </label>
        <input
          id={`description-${habit?.id ?? "new"}`}
          name="description"
          maxLength={80}
          defaultValue={habit?.description ?? ""}
          placeholder="Stronger body. Sharper mind."
          className="field"
        />
      </div>
      <div>
        <label className="field-label" htmlFor={`icon-${habit?.id ?? "new"}`}>
          Icon
        </label>
        <select
          id={`icon-${habit?.id ?? "new"}`}
          name="icon"
          defaultValue={habit?.icon ?? "target"}
          className="field"
        >
          {MONK_ICONS.map((icon) => (
            <option key={icon.key} value={icon.key}>
              {icon.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor={`accent-${habit?.id ?? "new"}`}>
          Colour
        </label>
        <select
          id={`accent-${habit?.id ?? "new"}`}
          name="accent"
          defaultValue={habit?.accent ?? "accent"}
          className="field"
        >
          {MONK_ACCENTS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor={`target-${habit?.id ?? "new"}`}>
          Times a day
        </label>
        <input
          id={`target-${habit?.id ?? "new"}`}
          name="dailyTarget"
          type="number"
          min={1}
          max={MAX_DAILY_TARGET}
          defaultValue={habit?.dailyTarget ?? 1}
          className="field num"
        />
        <p className="mt-1.5 text-[11px] text-muted">
          1 for most things. 5 for Salah.
        </p>
      </div>
    </div>
  );
}

function MoveButton({
  id,
  direction,
  disabled,
}: {
  id: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <form action={moveMonkHabit.bind(null, id, direction)}>
      <button
        type="submit"
        disabled={disabled}
        aria-label={direction === "up" ? "Move up" : "Move down"}
        className="rounded-[8px] p-1.5 text-muted hover:bg-wash hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        <Icon
          name="chevronLeft"
          className={`h-4 w-4 ${direction === "up" ? "rotate-90" : "-rotate-90"}`}
        />
      </button>
    </form>
  );
}

// Delete, next to Retire and losing the argument on purpose: retiring is the
// ordinary way to take a habit off the list, and this one really does take the
// history with it. The title says so at the button rather than in a
// confirmation nobody reads.
function DeleteButton({ id }: { id: string }) {
  return (
    <form action={deleteMonkHabit.bind(null, id)}>
      <button
        type="submit"
        className="btn-ghost h-[38px] px-4 text-xs text-bad hover:bg-bad-soft/60 hover:text-bad"
        title="Deletes the habit and every day it was logged on. Retire it instead to keep the history."
      >
        Delete
      </button>
    </form>
  );
}
