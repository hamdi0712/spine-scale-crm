// The day's journal entry: a textarea and a save button, one note per day.
//
// Editable all day and a read-only record once the day has ended — the same
// rule the daily checklist follows, and stated here in the copy as well as
// enforced in the action (saveMonkNote). A past day with nothing written on it
// says so rather than showing an empty box somebody might try to fill.
//
// No client JavaScript: one form, one server action, and the saved note comes
// back as the textarea's value on the next render.

import { IconSparkles } from "@tabler/icons-react";
import { saveMonkNote } from "@/lib/actions/monkMode";
import Icon from "@/components/Icons";

export default function MonkNote({
  day,
  content,
  readOnly = false,
  rows = 4,
  // Fill the card rather than sitting at a fixed number of rows. On the
  // dashboard this panel stands in a row of four that share a height, and a
  // textarea that stops short of the card's foot leaves a band of empty
  // surface under it — `rows` becomes the minimum and the box takes the rest.
  grow = false,
}: {
  day: string;
  content: string | null;
  readOnly?: boolean;
  rows?: number;
  grow?: boolean;
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
    <form
      action={saveMonkNote.bind(null, day)}
      className={grow ? "flex flex-1 flex-col" : undefined}
    >
      <textarea
        name="content"
        rows={rows}
        defaultValue={content ?? ""}
        placeholder="How was your day?"
        className={`field leading-relaxed ${
          grow ? "min-h-0 flex-1 resize-none" : "resize-y"
        }`}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <button type="submit" className="btn h-[36px] px-3.5 text-xs">
          <Icon name="check" className="h-3.5 w-3.5" />
          Save
        </button>
        {/* The sticker, and the line it replaced. "Editable today only" was
            the rule stated as a warning; the rule has not changed and it is
            still enforced in the action, but on the card it is now the title
            attribute of something that says the encouraging half out loud.
            Handwritten and tilted because a sticker that is set in the UI face
            and squared up to the grid is not a sticker, it is a label. */}
        <span
          // Lavender rather than the badge gold. It is the one handwritten
          // thing on the page and it should read as a note somebody stuck
          // there, not as another status pill — and the violet is the app's
          // own --c-ai. The dark value is lifted to the brighter end of that
          // pair, because the mixed-for-paper violet goes muddy on a dark card.
          className="monk-sticker flex shrink-0 items-center gap-1 whitespace-nowrap text-ai dark:text-[#C9B6FF]"
          title="Editable today only — past days are kept as they were left"
          aria-hidden
        >
          <IconSparkles size={12} stroke={2} className="shrink-0" />
          <span className="font-hand text-[15px] font-bold leading-none">
            Better Than Yesterday
          </span>
        </span>
      </div>
    </form>
  );
}
