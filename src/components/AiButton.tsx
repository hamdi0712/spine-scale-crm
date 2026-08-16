// The button every AI trigger wears.
//
// One control, one meaning: a violet pill with a sparkle on it asks the model
// something and costs a call. "Suggest remaining scores", "Generate outreach
// hook" and "Process queue" are all this button, and anything added later that
// spends a model call should be too — reach for this rather than restyling a
// .btn, so the next one matches without anybody having to remember the recipe.
//
// The look lives in .btn-ai (src/app/globals.css); this carries the icon and
// the type="button" default. Sizing is the primary button's, so the small
// 34px variant is the same override it is everywhere else — pass it through
// className, exactly as `btn h-[34px] px-3.5 text-xs` does elsewhere:
//
//   <AiButton className="h-[34px] px-3.5 text-xs" onClick={…}>…</AiButton>
//
// type="button" sits before the spread on purpose: these render inside forms
// (the lead's details form holds two of them), where a default submit would
// save the record as a side effect of asking for a suggestion. A caller that
// genuinely wants a submit can still pass type.

import { IconSparkles } from "@tabler/icons-react";

export default function AiButton({
  children,
  className = "",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button type="button" {...props} className={`btn-ai ${className}`}>
      {/* 1.75 stroke, as everywhere Tabler meets the in-house set. Marked
          aria-hidden: the label says what the button does, and "sparkles"
          read out before it would only get in the way. */}
      <IconSparkles
        size={16}
        stroke={1.75}
        aria-hidden
        className="btn-ai-spark shrink-0"
      />
      {/* Wrapped so the label can be clipped out of the rim's gradient while
          the sparkle beside it stays teal. Rendered only when there is a
          label: the collapsed sidebar and the copilot's send button are icon
          only, and an empty gradient span would still take the gap. */}
      {children != null && children !== false && (
        <span className="btn-ai-label">{children}</span>
      )}
    </button>
  );
}
