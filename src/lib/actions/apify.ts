"use server";

import { isApifySourceKind, runApifySync } from "@/lib/apify";
import { ApifyFetchResult } from "@/lib/discoveryImport";
import { recordApifySearchRun } from "@/lib/actions/apifySearchLog";

// Called straight from the import wizard, which awaits the result rather than
// posting a form: the run's output has to come back to the browser to be
// mapped and previewed, not written to anything yet.
//
// Everything crossing this boundary is untrusted, so the id, the kind and the
// input JSON are all validated in src/lib/apify.ts before any of them reach a
// URL or a request body. Nothing here reads or returns APIFY_API_TOKEN.
export async function fetchApifyDataset(args: {
  kind: string;
  id: string;
  input: string;
}): Promise<ApifyFetchResult> {
  const kind = isApifySourceKind(args?.kind) ? args.kind : "actor";
  const id = typeof args?.id === "string" ? args.id : "";
  const input = typeof args?.input === "string" ? args.input : "";

  if (id.trim() === "") {
    return { ok: false, error: `Enter an ${kind} ID to run.` };
  }

  // Counted before the run, not after: the search was used the moment it was
  // sent, and a run that comes back empty or errors is exactly the kind of
  // exhausted search this count exists to make visible. The input is
  // canonicalised on the way in, so re-indenting the same JSON is the same
  // search rather than a second one.
  await recordApifySearchRun({ type: "LINKEDIN_SEARCH", raw: input });

  return runApifySync({ kind, id, input });
}
