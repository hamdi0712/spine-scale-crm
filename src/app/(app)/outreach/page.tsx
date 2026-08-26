import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ICP_MAX_SCORE, IcpTier, leadTier, scoreIcp } from "@/lib/icp";
import { fmtDate } from "@/lib/format";
import { IcpScoreBadge } from "@/components/Badge";
import Icon from "@/components/Icons";
import { LeadLocalTime } from "@/components/Clock";

export const dynamic = "force-dynamic";

// The Outreach Queue — every qualified lead nobody has written to yet.
//
// It is one question asked of the pipeline rather than a stage of its own:
// which of the leads worth pursuing has had nothing sent to it. That is stage
// New (nothing has moved it, so nothing has gone out) and an ICP tier of A or
// B (the two the framework says to pursue). C-tier, disqualified and unscored
// leads never appear here at all — this is a list to work down, and anything
// on it that was not worth a message would make the list worth less.
//
// Cards rather than a table, and the same cards Discovery draws: this is read
// the way Discovery is read — one record at a time, scanning for the next one
// to open — not scanned down a column. The whole card opens the lead.

// The two tiers this page exists for.
const OUTREACH_TIERS: IcpTier[] = ["A", "B"];

export default async function OutreachQueuePage() {
  const leads = await prisma.lead.findMany({
    where: { archived: false, stage: "NEW" },
    orderBy: { createdAt: "desc" },
  });

  // The tier is derived from the scorecard on the lead rather than stored, so
  // the filter runs here rather than in the query — the same derivation the
  // pipeline uses, from the same helper.
  const rows = leads
    .map((l) => ({
      id: l.id,
      clinicName: l.clinicName,
      contactName: l.contactName,
      leadSource: l.leadSource,
      location: l.location,
      timeZone: l.timeZone,
      email: l.email,
      createdAt: l.createdAt.toISOString(),
      icpTier: leadTier(l),
      icpTotal: l.icpScoredAt ? scoreIcp(l).total : null,
    }))
    .filter((l) => l.icpTier !== null && OUTREACH_TIERS.includes(l.icpTier));

  return (
    <div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="display text-[32px] font-semibold">Outreach Queue</h1>
          <p className="mt-1.5 text-sm text-muted">
            Qualified leads nobody has written to yet — A and B tier, still at
            New
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
          <span className="num text-xs text-muted">
            {rows.length} lead{rows.length === 1 ? "" : "s"} waiting
          </span>
          <Link href="/pipeline" className="btn">
            Pipeline
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card mt-8 px-6 py-10 text-center">
          <p className="text-sm font-medium">Nothing waiting on a first message</p>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted">
            Every A- and B-tier lead in the pipeline has moved past New, which
            means every one of them has been contacted. New leads land here the
            moment Discovery promotes them.
          </p>
        </div>
      ) : (
        /* The same grid Discovery's cards sit in, for the same reason: the
           sidebar collapses under a window that does not change width, so the
           columns come off the room this grid has rather than off a viewport
           breakpoint. See the note in src/components/DiscoveryList.tsx. */
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] items-stretch gap-4">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/pipeline/${row.id}`}
              className="card card-interactive group flex flex-col p-4 hover:bg-wash/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <span
                    className="block truncate text-sm font-medium text-ink group-hover:underline"
                    title={row.clinicName}
                  >
                    {row.clinicName}
                  </span>
                  {/* Never a blank line where a person would be. A lead
                      promoted from a clinic-first candidate can arrive with
                      nobody named on it, and it says so in words — the name is
                      typed onto the lead when it is found. */}
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {row.contactName || (
                      <span className="text-muted/70">No contact yet</span>
                    )}
                  </p>
                </div>
                {/* The clock rides with the badge rather than down in the
                    meta rows: whether now is a reasonable hour to call is read
                    at the same moment as whether the lead is worth calling. */}
                <div className="flex shrink-0 items-center gap-2">
                  <LeadLocalTime timeZone={row.timeZone} />
                  <IcpScoreBadge
                    tier={row.icpTier}
                    total={row.icpTotal}
                    max={ICP_MAX_SCORE}
                  />
                </div>
              </div>

              <div className="mt-3.5 space-y-1.5">
                <CardMeta icon="building" value={row.leadSource} />
                <CardMeta icon="mapPin" value={row.location} />
                <CardMeta icon="mail" value={row.email} />
              </div>

              {/* mt-auto so the footers line up across a row of cards whose
                  middles are different heights. */}
              <div className="mt-auto flex items-center gap-2 pt-4">
                <span className="text-xs text-muted">Awaiting first contact</span>
                <span className="num ml-auto shrink-0 text-xs text-muted">
                  {fmtDate(row.createdAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// A fact about the lead, or nothing at all — the same rule Discovery's cards
// follow: an empty row of dashes says nothing, so the card just gets shorter.
function CardMeta({ icon, value }: { icon: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="flex items-center gap-2 text-xs text-muted">
      <Icon name={icon} className="h-3.5 w-3.5 text-muted/70" />
      <span className="min-w-0 truncate" title={value}>
        {value}
      </span>
    </p>
  );
}
