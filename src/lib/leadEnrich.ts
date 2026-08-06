// Enrichment — the four actors, what each needs, and what each writes.
//
// The bulk import (src/lib/leadImport.ts) maps whatever an unknown actor
// returns, because the point of it is that any actor will do. This is the
// opposite arrangement: four named actors whose output shapes are known, run
// together, read by code rather than by hand. That is what lets "Enrich this
// lead" be one press instead of a wizard — there is nothing to ask, because
// every input is built from a field the lead already carries and every output
// has a field it belongs in.
//
// Two things follow from that, and they are the whole design:
//
//   A missing input is a skip, not an error. A lead with no Facebook page
//   still gets its website crawled; the run reports what it left out and why.
//
//   A run that comes back with several *candidate records* — the Maps search
//   found three clinics of that name — is the one case nothing can be read
//   with certainty, so that one actor's result waits for a human to say which
//   is the right clinic. Everything else writes itself.
//
// Nothing here touches the network or the database: the actor definitions are
// data, the readers are pure, and src/lib/actions/enrich.ts does the running.

import { parseCount } from "@/lib/leadImport";

// ─── The fields enrichment can write ───────────────────────────────────────

// Deliberately short, and deliberately not the lead's identity: enrichment
// adds evidence about a clinic, and nothing that would change who the lead is
// — the clinic name, the contact, the stage — can be reached from this flow.
export const ENRICH_FIELD_KEYS = [
  "staffCountRaw",
  "metaAdsSignal",
  "reviewCount",
  "websiteNotes",
] as const;

export type EnrichFieldKey = (typeof ENRICH_FIELD_KEYS)[number];

export const ENRICH_FIELD_LABELS: Record<EnrichFieldKey, string> = {
  staffCountRaw: "Staff count",
  metaAdsSignal: "Meta ads signal",
  reviewCount: "Review count",
  websiteNotes: "Website notes",
};

// What one actor's result, read through its own reader, would write. A key
// missing from this object is a field the update will not touch at all — which
// is the difference between "the actor had nothing to say about the staff
// count" and "the staff count is nothing", and the reason enrichment can never
// blank a field somebody filled in by hand.
export type EnrichUpdate = Partial<{
  staffCountRaw: number;
  metaAdsSignal: string;
  reviewCount: number;
  websiteNotes: string;
}>;

export function enrichFieldsWritten(update: EnrichUpdate): EnrichFieldKey[] {
  return ENRICH_FIELD_KEYS.filter((key) => update[key] !== undefined);
}

// Scraped copy is stored whole, but "whole" has to stop somewhere: a crawler
// pointed at a site with a blog attached can return a book. Cut with an
// ellipsis so a truncated note never reads as a complete one.
export const WEBSITE_NOTES_MAX_CHARS = 20000;
const WEBSITE_NOTES_MAX_PAGES = 3;

// Longest a freeform signal is allowed to be. Ours are built, not copied, so
// this only ever catches a chosen item posted back from the browser.
const SIGNAL_MAX_CHARS = 200;

// A headcount or a review count above this is a misread — a phone number, an
// id, a timestamp that happened to sit under a plausible key — not a clinic.
// Also keeps a garbage value inside the range the Int column can hold.
const MAX_PLAUSIBLE_COUNT = 10_000_000;

// ─── What a run is built from ──────────────────────────────────────────────

// The lead's own fields, and the only thing any actor input is built out of.
// Nothing is typed into the run: if it isn't on the lead, the actor that
// needed it doesn't run.
export interface EnrichInputs {
  clinicName: string;
  companyLinkedinUrl: string | null;
  facebookUrl: string | null;
  websiteUrl: string | null;
  location: string | null;
}

// The flattened result, exactly as the import's itemsToTable produces it:
// dotted paths as headers, one row per dataset item.
export interface EnrichTable {
  headers: string[];
  rows: string[][];
}

export const ENRICH_ACTOR_KEYS = [
  "companyDetails",
  "facebookAds",
  "websiteContent",
  "googleReviews",
] as const;

export type EnrichActorKey = (typeof ENRICH_ACTOR_KEYS)[number];

