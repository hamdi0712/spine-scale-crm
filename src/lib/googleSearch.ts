// Google Search — the one actor that answers "what is this clinic's URL?".
//
// Everything else in the enrichment chain is pointed at a URL somebody already
// has: the crawler needs a website, the ads scraper needs a Facebook page, the
// company lookup needs a LinkedIn page. This is the actor for the step before
// that — the clinic is a name, and the name has to become a link before any of
// the other four can do anything with it.
//
// It is used in exactly two places, and both of them are that same step:
//
//   The Facebook fallback (src/lib/enrichRun.ts). A candidate with no Facebook
//   URL used to mean the ads actor was skipped forever. Now the run searches
//   for the page once, writes what it finds back onto the record, and carries
//   on into the ads step it would otherwise have skipped. Finding nothing still
//   skips it, exactly as before.
//
//   Add clinic by name (src/lib/actions/discovery.ts). A name, optionally a
//   town, and the search gives the website to build a candidate around. What
//   happens to that candidate afterwards is the queue's business and is not
//   changed by how it got here.
//
// Nothing here touches the network or the database, on the same split the
// enrichment side already uses: the actor definition is data, the query
// builders and the readers are pure, and src/lib/googleSearchRun.ts does the
// running. That is what lets the enrichment panel — a client component — read
// the actor's ID off the plan without dragging an API token's module into the
// browser bundle.

// The store actor, addressed the way the Apify console shows it — same
// convention as the four in src/lib/leadEnrich.ts.
export const GOOGLE_SEARCH_ACTOR_ID = "apify~google-search-scraper";
export const GOOGLE_SEARCH_ACTOR_LABEL = "Google Search";

// One page of results, and only the top of it. The answer to "which link is
// this clinic" is in the first handful or it is not there at all, and every
// result past that is billed and thrown away.
const RESULTS_PER_PAGE = 10;

// A query is built from a clinic name and at most a town, so anything longer
// than this is a paste rather than a search.
const QUERY_MAX_CHARS = 200;

// Long enough for any URL a search result actually carries — the same ceiling
// the enrichment readers hold a scraped website to.
const URL_MAX_CHARS = 500;

// Hosts whose pages are never the clinic's own website. A directory listing,
// a social profile or a map pin is a real result for the query and the wrong
// answer to the question, so they are stepped over rather than taken. Matched
// on the registrable tail, so www.yelp.com and m.facebook.com are both Yelp
// and Facebook.
const NOT_A_CLINIC_SITE = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "yelp.com",
  "google.com",
  "goo.gl",
  "maps.app.goo.gl",
  "healthgrades.com",
  "zocdoc.com",
  "vitals.com",
  "wellness.com",
  "yellowpages.com",
  "mapquest.com",
  "tripadvisor.com",
  "wikipedia.org",
  "indeed.com",
  "glassdoor.com",
];

// Facebook paths that are Facebook's own furniture rather than a clinic's
// page. The ads scraper wants the page; pointing it at the ads library or a
// share link would waste the run it was given.
const NOT_A_FACEBOOK_PAGE = [
  "/ads/",
  "/sharer",
  "/share.php",
  "/login",
  "/help",
  "/policies",
  "/business",
  "/marketplace",
  "/tr",
];

// ─── Building a query ──────────────────────────────────────────────────────

// "Austin Spine & Injury Facebook page". The location narrows it when the
// record carries one and is left out rather than guessed when it doesn't —
// same rule the Maps search follows, and for the same reason: a name alone
// finds most clinics, and a wrong town finds the wrong one.
export function facebookSearchQuery(
  clinicName: string,
  location?: string | null,
): string {
  return searchQuery([clinicName, location, "Facebook page"]);
}

// "Austin Spine & Injury Austin, TX official website".
export function websiteSearchQuery(
  clinicName: string,
  location?: string | null,
): string {
  return searchQuery([clinicName, location, "official website"]);
}

function searchQuery(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (typeof p === "string" ? p.replace(/\s+/g, " ").trim() : ""))
    .filter((p) => p !== "")
    .join(" ")
    .slice(0, QUERY_MAX_CHARS);
}

export function buildGoogleSearchInput(query: string): Record<string, unknown> {
  return {
    queries: query,
    resultsPerPage: RESULTS_PER_PAGE,
    maxPagesPerQuery: 1,
    // The organic results are the whole point; the extras are billed and
    // unread.
    mobileResults: false,
    saveHtml: false,
    includeUnfilteredResults: false,
  };
}

