import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  addDiscoveryCandidateByName,
  discoveryQueue,
  processDiscoveryCandidate,
} from "@/lib/actions/discovery";
import { DISCOVERY_QUEUE_STATUSES } from "@/lib/discovery";
import { readDiscoverySourceKind } from "@/lib/clinicDiscovery";
import {
  DecisionMakerConfidence,
  isDecisionMakerConfidence,
} from "@/lib/decisionMaker";
import { IcpTier } from "@/lib/icp";
import AddClinicByName from "@/components/AddClinicByName";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import DiscoveryQueue from "@/components/DiscoveryQueue";
import DiscoveryList, { DiscoveryRow } from "@/components/DiscoveryList";
import HistoryNav from "@/components/HistoryNav";

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
  // The settings the queue quotes its estimate from — read here so the dialog
  // opens with a number rather than fetching one.
  const settings = await loadPipelineSettings();
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
    contactTitle: c.contactTitle,
    decisionMakerConfidence: isDecisionMakerConfidence(c.decisionMakerConfidence)
      ? (c.decisionMakerConfidence as DecisionMakerConfidence)
      : null,
    discoverySource: readDiscoverySourceKind(c.discoverySource),
    source: c.source,
    location: c.location,
    websiteUrl: c.websiteUrl,
    email: c.email,
    batchLabel: c.batchLabel,
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
      {/* Five actions is more than any other page header carries, so the row
          is built to take it. Wide enough for both, they share a line and the
          buttons keep their own width — the title column is the one that
          gives way, its subtitle wrapping to another line rather than every
          button wrapping onto two. Too narrow for both, the whole thing
          stacks: a shrink-0 row that never yields would push the page wider
          than the window instead. */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="display text-[32px] font-semibold">Discovery</h1>
          <p className="mt-1.5 text-sm text-muted">
            Scraped clinics waiting to be qualified — nothing reaches the
            pipeline from here without a score
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
          {/* Back and Forward. Discovery is read as a loop — narrow the list,
              open a candidate, come back, open the next — and the filters
              travelling in the URL are what make Back land on the list as it
              was rather than on all of it. */}
          <HistoryNav />
          <Link href="/discovery/rejected" className="btn">
            Rejected{rejected > 0 && <span className="num">({rejected})</span>}
          </Link>
          <Link href="/discovery/import" className="btn">
            Import CSV
          </Link>
          <Link href="/discovery/import/apify" className="btn">
            Import from Apify
          </Link>
          {/* The second pathway. It sits with the other ways in rather than
              replacing any of them — the LinkedIn person search is still the
              first way, and this one starts from the clinic. */}
          <Link href="/discovery/import/clinic" className="btn">
            Clinic-first search
          </Link>
          {/* Add clinic by name is deliberately not here. Six buttons made
              this row wrap on any window narrower than a desktop, and of the
              six it is the one used least — so it lives on the import page
              (/discovery/import) and in the empty state below, where somebody
              with nothing in Discovery is looking for a way in. */}
          <DiscoveryQueue
            loadQueue={discoveryQueue}
            process={processDiscoveryCandidate}
            queued={queued}
            settings={settings}
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
            Imports land here rather than in the pipeline. Bring in a CSV export,
            run an Apify actor, search for clinics directly, or add a single
            clinic by name — then press
            Process queue, and each candidate is enriched, scored against the ICP
            framework, and either promoted to a lead or rejected with its
            reasoning kept.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/discovery/import" className="btn">
              Import CSV
            </Link>
            <AddClinicByName add={addDiscoveryCandidateByName} />
            <Link href="/discovery/import/clinic" className="btn">
              Clinic-first search
            </Link>
            <Link href="/discovery/import/apify" className="btn-primary">
              Import from Apify
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <DiscoveryList rows={rows} />
        </div>
      )}
    </div>
  );
}
