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
import { loadEmailQueue } from "@/lib/emailBucketsRead";
import { ownerJobEstimate } from "@/lib/actions/jobs";
import OwnerFindButton, { OwnerFindProgress } from "@/components/OwnerFindButton";
import FindLeadOwnerButton from "@/components/FindLeadOwnerButton";

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
  // Email has its own queue: leads not ready for the Email pipeline yet.
  if (channel === "email") return <EmailQueue />;
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
            Qualified LinkedIn leads nobody has written to yet — A and B tier, still at
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

// The Email queue: one list of email leads not ready to write to. Every lead
// goes through the same steps — Find owners, then the email lookup. With a
// usable address and the recipient settled it moves to the Email pipeline;
// with nothing found it moves to the pipeline as a Contact form lead when the
// clinic has a form, or to the Call list when it has none
// (src/lib/emailBuckets.ts).
async function EmailQueue() {
  const [{ queue }, owners] = await Promise.all([loadEmailQueue(), ownerJobEstimate()]);
  return (
    <div className="wide-format">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="display text-[32px] font-semibold">Email queue</h1>
            <ChannelToggle channel="email" cookie={OUTREACH_CHANNEL_COOKIE} label="Outreach Queue channel" />
          </div>
          <p className="helper-text page-sub mt-1.5 text-sm text-muted">
            Email leads without a confirmed owner or a usable address yet — they move to the{" "}
            <Link href="/pipeline" className="underline">Email pipeline</Link> once they have both
          </p>
        </div>
        <PageActions className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
          <span className="num text-xs text-muted">
            {queue.length} in the queue
          </span>
          <OwnerFindButton estimate={owners} plain />
        </PageActions>
      </div>

      <OwnerFindProgress className="mt-6" />

      {queue.length === 0 ? (
        <div className="card mt-8 px-6 py-10 text-center">
          <p className="text-sm font-medium">The queue is empty</p>
          <p className="helper-text mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted">
            Every email lead has moved on: to the Email pipeline (with an address, or as a Contact form lead) or to the Call list.
          </p>
        </div>
      ) : (
        <ul className="card mt-6 divide-y divide-line">
          {queue.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <Link href={`/pipeline/${l.id}`} className="text-sm font-medium hover:underline">
                  {l.clinicName}
                </Link>
                {l.icpTier && <span className="num ml-2 text-xs text-muted">{l.icpTier}</span>}
                <p className="truncate text-xs text-muted">
                  {[l.contactName, l.email ? `${l.email} · ${l.emailDetail}` : null, l.location].filter(Boolean).join(" · ") || "Nothing yet"}
                </p>
                <p className="text-xs font-medium text-warn">{l.reason}</p>
              </div>
              {l.canFind ? (
                <FindLeadOwnerButton leadId={l.id} />
              ) : (
                <Link href={`/pipeline/${l.id}`} className="btn h-8 px-3 text-sm">
                  Open lead
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