export interface EnrichActor {
  key: EnrichActorKey;
  label: string;
  // The Apify actor this runs. See the note above ENRICH_ACTORS before
  // changing one.
  actorId: string;
  // The lead field the input is built from. An empty one skips the actor.
  requires: keyof EnrichInputs;
  requiresLabel: string;
  // How many dataset items to ask for. Enough to read the answer and no more:
  // every item past that is billed and thrown away.
  maxItems: number;
  writes: EnrichFieldKey[];
  // Whether several returned items mean several *candidate clinics* rather
  // than several parts of one answer. Ads and crawled pages aggregate; a
  // company lookup and a Maps search identify, and identifying the wrong
  // clinic is the one mistake this flow could make silently — so those two ask
  // instead of guessing.
  identifies: boolean;
  // The fields that tell one candidate from another, in the order they read.
  identityFields: string[];
  buildInput(inputs: EnrichInputs): Record<string, unknown>;
  read(table: EnrichTable): EnrichUpdate;
}

// The four actors, by ID.
//
// These are store actors, addressed the way the Apify console shows them
// (`username~name`). Each entry is the whole integration: the ID, the input
// its schema expects, and the fields its output is read from. Swapping an
// actor for another that does the same job is an edit to one entry here and to
// nothing else in the app — and if a swapped actor names its output fields
// differently, adding the new name to that reader's candidate list is the
// entire change.
export const ENRICH_ACTORS: EnrichActor[] = [
  {
    key: "companyDetails",
    label: "Company Details",
    actorId: "apimaestro~linkedin-company-detail",
    requires: "companyLinkedinUrl",
    requiresLabel: "Company LinkedIn URL",
    maxItems: 5,
    writes: ["staffCountRaw"],
    identifies: true,
    identityFields: ["name", "companyName", "universalName", "website", "linkedinUrl"],
    buildInput: (inputs) => ({ identifier: inputs.companyLinkedinUrl }),
    read: (table) => {
      const count = plausibleCount(
        cell(table, 0, [
          "employeeCount",
          "employeesCount",
          "staffCount",
          "employeeCountRange",
          "companySize",
        ]),
      );
      return count === null ? {} : { staffCountRaw: count };
    },
  },
  {
    key: "facebookAds",
    label: "Facebook Ads Library",
    actorId: "apify~facebook-ads-scraper",
    requires: "facebookUrl",
    requiresLabel: "Facebook URL",
    // One item per ad, so this is the only ceiling that is a real limit rather
    // than a formality. A clinic running more than fifty ads at once is not a
    // clinic whose ad count needs another decimal place.
    maxItems: 50,
    writes: ["metaAdsSignal"],
    identifies: false,
    identityFields: [],
    buildInput: (inputs) => ({
      startUrls: [{ url: inputs.facebookUrl }],
      // The signal is about what is running now, not what ever ran.
      activeStatus: "active",
      resultsLimit: 50,
    }),
    read: (table) => {
      const signal = adsSignal(table, 50);
      return signal === null ? {} : { metaAdsSignal: signal };
    },
  },
  {
    key: "websiteContent",
    label: "Website Content Crawler",
    actorId: "apify~website-content-crawler",
    requires: "websiteUrl",
    requiresLabel: "Website URL",
    maxItems: WEBSITE_NOTES_MAX_PAGES,
    writes: ["websiteNotes"],
    identifies: false,
    identityFields: [],
    buildInput: (inputs) => ({
      startUrls: [{ url: inputs.websiteUrl }],
      maxCrawlPages: WEBSITE_NOTES_MAX_PAGES,
      // The cheap crawler: this is reading copy off a clinic's marketing site,
      // not rendering an application.
      crawlerType: "cheerio",
      saveMarkdown: false,
    }),
    read: (table) => {
      const notes = crawledText(table);
      return notes === null ? {} : { websiteNotes: notes };
    },
  },
  {
    key: "googleReviews",
    label: "Google Maps Reviews",
    actorId: "compass~crawler-google-places",
    // The one actor with no URL to work from: it searches by name, which is
    // why it is also the one most likely to come back with several clinics.
    requires: "clinicName",
    requiresLabel: "Clinic name",
    maxItems: 5,
    writes: ["reviewCount"],
    identifies: true,
    identityFields: ["title", "address", "reviewsCount", "totalScore", "url"],
    buildInput: (inputs) => ({
      // Location narrows the search when the lead carries one, and is left out
      // rather than guessed when it doesn't — a name alone still finds most
      // clinics, and a wrong town finds the wrong one.
      searchStringsArray: [
        [inputs.clinicName, inputs.location].filter(Boolean).join(" "),
      ],
      maxCrawledPlacesPerSearch: 5,
      language: "en",
    }),
    read: (table) => {
      const count = plausibleCount(
        cell(table, 0, [
          "reviewsCount",
          "reviewCount",
          "totalReviews",
          "userRatingCount",
        ]),
      );
      return count === null ? {} : { reviewCount: count };
    },
  },
];

