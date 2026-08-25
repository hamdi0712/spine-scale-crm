import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { leadTier } from "@/lib/icp";
import KanbanBoard, { KanbanLead } from "@/components/KanbanBoard";
import LeadTable from "@/components/LeadTable";
import HistoryNav from "@/components/HistoryNav";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // The table is what loads. It is the view that answers the questions asked
  // most often of a pipeline — who is where, what is scored, what is due — and
  // it is the one that reads at forty rows as well as at four. The board is a
  // press away and is still where a stage gets changed by dragging.
  const view = searchParams.view === "board" ? "board" : "table";
  // The table's filters and sort live in the query string too, so the view
  // toggle carries whatever else is on the URL across rather than resetting a
  // narrowed list to everything.
  const withView = (next: "table" | "board") => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "view" || value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) {
        params.append(key, one);
      }
    }
    if (next === "board") params.set("view", "board");
    const qs = params.toString();
    return qs ? `/pipeline?${qs}` : "/pipeline";
  };
  const leads = await prisma.lead.findMany({
    where: { archived: false },
    orderBy: { updatedAt: "desc" },
  });

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
  }));

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="display text-[32px] font-semibold">Pipeline</h1>
          <p className="mt-1.5 text-sm text-muted">
            Clinics in play — every one of them scored before it got here
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Back and Forward, first in the row: the pipeline is read as a
              loop — narrow the list, open a lead, come back, open the next —
              and the filters travelling in the URL are what make Back land on
              the list as it was. */}
          <HistoryNav />
          {/* Table first, because table is what loads. A toggle whose second
              item is the default reads as though the first one were. */}
          <div className="segment">
            <Link
              href={withView("table")}
              className={`segment-item ${view === "table" ? "segment-item-on" : ""}`}
            >
              Table
            </Link>
            <Link
              href={withView("board")}
              className={`segment-item ${view === "board" ? "segment-item-on" : ""}`}
            >
              Board
            </Link>
          </div>
          {/* Imports live in Discovery now — nothing lands in the pipeline
              without a score, so bulk-adding straight to it is gone. */}
          <Link href="/discovery" className="btn">
            Discovery
          </Link>
          <Link href="/pipeline/new" className="btn-primary">
            New lead
          </Link>
        </div>
      </div>

      <div className="mt-8">
        {view === "board" ? (
          <KanbanBoard leads={serialized} />
        ) : (
          <LeadTable leads={serialized} />
        )}
      </div>
    </div>
  );
}
