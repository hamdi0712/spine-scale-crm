import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  discoveryQueue,
  processDiscoveryCandidate,
} from "@/lib/actions/discovery";
import { DISCOVERY_QUEUE_STATUSES } from "@/lib/discovery";
import { IcpTier } from "@/lib/icp";
import DiscoveryQueue from "@/components/DiscoveryQueue";
import DiscoveryTable, { DiscoveryRow } from "@/components/DiscoveryTable";

export const dynamic = "force-dynamic";

// What the import redirects back with. Counts travel in the URL rather than in
// a session, so a refresh shows the same result and nothing about the import
// needs to be stored.
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
      `${duplicates} skipped as ${duplicates === 1 ? "a duplicate" : "duplicates"} — same clinic and contact name already in Discovery or the pipeline`,
    );
  }
  if (skipped > 0) {
    parts.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped`);
  }
  return {
    headline:
      created === 0
        ? "No new candidates imported."
        : `Imported ${created} candidate${created === 1 ? "" : "s"} — none of them scored yet.`,
    detail: parts.length > 0 ? `${parts.join(" · ")}.` : null,
  };
}

// The one line of "why" the table shows per row, chosen by what the row's
// status actually means. A pending candidate has no reasoning yet and says so
// with nothing rather than with a dash of explanation it hasn't earned.
function reasonFor(candidate: {
  status: string;
  disqualifiedReason: string | null;
  failureReason: string | null;
}): string | null {
  if (candidate.status === "FAILED") return candidate.failureReason;
  if (candidate.status === "REJECTED") return candidate.disqualifiedReason;
  return null;
}

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: {
    imported?: string;
    duplicates?: string;
    skipped?: string;
  };
}) {
  const summary = importSummary(searchParams);
  const [candidates, queued, rejected] = await Promise.all([
    prisma.discoveryCandidate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.discoveryCandidate.count({
      where: { status: { in: DISCOVERY_QUEUE_STATUSES } },
    }),
    prisma.discoveryCandidate.count({ where: { status: "REJECTED" } }),
  ]);

  const rows: DiscoveryRow[] = candidates.map((c) => ({
    id: c.id,
    clinicName: c.clinicName,
    contactName: c.contactName,
    source: c.source,
    location: c.location,
    status: c.status,
    icpTotal: c.icpTotal,
    // The tier is stored on a candidate rather than derived, so it is read
    // back the same way — see the note at the top of src/lib/discovery.ts.
    icpTier: (c.icpTier as IcpTier | null) ?? null,
    reason: reasonFor(c),
    promotedLeadId: c.promotedLeadId,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="display text-[32px] font-semibold">Discovery</h1>
          <p className="mt-1.5 text-sm text-muted">
            Scraped clinics waiting to be qualified — nothing reaches the
            pipeline from here without a score
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/discovery/rejected" className="btn">
            Rejected{rejected > 0 && <span className="num">({rejected})</span>}
          </Link>
          <Link href="/discovery/import" className="btn">
            Import CSV
          </Link>
          <Link href="/discovery/import/apify" className="btn">
            Import from Apify
          </Link>
          <DiscoveryQueue
            loadQueue={discoveryQueue}
            process={processDiscoveryCandidate}
            queued={queued}
          />
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

      {candidates.length === 0 ? (
        <div className="card mt-8 px-6 py-10 text-center">
          <p className="text-sm font-medium">Nothing in Discovery yet</p>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted">
            Imports land here rather than in the pipeline. Bring in a CSV export
            or run an Apify actor, then press Process queue — each candidate is
            enriched, scored against the ICP framework, and either promoted to a
            lead or rejected with its reasoning kept.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/discovery/import" className="btn">
              Import CSV
            </Link>
            <Link href="/discovery/import/apify" className="btn-primary">
              Import from Apify
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <DiscoveryTable rows={rows} />
        </div>
      )}
    </div>
  );
}
