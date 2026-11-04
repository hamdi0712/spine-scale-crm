import PageActions from "@/components/PageActions";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { OUTREACH_QUEUE_WHERE } from "@/lib/liveLeadWhere";
import { IcpTier } from "@/lib/icp";
import { leadScore } from "@/lib/leadScore";
import { fmtDate } from "@/lib/format";
import { IcpScoreBadge } from "@/components/Badge";
import Icon from "@/components/Icons";
import OutreachList from "@/components/OutreachList";
import ChannelToggle from "@/components/ChannelToggle";
import { cookies } from "next/headers";
import { OUTREACH_CHANNEL_COOKIE, readPipelineChannel } from "@/lib/emailChannel";

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
  // Email or LinkedIn, one at a time, remembered per browser like Pipeline.
  const channel = readPipelineChannel(cookies().get(OUTREACH_CHANNEL_COOKIE)?.value);
  const leads = await prisma.lead.findMany({
    where: { ...OUTREACH_QUEUE_WHERE, channel },
    orderBy: { createdAt: "desc" },
  });

  // The tier is derived from the scorecard on the lead rather than stored, so
  // the filter runs here rather than in the query — the same derivation the
  // pipeline uses, from the same helper.
  const rows = leads
    .map((l) => ({ l, score: leadScore(l) }))
    .map(({ l, score }) => ({
      id: l.id,
      clinicName: l.clinicName,
      contactName: l.contactName,
      leadSource: l.leadSource,
      location: l.location,
      timeZone: l.timeZone,
      email: l.email,
      createdAt: l.createdAt.toISOString(),
      icpTier: score?.tier ?? null,
      // Out of 10 or out of 100, by which model scored the lead.
      icpTotal: score?.total ?? null,
      icpMax: score?.max ?? null,
    }))
    .filter((l) => l.icpTier !== null && OUTREACH_TIERS.includes(l.icpTier));

  return (
    <div className="wide-format">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="display text-[32px] font-semibold">Outreach Queue</h1>
            <ChannelToggle channel={channel} cookie={OUTREACH_CHANNEL_COOKIE} label="Outreach Queue channel" />
          </div>
          <p className="helper-text page-sub mt-1.5 text-sm text-muted">
            Qualified {channel === "email" ? "email" : "LinkedIn"} leads nobody has written to yet — A and B tier, still at
            New
          </p>
        </div>
        <PageActions className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
          <span className="num text-xs text-muted">
            {rows.length} lead{rows.length === 1 ? "" : "s"} waiting
          </span>
          <Link href="/pipeline" className="btn">
            Pipeline
          </Link>
        </PageActions>
      </div>

      {rows.length === 0 ? (
        <div className="card mt-8 px-6 py-10 text-center">
          <p className="text-sm font-medium">Nothing waiting on a first message</p>
          <p className="helper-text mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted">
            Every A- and B-tier lead in the pipeline has moved past New, which
            means every one of them has been contacted. New leads land here the
            moment Discovery promotes them.
          </p>
        </div>
      ) : (
        <OutreachList rows={rows} />
      )}
    </div>
  );
}
