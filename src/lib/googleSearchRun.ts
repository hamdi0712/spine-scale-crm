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

import { APIFY_MIN_CHARGE_USD, runApifySync } from "@/lib/apify";
import {
  GOOGLE_SEARCH_ACTOR_ID,
  GOOGLE_SEARCH_MAX_ITEMS,
  GoogleSearchResult,
  buildGoogleSearchInput,
  resultEntries,
} from "@/lib/googleSearch";

// What one search is allowed to cost, and the one line in this app that exists
// because of how an actor is billed rather than what it does.
//
// This actor bills per event. The four enrichment actors bill per result, and
// a pay-per-result run is capped by asking for fewer results — which is what
// maxItems does, and what every other run here relies on. There is no
// per-result price on a pay-per-event actor for that to work against, so Apify
// wants a cost ceiling instead and refuses anything below its $0.50 minimum
// before the run starts: "Maximum cost per run is less than the allowed
// minimum of $0.50". Capping this actor in items was therefore not a cheap run
// but no run at all.
//
// It is the platform's floor rather than a budget anybody picked. A single
// query costs a small fraction of it, and what the run actually does is
// bounded by its input — one page, ten results. Raising this would buy no more
// search; it would only raise the ceiling on a run that went wrong.
//
// Actor-specific on purpose. The default in runApifySync is unchanged and
// still right for everything else in the app.
export const GOOGLE_SEARCH_MAX_CHARGE_USD = APIFY_MIN_CHARGE_USD;

// actorId is the one Pipeline Settings has for this step, and defaults to the
// store actor this app shipped with when a caller has no settings to hand —
// the two places that search are the enrichment chain and the by-name add, and
// only the first of them has a run's settings loaded.
export async function runGoogleSearch(
  query: string,
  actorId: string = GOOGLE_SEARCH_ACTOR_ID,
): Promise<GoogleSearchResult> {
  if (query.trim() === "") {
    return { ok: false, urls: [], entries: [], error: "There was nothing to search for." };
  }

  let result;
  try {
    result = await runApifySync({
      kind: "actor",
      id: actorId,
      // Built here and immediately re-read by the same JSON validation the
      // bulk import goes through, so there is one path into an actor run
      // rather than a checked one and a trusted one.
      input: JSON.stringify(buildGoogleSearchInput(query)),
      // The cap in money, not in items — see above. maxItems still bounds what
      // is read back out of the dataset; it is only the *run's* ceiling that
      // has to be expressed as a cost for this one.
      maxItems: GOOGLE_SEARCH_MAX_ITEMS,
      maxTotalChargeUsd: GOOGLE_SEARCH_MAX_CHARGE_USD,
    });
  } catch {
    return {
      ok: false,
      urls: [],
      entries: [],
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
      ? { ok: true, urls: [], entries: [] }
      : { ok: false, urls: [], entries: [], error: result.error };
  }
  const entries = resultEntries(result.headers, result.rows);
  return { ok: true, urls: entries.map((e) => e.url), entries };
}

// The one Apify message that means "no results" rather than "something went
// wrong". Matched on its own text, which is written in src/lib/apify.ts.
function emptyDataset(error: string): boolean {
  return error.includes("its dataset is empty");
}
