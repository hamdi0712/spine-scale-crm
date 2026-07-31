// Signature element: segmented capsule bar for a client's delivery checklist.
// One segment per item inside an 8px rounded capsule; segments fill with the
// primary accent on a light gray track as items complete. In-progress items
// render at reduced opacity.

interface Segment {
  title: string;
  status: string; // NOT_STARTED | IN_PROGRESS | DONE
}

export default function CapsuleBar({
  items,
  size = "sm",
}: {
  items: Segment[];
  size?: "sm" | "lg";
}) {
  if (items.length === 0) {
    return <div className="text-xs text-muted">No checklist items</div>;
  }
  const done = items.filter((i) => i.status === "DONE").length;
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-2 flex-1 gap-[3px] overflow-hidden rounded-full"
        role="img"
        aria-label={`${done} of ${items.length} checklist items done`}
      >
        {items.map((item, i) => (
          <div
            key={i}
            title={item.title}
            className={`flex-1 transition-colors duration-300 ${
              item.status === "DONE"
                ? "bg-accent"
                : item.status === "IN_PROGRESS"
                  ? "bg-accent/30"
                  : "bg-line"
            }`}
          />
        ))}
      </div>
      <span className="shrink-0 text-right text-xs text-muted">
        {done}/{items.length}
      </span>
    </div>
  );
}
