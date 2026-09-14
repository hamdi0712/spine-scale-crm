// The day's journal entry: a textarea and a save button, one note per day.
//
// Editable all day and a read-only record once the day has ended — the same
// rule the daily checklist follows, and stated here in the copy as well as
// enforced in the action (saveMonkNote). A past day with nothing written on it
// says so rather than showing an empty box somebody might try to fill.
//
// No client JavaScript: one form, one server action, and the saved note comes
// back as the textarea's value on the next render.

import { saveMonkNote } from "@/lib/actions/monkMode";
import Icon from "@/components/Icons";

export default function MonkNote({
  day,
  content,
  readOnly = false,
  rows = 4,
}: {
  day: string;
  content: string | null;
  readOnly?: boolean;
  rows?: number;
}) {
  if (readOnly) {
    return content ? (
      // Pre-wrapped rather than a paragraph: a journal entry is written with
      // its own line breaks in it, and collapsing them would be rewriting it.
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
        {content}
      </p>
    ) : (
      <p className="text-sm text-muted">
        Nothing written on this day.
      </p>
    );
  }

  return (
    <form action={saveMonkNote.bind(null, day)}>
      <textarea
        name="content"
        rows={rows}
        defaultValue={content ?? ""}
        placeholder="How was your day?"
        className="field resize-y leading-relaxed"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <button type="submit" className="btn h-[38px] px-4 text-xs">
          <Icon name="check" className="h-3.5 w-3.5" />
          Save note
        </button>
        <span className="text-[11px] text-muted">
          Editable today only
        </span>
      </div>
    </form>
  );
}
