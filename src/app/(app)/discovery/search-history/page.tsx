import PageActions from "@/components/PageActions";
import Link from "next/link";
import { listApifySearchLogs } from "@/lib/actions/apifySearchLog";
import {
  APIFY_SEARCH_SATURATING_AT,
  APIFY_SEARCH_WELL_USED_AT,
} from "@/lib/apifySearchLog";
import SearchHistoryPanel from "@/components/SearchHistoryPanel";

// Reads the log on every request — a page that cached this would be a usage
// count that stopped counting.
export const dynamic = "force-dynamic";

// What has already been searched for, and how hard.
//
// It answers one question the two search screens could not: is this keyword
// fresh, or has it been run until it stopped finding anybody new. Nothing here
// blocks a run — a well-used search still runs — and nothing here is derived
// from what a run found. It counts runs, which is the only thing about a
// search that is true regardless of what came back that day.
export default async function SearchHistoryPage() {
  const rows = await listApifySearchLogs();

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <Link href="/discovery" className="text-sm text-accent hover:underline">
            ← Discovery
          </Link>
          <h1 className="display mt-2 text-[32px] font-semibold">
            Search history
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Every search that has been run, and how worn it is — so a keyword
            that stopped paying is visible before it is run again
          </p>
        </div>
        <PageActions className="flex flex-wrap gap-2 xl:shrink-0">
          <Link href="/discovery/import/clinic" className="btn">
            Clinic-first search
          </Link>
          <Link href="/discovery/import/apify" className="btn">
            Import from Apify
          </Link>
        </PageActions>
      </div>

      <div className="card mb-8 px-6 py-4">
        <p className="text-sm font-medium">How the status is worked out</p>
        <p className="num mt-1 text-xs leading-relaxed text-muted">
          Never run: New · 1–{APIFY_SEARCH_SATURATING_AT - 1} runs: Used ·{" "}
          {APIFY_SEARCH_SATURATING_AT}–{APIFY_SEARCH_WELL_USED_AT - 1} runs:
          Getting saturated · {APIFY_SEARCH_WELL_USED_AT}+ runs: Well used.
          Click any pill to set it yourself instead — a status you set is
          marked “(manual)” and is kept until you change or clear it, while the
          run count carries on rising underneath it.
        </p>
      </div>

      <SearchHistoryPanel rows={rows} />
    </div>
  );
}
