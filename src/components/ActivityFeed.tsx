// The Recent activity card's list. A server component: the relative
// timestamps are rendered once, on the server, alongside the rows they belong
// to — nothing here ticks.

import Link from "next/link";
import { activityIcon, fmtRelative } from "@/lib/activity";
import Icon from "@/components/Icons";

export interface ActivityEntry {
  id: string;
  kind: string;
  summary: string;
  createdAt: Date;
  href: string | null;
}

function Row({ entry, now }: { entry: ActivityEntry; now: Date }) {
  return (
    <div className="flex items-center gap-3 py-[11px]">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-accent/10 text-accent">
        <Icon name={activityIcon(entry.kind)} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{entry.summary}</span>
      <span className="num shrink-0 text-xs text-muted">
        {fmtRelative(entry.createdAt, now)}
      </span>
    </div>
  );
}

// `total` is how many entries exist in all, not just the ones handed over. The
// dashboard card passes it so the capped list can say how much there is and
// hand off to the full feed; the activity page shows everything and leaves it
// out, which is what keeps the link off the page it points at.
export default function ActivityFeed({
  entries,
  now,
  total,
}: {
  entries: ActivityEntry[];
  now: Date;
  total?: number;
}) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-sm text-muted">
        No milestones logged yet. Converting a lead, generating a report,
        signing a contract, collecting an invoice, a health change or finishing
        onboarding will each land here.
      </p>
    );
  }
  return (
    <div>
      <ul className="divide-y divide-line/60">
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.href ? (
              <Link href={entry.href} className="block hover:opacity-80">
                <Row entry={entry} now={now} />
              </Link>
            ) : (
              <Row entry={entry} now={now} />
            )}
          </li>
        ))}
      </ul>
      {/* Shown whenever a total was handed over, including when it matches
          what is already on screen: landing on a page listing the same rows
          costs nothing, and leaving the feed unreachable until it grows
          past the card does. */}
      {total !== undefined && (
        <Link
          href="/activity"
          className="mt-3 inline-block text-xs font-medium text-accent hover:underline"
        >
          View all ({total})
        </Link>
      )}
    </div>
  );
}