// How many dataset items the run reads. One page of results is one item on the
// store actor, but a build that returns one item per result would otherwise be
// cut down to a single link.
export const GOOGLE_SEARCH_MAX_ITEMS = RESULTS_PER_PAGE;

// This actor bills per event, unlike the four in src/lib/leadEnrich.ts, which
// bill per result. That one difference is why it cannot be capped the way
// every other run in this app is capped — see the note in
// src/lib/googleSearchRun.ts, where the run is made and the cost ceiling it
// needs instead is set. Nothing about it belongs in this module, which stays
// free of anything that reaches the network.

// One search, in the shape the rest of this app's actor runs come back in.
// A search that matched nothing is an empty list rather than an error: nothing
// found is a normal answer here and every caller has something to do about it.
export interface GoogleSearchResult {
  ok: boolean;
  urls: string[];
  // Set only when the run itself failed — Apify's own sentence, passed through.
  error?: string;
}

// ─── Reading a result ──────────────────────────────────────────────────────

// The result links, in the order Google ranked them.
//
// Two shapes are handled because two exist. The store actor returns one item
// per results *page*, with the links nested in an organicResults list that the
// flattener leaves as a cell of JSON; a build that returns one item per result
// puts the link in a url field of its own. Reading both means an actor swap is
// an edit to GOOGLE_SEARCH_ACTOR_ID and to nothing else.
export function resultUrls(headers: string[], rows: string[][]): string[] {
  const urls: string[] = [];
  const add = (raw: string) => {
    const url = plausibleUrl(raw);
    if (url !== null && !urls.includes(url)) urls.push(url);
  };

  const nested = columnIndex(headers, "organicResults");
  const flat = columnIndex(headers, "url");

  for (const row of rows) {
    if (nested !== -1) {
      for (const entry of jsonList(row[nested] ?? "")) {
        const value = entry["url"] ?? entry["link"];
        if (typeof value === "string") add(value);
      }
    }
    if (flat !== -1) add(row[flat] ?? "");
  }
  return urls;
}

// Matched on the whole path first, then on the last segment — the same rule
// src/lib/leadEnrich.ts reads its cells by, so a field nested one level down
// is found the same way a top-level one is.
function columnIndex(headers: string[], name: string): number {
  const wanted = name.toLowerCase();
  const exact = headers.findIndex((h) => h.toLowerCase() === wanted);
  if (exact !== -1) return exact;
  return headers.findIndex(
    (h) => h.slice(h.lastIndexOf(".") + 1).toLowerCase() === wanted,
  );
}

function jsonList(raw: string): Record<string, unknown>[] {
  if (raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is Record<string, unknown> =>
      e !== null && typeof e === "object" && !Array.isArray(e),
  );
}

// A result link, held to something that could actually be requested. Same
// standard the enrichment readers hold a scraped website to, and for the same
// reason: this value goes on to be stored, shown, and handed to another actor.
function plausibleUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > URL_MAX_CHARS) return null;

  // A value that already names a scheme keeps it, and one that names anything
  // but http(s) is refused here rather than prefixed. Prefixing is not
  // harmless: "https://" + "mailto:someone@clinic.com" parses cleanly as a URL
  // on clinic.com with credentials in front of it, which is a request nobody
  // meant to make.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Credentials in a search result are not a search result.
  if (url.username !== "" || url.password !== "") return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
  return url.toString();
}

// Whether a host is, or sits under, one of the listed domains.
function hostMatches(url: string, domains: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

// The first result that is a Facebook page — a link on facebook.com that is
// not one of Facebook's own utility paths. Null when the search found nothing
// usable, which is the case that leaves the ads step skipped exactly as it was
// before this fallback existed.
export function firstFacebookPage(urls: string[]): string | null {
  for (const url of urls) {
    if (!hostMatches(url, ["facebook.com", "fb.com"])) continue;
    const path = new URL(url).pathname.toLowerCase();
    if (path === "/" || path === "") continue;
    if (NOT_A_FACEBOOK_PAGE.some((p) => path.startsWith(p))) continue;
    return url;
  }
  return null;
}

// The first result that reads as the clinic's own site: the top link that is
// not a directory, a social profile or a map pin. Null when every result was
// one of those, which is a clinic with no website worth pointing a crawler at
// rather than a failure.
export function firstClinicWebsite(urls: string[]): string | null {
  return urls.find((url) => !hostMatches(url, NOT_A_CLINIC_SITE)) ?? null;
}
