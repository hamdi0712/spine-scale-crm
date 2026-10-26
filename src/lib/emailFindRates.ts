// What Find emails costs (src/lib/emailFind.ts). Pure constants, safe for a
// client component.
//
// Rough published rates, as everything in src/lib/pipelineSettings.ts is. The
// extractor crawls up to EXTRACTOR_MAX_PAGES pages of one site and bills per
// page; the verifier bills per address.

export const EXTRACTOR_MAX_PAGES = 10;
export const EXTRACTOR_USD_PER_PAGE = 0.003;
export const VERIFIER_USD_PER_ADDRESS = 0.003;

// How many found addresses one lead may send to the verifier. A contact page
// listing eight staff inboxes is not eight verifications worth paying for.
export const MAX_FOUND_VERIFIED = 5;
// What an extractor run is assumed to find, for the estimate only.
export const EXTRACTOR_ASSUMED_ADDRESSES = 2;

export function extractorCost(): number {
  return EXTRACTOR_MAX_PAGES * EXTRACTOR_USD_PER_PAGE;
}
