import PageActions from "@/components/PageActions";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PIPELINE_DEFAULT_WHERE, PIPELINE_SCORING_REJECTED_WHERE } from "@/lib/liveLeadWhere";
import { leadTier, leadVerdictBadge } from "@/lib/leadScore";
import { FIRST_MESSAGE_MECHANISMS } from "@/lib/outreachSequence";
import { openerComparison } from "@/lib/outreachSequenceRead";
import { setMessageMechanism } from "@/lib/actions/outreachSequence";
import KanbanBoard, { KanbanLead } from "@/components/KanbanBoard";
import LeadTable from "@/components/LeadTable";
import { RecrawlOldLeads } from "@/components/LeadRecrawl";
import { FindEmailsByTier } from "@/components/FindEmails";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { stepCostPerCandidate } from "@/lib/pipelineSettings";
import MechanismPicker from "@/components/MechanismPicker";
import OpenerScoreboard from "@/components/OpenerScoreboard";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { view?: string; scoring?: string };
}) {
  // The table is what loads. It is the view that answers the questions asked
  // most often of a pipeline — who is where, what is scored, what is due — and
  // it is the one that reads at forty rows as well as at four. The board is a
  // press away and is still where a stage gets changed by dragging.
  const view =
    searchParams.view === "board"
      ? "board"
      : searchParams.view === "untagged"
        ? "untagged"
        : "table";
  // Leads flagged "Rejected by new scoring" are out of the default view and
  // found with their own filter (see src/lib/liveLeadWhere.ts).
  const scoringRejected = searchParams.scoring === "rejected";
  const recrawlCost = stepCostPerCandidate("websiteContent", await loadPipelineSettings());
  const [leads, scoringRejectedCount] = await Promise.all([
    prisma.lead.findMany({
      where: scoringRejected ? PIPELINE_SCORING_REJECTED_WHERE : PIPELINE_DEFAULT_WHERE,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.lead.count({ where: PIPELINE_SCORING_REJECTED_WHERE }),
  ]);

  // Every first message that has actually gone out, with the reply mark from
  // the lead it went to. Two questions come off this one read: which kind of
  // opener gets answered more often, and which sent messages never got tagged.
  const firstMessages = await prisma.outreachMessage.findMany({
    where: { step: "FIRST_MESSAGE", sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      leadId: true,
      content: true,
      messageMechanism: true,
      sentAt: true,
      lead: { select: { clinicName: true, repliedAt: true } },
    },
  });

  const comparison = openerComparison(
    firstMessages.map((m) => ({
      messageMechanism: m.messageMechanism,
      sentAt: m.sentAt,
      repliedAt: m.lead.repliedAt,
    })),
  );

  // The backfill list: sent, and carrying nothing this build recognises. Read
  // off the same rows rather than as a second query, because "untagged" has to
  // mean the same thing here as it does in the count beside the tab.
  const untagged = firstMessages.filter(
    (m) =>
      !(FIRST_MESSAGE_MECHANISMS as readonly string[]).includes(
        m.messageMechanism ?? "",
      ),
  );

  const serialized: KanbanLead[] = leads.map((l) => ({
    id: l.id,
    clinicName: l.clinicName,
    contactName: l.contactName,
    leadSource: l.leadSource,
    stage: l.stage,
    estValue: l.estValue,
    nextFollowUp: l.nextFollowUp ? l.nextFollowUp.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
    linkedinUrl: l.linkedinUrl,
    companyLinkedinUrl: l.companyLinkedinUrl,
    connectionRequestSentAt: l.connectionRequestSentAt
      ? l.connectionRequestSentAt.toISOString()
      : null,
    // Derived here so the board and table stay presentational.
    icpTier: leadTier(l),
    icpVerdict: leadVerdictBadge(l),
  }));

  return (
    <div>
      <div className="flex items-end justify-between max-md:flex-col max-md:items-stretch max-md:gap-4">
        <div>
          <h1 className="display text-[32px] font-semibold">Pipeline</h1>
          <p className="helper-text mt-1.5 text-sm text-muted">
            Clinics in play — every one of them scored before it got here
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Table first, because table is what loads. A toggle whose second
              item is the default reads as though the first one were. */}
          <div className="segment">
            <Link
              href="/pipeline"
              className={`segment-item ${view === "table" && !scoringRejected ? "segment-item-on" : ""}`}
            >
              Table
            </Link>
            <Link
              href="/pipeline?view=board"
              className={`segment-item ${view === "board" ? "segment-item-on" : ""}`}
            >
              Board
            </Link>
            {/* Only while there is something to do here. A filter that is
                permanently empty is a tab that permanently says zero. */}
            {(untagged.length > 0 || view === "untagged") && (
              <Link
                href="/pipeline?view=untagged"
                className={`segment-item ${view === "untagged" ? "segment-item-on" : ""}`}
              >
                Untagged{" "}
                <span className="num ml-1 opacity-70">{untagged.length}</span>
              </Link>
            )}
            {(scoringRejectedCount > 0 || scoringRejected) && (
              <Link
                href="/pipeline?scoring=rejected"
                className={`segment-item ${scoringRejected ? "segment-item-on" : ""}`}
              >
                <span className="max-md:hidden">Rejected by new scoring</span>
                <span className="md:hidden">Rejected</span>{" "}
                <span className="num ml-1 opacity-70">{scoringRejectedCount}</span>
              </Link>
            )}
          </div>
          {/* Imports live in Discovery now — nothing lands in the pipeline
              without a score, so bulk-adding straight to it is gone. */}
          {/* On a phone these two go into the top bar's ⋯ menu; the view
              toggle stays, because it is how the page is read. */}
          <PageActions className="contents">
            {/* A plain link rather than a Link: it is a file download, not a
                page, and the route answers with an attachment. */}
            <a href="/api/pipeline/export" download className="btn">
              Export for review
            </a>
            <Link href="/discovery" className="btn">
              Discovery
            </Link>
            <Link href="/pipeline/new" className="btn-primary">
              New lead
            </Link>
          </PageActions>
        </div>
      </div>

      {scoringRejected && (
        <div className="card mb-4 px-5 py-4 text-xs leading-relaxed max-md:px-3">
          <p className="font-medium">Rejected by new scoring</p>
          <p className="helper-text mt-0.5 text-muted">
            Flagged when new scoring was applied to existing records. They are
            hidden from the default view, Outreach and the dashboard until the
            apply is reverted in Settings → Pipeline.
          </p>
          <ul className="mt-2 space-y-1">
            {leads.map((l) => (
              <li key={l.id} className="break-words">
                <Link href={`/pipeline/${l.id}`} className="font-medium hover:underline">
                  {l.clinicName}
                </Link>
                <span className="text-muted"> — {l.scoringRejectedReason ?? "no reason recorded"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <OpenerScoreboard comparison={comparison} />

      <div className="mt-8">
        {view === "board" ? (
          <KanbanBoard leads={serialized} />
        ) : view === "untagged" ? (
          <UntaggedFirstMessages rows={untagged} />
        ) : (
          <>
            {!scoringRejected && <RecrawlOldLeads costPerClinic={recrawlCost} />}
            {!scoringRejected && <FindEmailsByTier />}
            <LeadTable leads={serialized} recrawlCostPerClinic={recrawlCost} />
          </>
        )}
      </div>
    </div>
  );
}

// The backfill list. Sent first messages carrying no opener type, each with the
// same select the lead page shows, so tagging the backlog is one pass down one
// page rather than eighteen visits to eighteen leads.
//
// Deliberately not auto-classified. A model reading these back and guessing
// which kind of opener each was would fill the column with its own guesses and
// make the comparison a measurement of those guesses; the whole value of the
// column is that a person who was there said so.
function UntaggedFirstMessages({
  rows,
}: {
  rows: {
    id: string;
    leadId: string;
    content: string;
    messageMechanism: string | null;
    sentAt: Date | null;
    lead: { clinicName: string; repliedAt: Date | null };
  }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="card px-6 py-8 text-center">
        <p className="text-sm font-medium text-ink">Nothing left untagged</p>
        <p className="helper-text mt-1 text-sm text-muted">
          Every first message that has gone out says which kind of opener it
          was, so the comparison above is reading all of them.
        </p>
      </div>
    );
  }

  return (
    <div className="card divide-y divide-line">
      <div className="px-6 py-4">
        <p className="text-sm font-medium text-ink">
          Sent first messages with no opener type
        </p>
        <p className="helper-text mt-1 text-sm text-muted">
          These went out before the type was recorded, so they are in neither
          group above. Read the opening line and tag it — nothing is guessed for
          you, because a guess in this column is what would make the comparison
          meaningless.
        </p>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="px-6 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Link
              href={`/pipeline/${row.leadId}`}
              className="text-sm font-medium text-ink hover:text-accent"
            >
              {row.lead.clinicName}
            </Link>
            <span className="num text-xs text-muted">
              {row.sentAt
                ? `Sent ${row.sentAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}`
                : ""}
              {row.lead.repliedAt ? " · replied" : ""}
            </span>
          </div>
          {/* The opener, which is the thing being judged. The rest of the
              message ends in a question either way, so it decides nothing. */}
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {row.content.length > 220
              ? `${row.content.slice(0, 220)}…`
              : row.content}
          </p>
          <div className="mt-2.5">
            <MechanismPicker
              value={null}
              set={setMessageMechanism.bind(null, row.leadId, row.id)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