export function enrichActor(key: string): EnrichActor | null {
  return ENRICH_ACTORS.find((a) => a.key === key) ?? null;
}

// ─── The plan ──────────────────────────────────────────────────────────────

// What a run would do, worked out before it does any of it: which actors have
// what they need, and for the rest, the field that is missing. The panel shows
// this the moment it opens, so the skips are stated as intent rather than
// explained afterwards.
export interface EnrichPlanEntry {
  key: EnrichActorKey;
  label: string;
  actorId: string;
  writes: string[];
  willRun: boolean;
  // "no Facebook URL set", or null when it runs.
  skipReason: string | null;
}

export function enrichPlan(inputs: EnrichInputs): EnrichPlanEntry[] {
  return ENRICH_ACTORS.map((actor) => {
    const value = inputs[actor.requires];
    const has = typeof value === "string" && value.trim() !== "";
    return {
      key: actor.key,
      label: actor.label,
      actorId: actor.actorId,
      writes: actor.writes.map((f) => ENRICH_FIELD_LABELS[f]),
      willRun: has,
      skipReason: has ? null : `no ${actor.requiresLabel} set`,
    };
  });
}

// ─── What a run reports back ───────────────────────────────────────────────

// One outcome per actor, always — a run of four actors reports four things,
// and an actor that did nothing says which nothing it did. Declared here
// rather than beside the action because a "use server" module can export
// nothing but async functions, and the panel needs the type.
export type EnrichOutcome =
  | { key: EnrichActorKey; status: "skipped"; detail: string }
  | { key: EnrichActorKey; status: "failed"; detail: string }
  | { key: EnrichActorKey; status: "empty"; detail: string }
  | {
      key: EnrichActorKey;
      status: "wrote";
      fields: EnrichFieldKey[];
      values: string[];
    }
  // Several candidate clinics came back and the run stopped short of writing
  // this actor's fields. The rows travel with it so the choice can be applied
  // without running the actor again.
  | {
      key: EnrichActorKey;
      status: "choose";
      detail: string;
      headers: string[];
      rows: string[][];
      options: string[];
    };

export interface EnrichRunResult {
  outcomes: EnrichOutcome[];
  // Every field the run wrote, across all four actors.
  written: EnrichFieldKey[];
  // ISO, and null when nothing was written — the stamp and the write are the
  // same event.
  enrichedAt: string | null;
  // Set only when the run could not start at all.
  error?: string;
}

// How a candidate reads in the chooser: the identity fields it actually
// carries, run together. Falls back to the item's number, because a candidate
// with nothing to say for itself still has to be pickable.
export function candidateLabel(
  actor: EnrichActor,
  table: EnrichTable,
  index: number,
): string {
  const parts = actor.identityFields
    .map((field) => cell(table, index, [field]))
    .map((v) => v.trim())
    .filter((v) => v !== "");
  return parts.length === 0
    ? `Item ${index + 1}`
    : parts.slice(0, 3).join(" · ").slice(0, 160);
}

// ─── Reading a result ──────────────────────────────────────────────────────

// One value out of the flattened table, by any of the names an actor might
// have used for it. Matched on the whole dotted path first, then on the last
// segment, so a field nested under an object — place.reviewsCount — is found
// by the same candidate that finds a top-level one.
function cell(table: EnrichTable, rowIndex: number, candidates: string[]): string {
  const row = table.rows[rowIndex];
  if (!row) return "";
  for (const candidate of candidates) {
    const wanted = candidate.toLowerCase();
    let index = table.headers.findIndex((h) => h.toLowerCase() === wanted);
    if (index === -1) {
      index = table.headers.findIndex(
        (h) => h.slice(h.lastIndexOf(".") + 1).toLowerCase() === wanted,
      );
    }
    if (index !== -1 && (row[index] ?? "").trim() !== "") {
      return row[index].trim();
    }
  }
  return "";
}

