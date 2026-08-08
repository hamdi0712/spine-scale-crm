// Enrichment — the four actors, what each needs, and what each writes.
//
// The bulk import (src/lib/discoveryImport.ts) maps whatever an unknown actor
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
//   The one missing input that is now worth going and finding is the Facebook
//   URL — a search for the page runs in front of the ads actor that needs it
//   (src/lib/enrichRun.ts), and finding nothing leaves the skip exactly as it
//   was. Every other missing input is still a skip and nothing more.
//
//   A run that comes back with several *candidate records* — the Maps search
//   found three clinics of that name — is the one case nothing can be read
//   with certainty, so that one actor's result waits for a human to say which
//   is the right clinic. Everything else writes itself.
//
// Nothing here touches the network or the database: the actor definitions are
// data, the readers are pure, and src/lib/actions/enrich.ts does the running.

import { parseCount } from "@/lib/discoveryImport";
import {
  PIPELINE_STEP_KEYS,
  PIPELINE_STEP_LABELS,
  PipelineSettings,
  PipelineStepKey,
} from "@/lib/pipelineSettings";

// ─── The fields enrichment can write ───────────────────────────────────────

// Deliberately short, and deliberately not the lead's identity: enrichment
// adds evidence about a clinic, and nothing that would change who the lead is
// — the clinic name, the contact, the stage — can be reached from this flow.
//
// The website URL is the one field here that is also an *input*: the crawler
// runs on it. It is in this list because both the company lookup and the Maps
// search report it, and a record that arrived from a LinkedIn scrape with no
// website is a record whose crawl would otherwise be skipped forever for want
// of a field two of the other actors already know. It is filled and never
// overwritten — see fillableWebsiteUrl below.
//
// The Facebook URL is here on the same footing and for the same reason: the
// ads actor cannot run without one, and a record that arrived from a CSV with
// no Facebook page would have that step skipped on every run forever. The
// Google Search lookup in src/lib/enrichRun.ts fills it once so the runs after
// this one have it already. It is filled and never overwritten, but by a
// different mechanism to the website's: the lookup only runs on a record whose
// Facebook URL is blank (needsFacebookLookup below), so a URL somebody typed
// in is never searched against in the first place.
export const ENRICH_FIELD_KEYS = [
  "staffCountRaw",
  "websiteUrl",
  "facebookUrl",
  "metaAdsSignal",
  "reviewCount",
  "websiteNotes",
] as const;

export type EnrichFieldKey = (typeof ENRICH_FIELD_KEYS)[number];

