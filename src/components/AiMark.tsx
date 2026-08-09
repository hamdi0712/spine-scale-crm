// The gradient sparkle that stands at the head of an AI panel.
//
// The second half of the pair <AiButton> starts: the button is the thing you
// press, this is the thing that says a panel's contents came from a model. Both
// wear the same violet gradient and the same sparkle, so a card marked with
// this and a button inside it read as one feature rather than two purple
// things that happen to share a page.
//
// Two sizes, because the two panels that use it have differently sized titles
// and a mark taller than the words beside it stops being a mark. The look is
// .ai-mark in src/app/globals.css; this carries the icon and the footprint.

import { IconSparkles } from "@tabler/icons-react";

// "lg" matches the 36px tinted icon squares on the dashboard's KPI cards, so
// the AI card's head sits level with the row above it. "sm" is for a panel
// titled in body text rather than a display heading.
export default function AiMark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const large = size === "lg";
  return (
    <span
      className={`ai-mark ${large ? "h-9 w-9" : "h-7 w-7"}`}
      aria-hidden
    >
      <IconSparkles size={large ? 19 : 15} stroke={1.75} />
    </span>
  );
}
