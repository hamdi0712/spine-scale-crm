// The fixed daily routine, grouped by category.
//
// Same checklist-item row as the ad compliance gate — a square toggle on the
// left, the item filling the row — and for the same reason: every toggle is its
// own form posting to a server action, so the routine works with no client
// JavaScript at all. What it adds is the grouping, because the four categories
// are the order a day runs through rather than a way of tidying a long list.
//
// Nothing here knows about resetting. The page hands it one day's ticks; a new
// day is a new set of rows that arrive unticked (src/lib/dailyChecklistStore.ts),
// which is the whole of the reset.

import {
  DAILY_CHECKLIST_CATEGORIES,
  DAILY_CHECKLIST_CATEGORY_LABELS,
  DAILY_CHECKLIST_ITEMS,
  itemsInCategory,
} from "@/lib/dailyChecklist";
import { DailyBonus } from "@/lib/dailyBonus";
import { toggleDailyChecklistItem } from "@/lib/actions/dailyChecklist";
import Icon from "@/components/Icons";

export default function DailyChecklist({
  dayKey,
  checked,
  bonus,
  readOnly = false,
}: {
  dayKey: string;
  checked: Map<string, boolean>;
  // The day's reactive work, counted off the records rather than ticked. It
  // sits beside the score and never inside it — see src/lib/dailyBonus.ts.
  bonus: DailyBonus;
  // A past day is a record of what happened, not a thing to fill in now.
  readOnly?: boolean;
}) {
  const done = DAILY_CHECKLIST_ITEMS.filter((i) => checked.get(i.key)).length;
  const total = DAILY_CHECKLIST_ITEMS.length;
  const complete = done === total;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Icon
              name="checklist"
              className={`h-4 w-4 ${complete ? "text-ok" : "text-muted"}`}
            />
            Daily checklist
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {readOnly
              ? "A past day, as it was left. Ticks are only made on the day itself."
              : "The same routine every day, and only the parts of it you control. It starts empty each morning — yesterday's ticks stay on yesterday."}
          </p>
        </div>
        {/* The score and the bonus, on one line and in that order: the score
            is out of a fixed number and the bonus is not, so the bonus reads
            as an addition rather than as a second fraction. It is only drawn
            once there is something to draw — "+0" is the missing item this
            whole section exists to stop showing. */}
        <span className="shrink-0 text-xs font-medium">
          <span className={`num ${complete ? "text-ok" : "text-muted"}`}>
            {done} / {total}
          </span>
          {bonus.total > 0 && (
            <>
              <span className="px-1.5 text-muted">·</span>
              <span className="num text-accent">Bonus +{bonus.total}</span>
            </>
          )}
        </span>
      </div>

      {DAILY_CHECKLIST_CATEGORIES.map((category) => {
        const items = itemsInCategory(category);
        const groupDone = items.filter((i) => checked.get(i.key)).length;
        return (
          <div key={category}>
            {/* The category strip. Sits on the wash rather than carrying a
                heading weight of its own: it is a divider that happens to be
                named, and the items under it are what is being read. */}
            <div className="flex items-baseline justify-between border-b border-line/60 bg-wash/60 px-6 py-2">
              <span className="text-xs font-medium tracking-[0.02em] text-muted">
                {DAILY_CHECKLIST_CATEGORY_LABELS[category]}
              </span>
              <span className="num text-xs text-muted">
                {groupDone} / {items.length}
              </span>
            </div>
            <ul>
              {items.map((item) => {
                const isChecked = checked.get(item.key) ?? false;
                return (
                  <li
                    key={item.key}
                    className="row-hover min-h-[48px] border-b border-line/60 px-4 py-2.5 last:border-b-0 hover:bg-wash/60"
                  >
                    <div className="flex items-center gap-3">
                      <form
                        action={toggleDailyChecklistItem.bind(
                          null,
                          dayKey,
                          item.key,
                        )}
                      >
                        <button
                          type="submit"
                          disabled={readOnly}
                          title={
                            readOnly
                              ? "A past day — not editable"
                              : isChecked
                                ? "Checked — click to clear"
                                : "Mark as done"
                          }
                          className={`check-box flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${
                            isChecked
                              ? "border-ok bg-ok-soft text-ok"
                              : "border-line text-transparent"
                          } ${
                            readOnly
                              ? "cursor-default opacity-60"
                              : isChecked
                                ? ""
                                : "hover:bg-wash hover:text-muted/40"
                          }`}
                        >
                          <Icon name="check" className="h-3 w-3" />
                          <span className="sr-only">
                            {isChecked ? "Checked" : "Not checked"}
                          </span>
                        </button>
                      </form>
                      <span
                        className={`check-label min-w-0 flex-1 text-sm ${
                          isChecked ? "text-muted" : ""
                        }`}
                      >
                        {item.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {/* Bonus sits under Conversations because it is what conversations
                produced. Rows rather than checkboxes, and no denominator: none
                of it was on offer until somebody else moved, so there is
                nothing here to have failed to do. */}
            {category === "CONVERSATIONS" && (
              <BonusSection bonus={bonus} readOnly={readOnly} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// The automatic half of the Conversations group.
//
// Same row metrics as the ticked items above it, with the checkbox's place
// taken by the count that earned the points — so the two halves line up as one
// list rather than reading as a widget dropped into the card.
function BonusSection({
  bonus,
  readOnly,
}: {
  bonus: DailyBonus;
  readOnly: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-y border-line/60 bg-wash/60 px-6 py-2">
        <span className="text-xs font-medium tracking-[0.02em] text-muted">
          Bonus points — counted, not ticked
        </span>
        <span
          className={`num text-xs font-medium ${
            bonus.total > 0 ? "text-accent" : "text-muted"
          }`}
        >
          +{bonus.total}
        </span>
      </div>
      <ul>
        {bonus.rows.map((row) => (
          <li
            key={row.key}
            className="row-hover min-h-[48px] border-b border-line/60 px-4 py-2.5 last:border-b-0 hover:bg-wash/60"
          >
            <div className="flex items-center gap-3">
              {/* Where a checkbox would be. A count, not a control: there is
                  nothing to press, and the number is the whole of the record. */}
              <span
                className={`num flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-medium ${
                  row.count > 0
                    ? "bg-accent-soft text-accent"
                    : "bg-wash text-muted"
                }`}
                aria-hidden
              >
                {row.count}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                {row.label}
                <span className="ml-1.5 text-xs text-muted">
                  {row.points} {row.points === 1 ? "pt" : "pts"} each
                </span>
              </span>
              <span
                className={`num shrink-0 text-xs font-medium ${
                  row.earned > 0 ? "text-accent" : "text-muted"
                }`}
              >
                +{row.earned}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-b border-line/60 px-6 py-2.5 text-xs leading-relaxed text-muted">
        {readOnly
          ? "Counted off that day's records — replies, audit offers, Looms and follow-ups that actually happened."
          : "Added automatically as replies, audit offers, Looms and follow-ups land today. Nothing here is ticked, and a quiet day costs nothing."}
      </p>
    </div>
  );
}
