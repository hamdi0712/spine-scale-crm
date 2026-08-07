import Link from "next/link";
import { importDiscoveryCandidates } from "@/lib/actions/discovery";
import DiscoveryImportWizard from "@/components/DiscoveryImportWizard";

// The live half of the import: same three steps, same mapping, same confirm —
// the rows arrive from an actor run instead of a file. The token stays on the
// server (src/lib/apify.ts); this page never sees it.
export default function ApifyImportPage() {
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
            Import from Apify
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Run an actor or a saved task and map what it returns — same mapping
            and duplicate checks as the CSV import
          </p>
        </div>
        <Link href="/discovery/import" className="btn shrink-0">
          Import a CSV
        </Link>
      </div>
      <DiscoveryImportWizard action={importDiscoveryCandidates} source="apify" />
    </div>
  );
}
