"use server";

import { isApifySourceKind, runApifySync } from "@/lib/apify";
import { ApifyFetchResult } from "@/lib/discoveryImport";

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
  return runApifySync({ kind, id, input });
}
