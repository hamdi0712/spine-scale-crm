import Link from "next/link";
import { prisma } from "@/lib/prisma";
import KanbanBoard, { KanbanLead } from "@/components/KanbanBoard";
import LeadTable from "@/components/LeadTable";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const view = searchParams.view === "table" ? "table" : "board";
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
  }));

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Pipeline</h1>
          <p className="mt-0.5 text-sm text-muted">
            Clinics in play — drag cards between stages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-line">
            <Link
              href="/pipeline"
              className={`px-3 py-1.5 text-sm ${
                view === "board"
                  ? "bg-surface font-medium text-ink"
                  : "text-muted hover:text-ink"
              }`}
            >
              Board
            </Link>
            <Link
              href="/pipeline?view=table"
              className={`border-l border-line px-3 py-1.5 text-sm ${
                view === "table"
                  ? "bg-surface font-medium text-ink"
                  : "text-muted hover:text-ink"
              }`}
            >
              Table
            </Link>
          </div>
          <Link href="/pipeline/new" className="btn-primary">
            New lead
          </Link>
        </div>
      </div>

      <div className="mt-6">
        {view === "board" ? (
          <KanbanBoard leads={serialized} />
        ) : (
          <LeadTable leads={serialized} />
        )}
      </div>
    </div>
  );
}
