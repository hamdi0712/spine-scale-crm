import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { leadTier } from "@/lib/icp";
import KanbanBoard, { KanbanLead } from "@/components/KanbanBoard";
import LeadTable from "@/components/LeadTable";

export const dynamic = "force-dynamic";

// What the CSV import redirects back with. Counts travel in the URL rather
// than in a session, so a refresh shows the same result and nothing about the
// import needs to be stored.
function importSummary(params: {
  imported?: string;
  duplicates?: string;
  skipped?: string;
}): { headline: string; detail: string | null } | null {
  if (params.imported === undefined) return null;
  const count = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const created = count(params.imported);
  const duplicates = count(params.duplicates);
  const skipped = count(params.skipped);

  const parts: string[] = [];
  if (duplicates > 0) {
    parts.push(
      `${duplicates} skipped as ${duplicates === 1 ? "a duplicate" : "duplicates"} — same clinic and contact name`,
    );
  }
  if (skipped > 0) {
    parts.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped`);
  }
  return {
    headline:
      created === 0
        ? "No new leads imported."
        : `Imported ${created} lead${created === 1 ? "" : "s"}.`,
    detail: parts.length > 0 ? `${parts.join(" · ")}.` : null,
  };
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: {
    view?: string;
    imported?: string;
    duplicates?: string;
    skipped?: string;
  };
}) {
  const view = searchParams.view === "table" ? "table" : "board";
  const summary = importSummary(searchParams);
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
    // Derived here so the board and table stay presentational.
    icpTier: leadTier(l),
  }));

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="display text-[32px] font-semibold">Pipeline</h1>
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
          <Link href="/pipeline/import" className="btn">
            Import leads
          </Link>
          <Link href="/pipeline/new" className="btn-primary">
            New lead
          </Link>
        </div>
      </div>

      {summary && (
        <div className="mt-6 rounded-[10px] border border-ok/30 bg-ok-soft/60 px-4 py-3">
          <p className="num text-sm font-medium">{summary.headline}</p>
          {summary.detail && (
            <p className="num mt-0.5 text-xs leading-relaxed text-muted">
              {summary.detail}
            </p>
          )}
        </div>
      )}

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
