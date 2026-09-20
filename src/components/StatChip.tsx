// One figure from the header's metadata row, in its own pill.
//
// This replaces a sentence. The enrichment summary used to be one muted line of
// prose with middots in it — "Enriched 3w ago · Ads: 1 active ad · Reviews: 44"
// — which reads as a caption and scans as nothing: the three numbers in it are
// the whole point and none of them was louder than the punctuation between
// them. Split into pills, each figure gets a box, an icon to recognise it by,
// and the number in the page's ink weight while the words around it stay muted.
//
// Presentational and server-rendered: every value arrives already formatted, so
// there is no clock or locale in here to disagree with the server about.

import type { ReactNode } from "react";

export default function StatChip({
  icon,
  prefix,
  value,
  label,
  title,
  className = "",
}: {
  icon: ReactNode;
  // Words before the number, where the figure reads as a phrase rather than a
  // count — "Enriched 3w ago" against "44 reviews".
  prefix?: string;
  value: ReactNode;
  label?: string;
  title?: string;
  // A width cap, for the one chip whose value is free text rather than a
  // figure: the ads signal is a sentence often enough that it needs somewhere
  // to truncate, and truncation needs a bound to truncate against.
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-[10px] border border-line bg-wash/50 px-2.5 py-1.5 text-xs leading-none text-muted ${className}`}
    >
      <span className="shrink-0 text-muted/80" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 truncate">
        {prefix && <>{prefix} </>}
        <span className="num font-semibold text-ink">{value}</span>
        {label && <> {label}</>}
      </span>
    </span>
  );
}