export const ENRICH_FIELD_LABELS: Record<EnrichFieldKey, string> = {
  staffCountRaw: "Staff count",
  websiteUrl: "Website URL",
  facebookUrl: "Facebook URL",
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
  websiteUrl: string;
  facebookUrl: string;
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

// Long enough for any address a clinic actually uses, short enough that a
// paragraph pasted into a website field is refused rather than stored.
const WEBSITE_URL_MAX_CHARS = 500;

// A headcount or a review count above this is a misread — a phone number, an
// id, a timestamp that happened to sit under a plausible key — not a clinic.
// Also keeps a garbage value inside the range the Int column can hold.
const MAX_PLAUSIBLE_COUNT = 10_000_000;

// How many ads to pull. One item per ad, and this is both what is asked for
// and what is read back, so the count and the ceiling can never disagree.
const FACEBOOK_ADS_CAP = 50;

// The ads scraper's e-commerce enrichment, off, in writing.
//
// It is an opt-in add-on and off by default, so this changes nothing today.
// It is set anyway because it bills per ad for shop data a chiropractic clinic
// does not have, and a default is somebody else's decision to revisit — an
// input we send is ours. If the add-on is ever renamed, this is the one line
// to change.
const ECOMMERCE_ENRICHMENT_OFF = { enrichWithEcommerceData: false } as const;

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

// The four actors, and the two lookups that run in front of two of them.
//
// Neither lookup is an actor in ENRICH_ACTORS and deliberately so: they read
// nothing about a clinic, they only turn a name into a URL another step cannot
// run without, and each runs only on a record that hasn't got that URL. They
// are keys here because they report an outcome like everything else in a run —
// the panel and the queue both list what happened, and a step that quietly
// happened or quietly didn't would be the one part of a run nobody could see.
//
// Both are the same actor and the same switch. In Pipeline Settings they are
// one step, "Google Search", because that is what a person turning it off
// means: stop searching Google. That row is keyed facebookLookup, which is
// what it was called when the Facebook page was the only thing it looked up —
// LOOKUP_SETTINGS_KEY below is where the two names are reconciled.
//
// The step list is the settings row's, imported rather than repeated: a step
// that can be turned off in Pipeline Settings and a step that reports an
// outcome in a run are the same step, and two lists would be two chances to
// disagree about which five those are. The lookups are added on top, because
// they report outcomes without being separately switchable.
export const ENRICH_LOOKUP_KEYS = ["facebookLookup", "websiteLookup"] as const;

export type EnrichLookupKey = (typeof ENRICH_LOOKUP_KEYS)[number];

export const ENRICH_ACTOR_KEYS = [
  ...PIPELINE_STEP_KEYS,
  "websiteLookup" as const,
];

export type EnrichActorKey = PipelineStepKey | EnrichLookupKey;

export function isEnrichLookupKey(key: string): key is EnrichLookupKey {
  return (ENRICH_LOOKUP_KEYS as readonly string[]).includes(key);
}

// The settings step both lookups answer to. One switch and one actor ID for
// "search Google", whichever of the two URLs is being searched for.
export const LOOKUP_SETTINGS_KEY: PipelineStepKey = "facebookLookup";

// The name each step goes by in a report — the settings page's names, so a
// step somebody turned off is called the same thing in the run that skips it.
// The two lookups carry their own, because the settings page has one row for
// what a run reports as two steps.
export const ENRICH_STEP_LABELS: Record<EnrichActorKey, string> = {
  ...PIPELINE_STEP_LABELS,
  facebookLookup: "Facebook page lookup",
  websiteLookup: "Website lookup",
};

export interface EnrichActor {
  // A settings step rather than any outcome key: every entry in ENRICH_ACTORS
  // is one of the switchable steps, and the two lookups are not entries here.
  // Typed this way so settings.steps[actor.key] needs no widening anywhere.
  key: PipelineStepKey;
  label: string;
  // The Apify actor is deliberately not here any more. Which actor a step runs
  // is a setting (src/lib/pipelineSettings.ts), read per run from the stored
  // row and defaulted to the ID this app shipped with. What stays here is
  // everything that cannot be a setting: the input a step's schema expects and
  // the fields its output is read from.
  //
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

// The four actors — what each is asked, and how each is read.
//
// The IDs they run under used to be here and now live in Pipeline Settings,
// defaulting to the same store actors as before (DEFAULT_ACTOR_IDS in
// src/lib/pipelineSettings.ts). Swapping one for another that does the same
// job is a field on that page rather than an edit here.
//
// What did not move is the half an actor cannot describe about itself: the
// input its schema expects, and the output field names its reader looks for.
// A swapped-in actor that names its output differently still needs its name
// adding to that reader's candidate list below — which is the honest limit of
// what a settings page can promise, and is said out loud on it.
export const ENRICH_ACTORS: EnrichActor[] = [
  {
    key: "companyDetails",
    label: "Company Details",
    requires: "companyLinkedinUrl",
    requiresLabel: "Company LinkedIn URL",
    maxItems: 5,
    writes: ["staffCountRaw", "websiteUrl"],
    identifies: true,
    identityFields: ["name", "universalName", "website", "linkedinUrl"],
    buildInput: (inputs) => ({ companies: [inputs.companyLinkedinUrl] }),
    // employeeCount is the field this actor reports headcount in. parseCount
    // takes the lower end of anything banded, so a range answers conservatively.
    //
    // The website comes off the same record, from the field a company page
    // puts its own link in. It runs first of the four, so a website read here
    // is a website the crawler two actors later can already work from.
    read: (table) => ({
      ...countUpdate(cell(table, 0, ["employeeCount"])),
      ...websiteUpdate(cell(table, 0, ["website", "websiteUrl"])),
    }),
  },
  {
    key: "facebookAds",
    label: "Facebook Ads Library",
    requires: "facebookUrl",
    requiresLabel: "Facebook URL",
    // One item per ad, so this is the only ceiling that is a real limit rather
    // than a formality. A clinic running more than fifty ads at once is not a
    // clinic whose ad count needs another decimal place.
    maxItems: FACEBOOK_ADS_CAP,
    writes: ["metaAdsSignal"],
    identifies: false,
    identityFields: [],
    buildInput: (inputs) => ({
      startUrls: [{ url: inputs.facebookUrl }],
      // The signal is about what is running now, not what ever ran. The
      // library is still read past that — an ad that stopped last month is
      // worth knowing about — but this is what the count is of.
      activeStatus: "active",
      resultsLimit: FACEBOOK_ADS_CAP,
      ...ECOMMERCE_ENRICHMENT_OFF,
    }),
    read: (table) => {
      const signal = adsSignal(table, FACEBOOK_ADS_CAP);
      return signal === null ? {} : { metaAdsSignal: signal };
    },
  },
  {
    key: "googleReviews",
    label: "Google Maps Reviews",
    // Ahead of the crawler, which is a change from how this chain used to run
    // and the reason it now feeds it.
    //
    // This actor reports a website as well as a review count, and while it ran
    // last that website was found *after* the one step that needed it — so a
    // clinic Maps knew the site for still had its crawl skipped, and had to
    // wait for the next run to use what this run already knew. Moving it up
    // costs nothing (it needs only the clinic name, which is always there) and
    // means the two actors that report a website both report it before the
    // crawler's turn.
    //
    // It is also what makes the website lookup in src/lib/enrichRun.ts a last
    // resort rather than a first guess: by the time it runs, both of the
    // actors that might have known the URL for free have already said.
    //
    // The one actor with no URL to work from: it searches by name, which is
    // why it is also the one most likely to come back with several clinics.
    requires: "clinicName",
    requiresLabel: "Clinic name",
    maxItems: 5,
    writes: ["reviewCount", "websiteUrl"],
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
      return {
        ...(count === null ? {} : { reviewCount: count }),
        // "website" only, never "url": on a Maps record that second field is
        // the listing's own page on Google, and crawling that would fill the
        // website notes with Google's chrome instead of the clinic's copy.
        ...websiteUpdate(cell(table, 0, ["website"])),
      };
    },
  },
  {
    key: "websiteContent",
    label: "Website Content Crawler",
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

// The skip reason for a step somebody turned off. Worded as a decision rather
// than a shortcoming, because that is what it is — and it names the page it
// was decided on, so the way to undo it is in the sentence.
export const STEP_TURNED_OFF_REASON = "turned off in Pipeline Settings";

export function enrichPlan(
  inputs: EnrichInputs,
  settings: PipelineSettings,
): EnrichPlanEntry[] {
  const searchOn = settings.steps[LOOKUP_SETTINGS_KEY].enabled;

  // The one thing the plan cannot state flatly. Three steps before the crawler
  // can each hand it a website it hasn't got — the company lookup and the Maps
  // search report one, and the lookup searches for one when neither did — so a
  // record with no website today may well have one by the time the crawler's
  // turn comes round. That makes "skipped" a prediction here rather than a
  // fact, and it says so.
  const websiteMayArrive =
    (inputs.websiteUrl ?? "").trim() === "" &&
    (((inputs.companyLinkedinUrl ?? "").trim() !== "" &&
      settings.steps.companyDetails.enabled) ||
      settings.steps.googleReviews.enabled ||
      (needsWebsiteLookup(inputs) && searchOn));

  // The same shape of prediction for the ads actor, and the reason the lookup
  // row appears at all: a record with no Facebook URL is about to have one
  // searched for, so the ads step below it is a maybe rather than a skip.
  const lookupWillRun = needsFacebookLookup(inputs) && searchOn;

  const entries: EnrichPlanEntry[] = [];
  for (const actor of ENRICH_ACTORS) {
    // Each lookup is listed immediately above the actor it exists to feed,
    // because that is the order it runs in and the only reason it runs at all.
    // Shown whenever the record needs one, on or off — a row that vanished when
    // it was turned off would leave the plan quietly one step shorter with no
    // way to see why.
    if (actor.key === "facebookAds" && needsFacebookLookup(inputs)) {
      entries.push(lookupPlanEntry("facebookLookup", settings));
    }
    // The website lookup is a prediction in a way the Facebook one is not: the
    // two actors above the crawler may yet report a website, and then it will
    // not run at all. Listed anyway, saying exactly that, because a step that
    // might spend money is worth seeing before it does.
    if (actor.key === "websiteContent" && needsWebsiteLookup(inputs)) {
      entries.push(lookupPlanEntry("websiteLookup", settings));
    }

    const value = inputs[actor.requires];
    const has = typeof value === "string" && value.trim() !== "";
    const on = settings.steps[actor.key].enabled;
    const mayArrive =
      !has &&
      ((actor.requires === "websiteUrl" && websiteMayArrive) ||
        (actor.requires === "facebookUrl" && lookupWillRun));
    entries.push({
      key: actor.key,
      label: actor.label,
      actorId: settings.steps[actor.key].actorId,
      writes: actor.writes.map((f) => ENRICH_FIELD_LABELS[f]),
      willRun: on && has,
      // Off beats missing. A step that is turned off would not run whatever
      // the record carried, so saying "no Website URL set" about it would send
      // somebody to fill in a field that changes nothing.
      skipReason: !on
        ? STEP_TURNED_OFF_REASON
        : has
          ? null
          : mayArrive
            ? actor.requires === "websiteUrl"
              ? "no Website URL set — unless a step above finds one first"
              : `no ${actor.requiresLabel} set — unless ${ENRICH_STEP_LABELS.facebookLookup} finds one first`
            : `no ${actor.requiresLabel} set`,
    });
  }
  return entries;
}

// Whether this run will search for a Facebook page: it has a clinic name to
// search on, and no Facebook URL already. A record that has one is left alone
// — the URL on the record is somebody's answer, and a search result is not a
// good enough reason to go looking for a second opinion.
export function needsFacebookLookup(inputs: EnrichInputs): boolean {
  return (
    (inputs.facebookUrl ?? "").trim() === "" && inputs.clinicName.trim() !== ""
  );
}

// Whether this run will search for a website: it has a clinic name to search
// on, and no website already. Same rule as the Facebook one, and the same
// reason for it — a URL on the record is somebody's answer, and a search
// result is not grounds for a second opinion.
//
// It is a "will it be needed", not a "will it run". Whether it actually runs
// is settled during the run by whether the two actors ahead of the crawler
// reported a website first, which nothing can know from here.
export function needsWebsiteLookup(inputs: EnrichInputs): boolean {
  return (
    (inputs.websiteUrl ?? "").trim() === "" && inputs.clinicName.trim() !== ""
  );
}

// A lookup's row in the plan. Simpler than an actor's, because unlike them a
// lookup has no input of its own to be missing — it is called for when there
// is a name and no URL — so being turned off is the only thing that stops it
// outright, and for the website one, being beaten to the answer.
function lookupPlanEntry(
  key: EnrichLookupKey,
  settings: PipelineSettings,
): EnrichPlanEntry {
  const step = settings.steps[LOOKUP_SETTINGS_KEY];
  const writes =
    key === "facebookLookup"
      ? ENRICH_FIELD_LABELS.facebookUrl
      : ENRICH_FIELD_LABELS.websiteUrl;
  return {
    key,
    label: ENRICH_STEP_LABELS[key],
    actorId: step.actorId,
    writes: [writes],
    willRun: step.enabled,
    skipReason: step.enabled ? null : STEP_TURNED_OFF_REASON,
  };
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

// The two above as partial updates, so an actor whose reader answers more than
// one field can compose them without each one having to spell out the "nothing
// found means touch nothing" rule again.
function countUpdate(raw: string): EnrichUpdate {
  const count = plausibleCount(raw);
  return count === null ? {} : { staffCountRaw: count };
}

function websiteUpdate(raw: string): EnrichUpdate {
  const url = plausibleWebsite(raw);
  return url === null ? {} : { websiteUrl: url };
}

// A scraped website, held to something the crawler could actually be pointed
// at. A bare "clinicname.com" is taken as https, because that is what a
// company page's website field usually holds and prefixing it is not a guess
// about anything. Anything that is not an http(s) address with a dotted host —
// a mailto:, an "N/A", a Facebook page pasted into the wrong field — is
// discarded rather than stored, because this value goes on to be requested.
function plausibleWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > WEBSITE_URL_MAX_CHARS) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A hostname with no dot in it is a local name, not a clinic's site.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
  return url.toString();
}

// The same test for a Facebook page, plus the one thing that makes it a
// Facebook page: the host. A search result is only ever written into this
// field when it is a link on facebook.com — the ads actor is pointed at
// whatever ends up here, and a directory listing that mentioned the clinic
// would cost a run and come back with nothing.
function plausibleFacebookUrl(raw: string): string | null {
  const url = plausibleWebsite(raw);
  if (url === null) return null;
  const host = new URL(url).hostname.toLowerCase();
  const isFacebook = ["facebook.com", "fb.com"].some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
  return isFacebook ? url : null;
}

// Whether a scraped website may be written onto this record. Filled, never
// overwritten: a URL somebody typed in is a decision, and an actor's idea of
// which site belongs to a clinic of this name is not a good enough reason to
// replace one. Blank is the only state this field is allowed to move out of.
export function fillableWebsiteUrl(
  update: EnrichUpdate,
  current: string | null | undefined,
): boolean {
  return (
    update.websiteUrl !== undefined && (current ?? "").trim() === ""
  );
}

// The ads signal, built from the whole result rather than from any one item:
// each item is one ad, so counting the ones still running is the answer and
// the earliest of their start dates says how long this clinic has been at it.
// "3 active ads, running 4mo".
//
// A library with nothing live in it is worth a sentence of its own rather than
// a blank, because "advertises, but not right now" and "has never advertised"
// are different clinics — the scorecard's Budget Signal category scores them
// one point apart.
function adsSignal(table: EnrichTable, cap: number): string | null {
  const total = table.rows.length;
  if (total === 0) return null;

  // An actor build that doesn't report isActive at all would otherwise read as
  // a library with nothing live in it. The run asked for active ads, so with
  // no flag to go on, that is what these are taken to be.
  const flagged = hasField(table, ["isActive", "is_active"]);

  let active = 0;
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;

  for (let i = 0; i < total; i++) {
    const isActive =
      !flagged || isTrue(cell(table, i, ["isActive", "is_active"]));
    const start = timestamp(
      cell(table, i, ["startDateFormatted", "startDate", "start_date"]),
    );
    const end = timestamp(
      cell(table, i, ["endDateFormatted", "endDate", "end_date"]),
    );

    if (isActive) {
      active++;
      if (start !== null && (earliestStart === null || start < earliestStart)) {
        earliestStart = start;
      }
    } else if (end !== null && (latestEnd === null || end > latestEnd)) {
      latestEnd = end;
    }
  }

  if (active === 0) {
    const ended =
      latestEnd === null
        ? ""
        : `, last ended ${duration(Date.now() - latestEnd)} ago`;
    return `No active ads — ${total} in the library${ended}`;
  }

  // A result that came back exactly at the ceiling was cut off there, so the
  // count is a floor rather than a total and says so.
  const capped = total >= cap;
  const plural = active === 1 && !capped ? "" : "s";
  const running =
    earliestStart === null
      ? ""
      : `, running ${duration(Date.now() - earliestStart)}`;
  return `${active}${capped ? "+" : ""} active ad${plural}${running}`;
}

// Whether the result carries a field at all, as against carrying it empty —
// the difference between an actor that doesn't report something and an item
// that had nothing to report.
function hasField(table: EnrichTable, candidates: string[]): boolean {
  return candidates.some((candidate) => {
    const wanted = candidate.toLowerCase();
    return table.headers.some(
      (h) =>
        h.toLowerCase() === wanted ||
        h.slice(h.lastIndexOf(".") + 1).toLowerCase() === wanted,
    );
  });
}

// Booleans arrive flattened to text, and not always the same text.
function isTrue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1";
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
  if (typeof update.websiteUrl === "string") {
    const url = plausibleWebsite(update.websiteUrl);
    if (url !== null) out.websiteUrl = url;
  }
  if (typeof update.facebookUrl === "string") {
    const url = plausibleFacebookUrl(update.facebookUrl);
    if (url !== null) out.facebookUrl = url;
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
