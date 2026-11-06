import Link from "next/link";

// Lost leads are hidden from the Pipeline by default — table, board, Email
// view and every count — and are one press away through a "Lost" filter.
// A search by clinic name still finds them, tagged with LostTag, so a lead
// marked Lost by mistake can always be found and reopened.

export function isLost(stage: string): boolean {
  return stage === "LOST";
}

export function LostTag() {
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center rounded-md border border-line bg-wash px-1.5 py-px align-middle text-[11px] font-medium text-muted">
      Lost
    </span>
  );
}

// "12 Lost leads hidden — show". Either a button (onShow) or a link (href).
export function LostHiddenLine({
  count,
  onShow,
  href,
  className = "",
}: {
  count: number;
  onShow?: () => void;
  href?: string;
  className?: string;
}) {
  if (count <= 0) return null;
  const label = `${count} Lost lead${count === 1 ? "" : "s"} hidden`;
  const cls = "font-medium text-accent hover:underline";
  return (
    <p className={`text-xs text-muted ${className}`}>
      {label} —{" "}
      {href ? (
        <Link href={href} className={cls}>
          show
        </Link>
      ) : (
        <button type="button" onClick={onShow} className={cls}>
          show
        </button>
      )}
    </p>
  );
}
