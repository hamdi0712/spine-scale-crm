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
          <h1 className="text-[32px] font-bold tracking-[-0.02em]">Pipeline</h1>
          <p className="mt-1.5 text-sm text-muted">
            Clinics in play — drag cards between stages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-[42px] items-center gap-1 rounded-[10px] border border-line bg-surface p-1">
            <Link
              href="/pipeline"
              className={`flex h-[32px] items-center rounded-lg px-3.5 text-sm ${
                view === "board"
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-muted hover:text-ink"
              }`}
            >
              Board
            </Link>
            <Link
              href="/pipeline?view=table"
              className={`flex h-[32px] items-center rounded-lg px-3.5 text-sm ${
                view === "table"
                  ? "bg-accent/10 font-medium text-accent"
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