// A count as scraped — "51", "1,200 employees", "11-50" — held to a range a
// clinic could plausibly have. parseCount takes the lower end of a band, which
// is the conservative read and the one already used by the CSV import.
function plausibleCount(raw: string): number | null {
  const n = parseCount(raw);
  if (n === null || n < 0 || n > MAX_PLAUSIBLE_COUNT) return null;
  return n;
}

// The ads signal, built from the whole result rather than from any one item:
// each item is one ad, so the count is the answer and the earliest start date
// says how long this clinic has been at it. "3 active ads, running 4mo".
function adsSignal(table: EnrichTable, cap: number): string | null {
  const count = table.rows.length;
  if (count === 0) return null;

  let earliest: number | null = null;
  for (let i = 0; i < count; i++) {
    const at = timestamp(
      cell(table, i, [
        "startDate",
        "start_date",
        "adDeliveryStartTime",
        "ad_delivery_start_time",
        "startDateFormatted",
      ]),
    );
    if (at !== null && (earliest === null || at < earliest)) earliest = at;
  }

  // A result that came back exactly at the ceiling was cut off there, so the
  // count is a floor rather than a total and says so.
  const capped = count >= cap;
  const plural = count === 1 && !capped ? "" : "s";
  const running = earliest === null ? "" : `, running ${duration(Date.now() - earliest)}`;
  return `${count}${capped ? "+" : ""} active ad${plural}${running}`;
}

// Dates arrive as ISO strings, as "April 1, 2025", and as epoch seconds. A
// bare number is seconds if it is small enough to be a plausible date in them
// — Facebook's ad delivery times are — and milliseconds otherwise.
function timestamp(raw: string): number | null {
  if (raw === "") return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const ms = n < 100_000_000_000 ? n * 1000 : n;
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

// How long, in the coarsest unit that still says something: nobody needs "127
// days" when they asked how long a clinic has been advertising.
function duration(ms: number): string {
  const days = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

// The crawled pages, run together in the order they were crawled — the start
// URL first, which is the page most likely to say what the clinic does. Each
// page is labelled with its own URL so a note read weeks later says which page
// it came off.
function crawledText(table: EnrichTable): string | null {
  const parts: string[] = [];
  for (let i = 0; i < table.rows.length && parts.length < WEBSITE_NOTES_MAX_PAGES; i++) {
    const text = cell(table, i, ["text", "markdown", "content", "pageContent"]);
    if (text === "") continue;
    const url = cell(table, i, ["url", "loadedUrl", "pageUrl"]);
    parts.push(url === "" ? text : `${url}\n${text}`);
  }
  if (parts.length === 0) return null;
  const joined = parts.join("\n\n");
  return joined.length > WEBSITE_NOTES_MAX_CHARS
    ? `${joined.slice(0, WEBSITE_NOTES_MAX_CHARS)}…`
    : joined;
}

// The last gate before anything reaches the database. The readers above
// already produce values of the right shape; this is what stands between a
// chosen item posted back from the browser and a column, and it holds whatever
// arrives to the same lengths and ranges a real result would have had.
export function sanitizeEnrichUpdate(update: EnrichUpdate): EnrichUpdate {
  const out: EnrichUpdate = {};
  if (typeof update.staffCountRaw === "number") {
    const n = Math.round(update.staffCountRaw);
    if (Number.isFinite(n) && n >= 0 && n <= MAX_PLAUSIBLE_COUNT) {
      out.staffCountRaw = n;
    }
  }
  if (typeof update.reviewCount === "number") {
    const n = Math.round(update.reviewCount);
    if (Number.isFinite(n) && n >= 0 && n <= MAX_PLAUSIBLE_COUNT) {
      out.reviewCount = n;
    }
  }
  if (typeof update.metaAdsSignal === "string") {
    const v = update.metaAdsSignal.trim().slice(0, SIGNAL_MAX_CHARS);
    if (v !== "") out.metaAdsSignal = v;
  }
  if (typeof update.websiteNotes === "string") {
    const v = update.websiteNotes.trim().slice(0, WEBSITE_NOTES_MAX_CHARS);
    if (v !== "") out.websiteNotes = v;
  }
  return out;
}

// How a written value reads in the run summary — the number, or the first of a
// long note. Kept here so the summary and the lead page agree on what a value
// looks like.
export function enrichValuePreview(
  key: EnrichFieldKey,
  update: EnrichUpdate,
): string {
  const value = update[key];
  if (value === undefined) return "";
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
