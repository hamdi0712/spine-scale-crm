// Running the search — the network half of src/lib/googleSearch.ts.
//
// Split from it for the same reason src/lib/enrichRun.ts is split from
// src/lib/leadEnrich.ts: the definitions and the readers are pure and are read
// by a client component, and the thing that spends money on a live account is
// server-only and must never be imported from one.
//
// It is deliberately not a "use server" module. Those may export nothing but
// server actions, and this is a helper two of them call — not an endpoint the
// browser is allowed to reach on its own.

import { runApifySync } from "@/lib/apify";
import {
  GOOGLE_SEARCH_ACTOR_ID,
  GOOGLE_SEARCH_MAX_ITEMS,
  GoogleSearchResult,
  buildGoogleSearchInput,
  resultUrls,
} from "@/lib/googleSearch";

export async function runGoogleSearch(
  query: string,
): Promise<GoogleSearchResult> {
  if (query.trim() === "") {
    return { ok: false, urls: [], error: "There was nothing to search for." };
  }

  let result;
  try {
    result = await runApifySync({
      kind: "actor",
      id: GOOGLE_SEARCH_ACTOR_ID,
      // Built here and immediately re-read by the same JSON validation the
      // bulk import goes through, so there is one path into an actor run
      // rather than a checked one and a trusted one.
      input: JSON.stringify(buildGoogleSearchInput(query)),
      maxItems: GOOGLE_SEARCH_MAX_ITEMS,
    });
  } catch {
    return {
      ok: false,
      urls: [],
      error:
        "The search could not be reached. Check the server's network connection and try again.",
    };
  }

  // A search that matched nothing comes back from runApifySync as a failed run
  // with an empty-dataset message. That is a normal answer to "find this
  // clinic's Facebook page", not a failure worth stopping anything over, so it
  // is reported as a clean run that found no links.
  if (!result.ok) {
    return emptyDataset(result.error)
      ? { ok: true, urls: [] }
      : { ok: false, urls: [], error: result.error };
  }
  return { ok: true, urls: resultUrls(result.headers, result.rows) };
}

// The one Apify message that means "no results" rather than "something went
// wrong". Matched on its own text, which is written in src/lib/apify.ts.
function emptyDataset(error: string): boolean {
  return error.includes("its dataset is empty");
}
