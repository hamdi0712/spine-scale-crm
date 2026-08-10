// The Recent activity card's list. A server component: the relative
// timestamps are rendered once, on the server, alongside the rows they belong
// to — nothing here ticks.

import Link from "next/link";
import { activityIcon, fmtRelative } from "@/lib/activity";
import EmptyMark from "@/components/EmptyMark";
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

// Just the rows. The hand-off to the full feed is the card header's "View
// all", placed like every other dashboard card's.
export default function ActivityFeed({
  entries,
  now,
  // The dashboard card draws its empty state as a composition — a glyph over
  // the copy. Off by default, so /activity, which is a page rather than a card
  // and has room to say more, keeps the plain paragraph it has always had.
  illustrateEmpty = false,
}: {
  entries: ActivityEntry[];
  now: Date;
  illustrateEmpty?: boolean;
}) {
  if (entries.length === 0) {
    // Two versions of the same sentence, because the two places it appears are
    // not the same size. The page has room to name all six events; the card is
    // a third of a dashboard row, where the full list set six lines of grey
    // under the glyph and turned an empty card into the heaviest thing on the
    // page. The short one names the shape of what lands here and leaves the
    // enumeration to the page the "View all" link goes to.
    return illustrateEmpty ? (
      <div className="px-2 py-8 text-center">
        <EmptyMark icon="activity" tone="blue" />
        <p className="mt-4 text-sm font-medium">No milestones logged yet</p>
        <p className="mx-auto mt-1 max-w-[15rem] text-xs leading-relaxed text-muted">
          Conversions, reports, contracts and invoices land here as they happen.
        </p>
      </div>
    ) : (
      <p className="py-6 text-sm text-muted">
        No milestones logged yet. Converting a lead, generating a report,
        signing a contract, collecting an invoice, a health change or finishing
        onboarding will each land here.
      </p>
    );
  }
  return (
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
  );
}
