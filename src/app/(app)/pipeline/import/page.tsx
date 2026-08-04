import Link from "next/link";
import { importLeads } from "@/lib/actions/leads";
import LeadImportWizard from "@/components/LeadImportWizard";

export default function ImportLeadsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link href="/pipeline" className="text-sm text-accent hover:underline">
          ← Pipeline
        </Link>
        <h1 className="display mt-2 text-[32px] font-semibold">Import leads</h1>
        <p className="mt-1.5 text-sm text-muted">
          Bulk-add prospects from a CSV export — the columns are yours to map,
          whatever the source called them
        </p>
      </div>
      <LeadImportWizard action={importLeads} />
    </div>
  );
}
