import PageActions from "@/components/PageActions";
import Link from "next/link";
import { clinicDiscoverySettings } from "@/lib/actions/clinicDiscovery";
import { clinicKeywordStatuses } from "@/lib/actions/apifySearchLog";
import { DEFAULT_CLINIC_SEARCH_TERMS } from "@/lib/clinicDiscovery";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import ClinicDiscoveryPanel from "@/components/ClinicDiscoveryPanel";

// Reads the pipeline settings for the actor and the cost estimate, so this
// page is per-request like every other one that touches the database.
export const dynamic = "force-dynamic";

// Clinic-First Discovery — the second way into Discovery, beside the CSV
// import, the Apify import and the by-name form.
//
// The other three all start from something somebody already has: a file, a
// dataset, a name. This one starts from a search for what a clinic does, and
// finds clinics nobody had heard of — including the ones whose owner keeps no
// LinkedIn profile, which is exactly the set a person-first search cannot see.
//
// What it produces is ordinary candidates, Pending, going through the same
// queue as everything else.
export default async function ClinicDiscoveryPage() {
  const [clinic, settings, termStatuses] = await Promise.all([
    clinicDiscoverySettings(),
    loadPipelineSettings(),
    // The panel starts on the default terms, so their usage is read here and
    // drawn with the first paint. Anything typed into it afterwards is looked
    // up by the panel itself.
    clinicKeywordStatuses(DEFAULT_CLINIC_SEARCH_TERMS),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-end justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-4">
        <div>
          <Link href="/discovery" className="text-sm text-accent hover:underline">
            ← Discovery
          </Link>
          <h1 className="display mt-2 text-[32px] font-semibold">
            Clinic-first search
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Find the clinic first and the decision-maker later — the same
            enrichment chain, the same scoring, no person needed to start
          </p>
        </div>
        <PageActions className="flex shrink-0 flex-wrap gap-2">
          <Link href="/discovery/search-history" className="btn">
            Search history
          </Link>
          <Link href="/discovery/import/apify" className="btn">
            Import from Apify
          </Link>
        </PageActions>
      </div>

      <div className="card mb-8 px-6 py-4">
        <p className="text-sm font-medium">What happens to what it finds</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Every clinic imported here becomes a Pending candidate and goes
          through the existing chain — Company Details, Google Maps, the Google
          Search fallback, the Facebook Ads library, the website crawler, then
          scoring. A clinic that clears the promotion threshold becomes a lead
          whether or not anybody is named at it: the score is what decides, and
          the contact name is typed onto the lead once it is known.
        </p>
      </div>

      <ClinicDiscoveryPanel
        enabled={clinic.enabled}
        actorId={clinic.actorId}
        settings={settings}
        termStatuses={termStatuses}
      />
    </div>
  );
}
