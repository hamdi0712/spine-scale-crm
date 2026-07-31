// Signature element: segmented capsule bar for a client's delivery checklist.
// One segment per item inside a rounded capsule; segments fill with the
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
    <div className="flex items-center gap-2.5">
      <div
        className={`flex flex-1 gap-px overflow-hidden rounded-full ${
          size === "lg" ? "h-3.5" : "h-2"
        }`}
        role="img"
        aria-label={`${done} of ${items.length} checklist items done`}
      >
        {items.map((item, i) => (
          <div
            key={i}
            title={item.title}
            className={`flex-1 ${
              item.status === "DONE"
                ? "bg-accent"
                : item.status === "IN_PROGRESS"
                  ? "bg-accent/30"
                  : "bg-line"
            }`}
          />
        ))}
      </div>
      <span className="shrink-0 font-mono text-xs text-muted">
        {done}/{items.length}
      </span>
    </div>
  );
}
