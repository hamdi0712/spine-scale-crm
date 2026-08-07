import Link from "next/link";
import { importDiscoveryCandidates } from "@/lib/actions/discovery";
import DiscoveryImportWizard from "@/components/DiscoveryImportWizard";

export default function ImportCandidatesPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <Link
            href="/discovery"
            className="text-sm text-accent hover:underline"
          >
            ← Discovery
          </Link>
          <h1 className="display mt-2 text-[32px] font-semibold">
            Import candidates
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Bulk-add scraped clinics from a CSV export — the columns are yours
            to map, whatever the source called them
          </p>
        </div>
        <Link href="/discovery/import/apify" className="btn shrink-0">
          Import from Apify
        </Link>
      </div>
      <DiscoveryImportWizard action={importDiscoveryCandidates} source="csv" />
    </div>
  );
}
