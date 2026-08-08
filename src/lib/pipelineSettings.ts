// Pipeline settings — which steps run, what they are called, where the bar is.
//
// Everything in here was a constant in the source until it wasn't: the five
// steps and their actor IDs in src/lib/leadEnrich.ts, and the promotion
// threshold as a bare 5 in src/lib/actions/discovery.ts. Swapping an actor for
// a cheaper one, or turning off a step whose credits had run out, used to be
// an edit and a deploy. It is a form now.
//
// Three deliberate limits on what a setting is allowed to be:
//
//   A step turned off is skipped, not failed. It reports itself the same way a
//   step with no URL to work from reports itself, because that path already
//   exists and is already gentle — nothing downstream has to learn a new kind
//   of nothing.
//
//   An actor ID is text somebody typed, so it is held to the same shape the
//   import holds a pasted ID to (src/lib/apifyId.ts) and falls back to the
//   built-in default when it is not one. A malformed ID stored in a settings
//   row must never become a malformed path segment in a request.
//
//   The promotion threshold moves the bar; it does not move the framework. The
//   A/B/C bands in src/lib/icp.ts are the scorecard's own and stay in code —
//   re-tiering every clinic in the app is not a setting.
//
// Pure. The row is read and written in src/lib/pipelineSettingsStore.ts, and
// this module is what both the server and the settings form agree on.

import { ICP_MAX_SCORE } from "@/lib/icp";
import { normalizeApifyId } from "@/lib/apifyId";
import { GOOGLE_SEARCH_ACTOR_ID } from "@/lib/googleSearch";

// The one row's id. A fixed string rather than "the first row": every read is
// a findUnique on this and every write an upsert of it, so there is no path
// that creates a second row and no question about which is in force.
export const PIPELINE_SETTINGS_ID = "singleton";

// ─── The steps ─────────────────────────────────────────────────────────────

// In the order they run. The enrichment chain reads its own order from
// ENRICH_ACTORS (src/lib/leadEnrich.ts) — this order is what the settings page
// lists them in, and the two agree because a page that listed them in a
// different order to the one they run in would be lying about the chain.
export const PIPELINE_STEP_KEYS = [
  "companyDetails",
  "facebookLookup",
  "facebookAds",
  "websiteContent",
  "googleReviews",
] as const;

export type PipelineStepKey = (typeof PIPELINE_STEP_KEYS)[number];

export const PIPELINE_STEP_LABELS: Record<PipelineStepKey, string> = {
  companyDetails: "Company Details",
  facebookLookup: "Facebook page lookup",
  facebookAds: "Facebook Ads Library",
  websiteContent: "Website Content Crawler",
  googleReviews: "Google Maps Reviews",
};

// What each one is for, in the one sentence the settings page shows under its
// name — what it needs, and what it puts on the record.
export const PIPELINE_STEP_BLURBS: Record<PipelineStepKey, string> = {
  companyDetails:
    "Reads the clinic's LinkedIn company page for a headcount and a website. Needs a Company LinkedIn URL.",
  facebookLookup:
    "Searches Google for the clinic's Facebook page when the record hasn't got one, and saves what it finds. Needs a clinic name.",
  facebookAds:
    "Counts what the clinic is running in the Meta ads library and how long it has been at it. Needs a Facebook URL.",
  websiteContent:
    "Crawls the first few pages of the clinic's site for the copy the scoring reads. Needs a Website URL.",
  googleReviews:
    "Finds the clinic on Maps for its review count, and a website if it has one. Needs a clinic name.",
};

// The IDs that were hardcoded before this table existed. An install that never
// opens the settings page runs exactly the chain it always ran.
export const DEFAULT_ACTOR_IDS: Record<PipelineStepKey, string> = {
  companyDetails: "harvestapi~linkedin-company",
  // Imported rather than repeated: the search module is where that actor is
  // described, and one of the two would eventually be edited without the other.
  facebookLookup: GOOGLE_SEARCH_ACTOR_ID,
  facebookAds: "apify~facebook-ads-scraper",
  websiteContent: "apify~website-content-crawler",
  googleReviews: "compass~crawler-google-places",
};

// ─── The settings ──────────────────────────────────────────────────────────

export interface PipelineStepSetting {
  enabled: boolean;
  actorId: string;
}

export interface PipelineSettings {
  steps: Record<PipelineStepKey, PipelineStepSetting>;
  promotionThreshold: number;
}

// The score a candidate has to reach to be promoted rather than rejected. The
// value this app shipped with, and still the value behind a database with no
// settings row in it.
export const DEFAULT_PROMOTION_THRESHOLD = 5;

// A threshold of 0 promotes everything that is not disqualified, and one of
// ICP_MAX_SCORE promotes only a perfect card. Both are daft and both are
// somebody's call to make; what is refused is a number outside the scale the
// score is even measured on.
export const MIN_PROMOTION_THRESHOLD = 0;
export const MAX_PROMOTION_THRESHOLD = ICP_MAX_SCORE;

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
  steps: Object.fromEntries(
    PIPELINE_STEP_KEYS.map((key) => [
      key,
      { enabled: true, actorId: DEFAULT_ACTOR_IDS[key] },
    ]),
  ) as Record<PipelineStepKey, PipelineStepSetting>,
  promotionThreshold: DEFAULT_PROMOTION_THRESHOLD,
};

// ─── Reading a row ─────────────────────────────────────────────────────────

// The stored row as the app's settings, with every field held to what it is
// allowed to be. Takes unknown rather than the Prisma type on purpose: this is
// the gate a row written by an older shape, a hand-edited database, or a
// posted form comes through, and all three should land on a working chain
// rather than on an exception.
//
// Null — no row at all, which is every fresh install — is the defaults.
export function readPipelineSettings(row: unknown): PipelineSettings {
  if (row === null || typeof row !== "object") return DEFAULT_PIPELINE_SETTINGS;
  const record = row as Record<string, unknown>;

  const steps = Object.fromEntries(
    PIPELINE_STEP_KEYS.map((key) => [
      key,
      {
        // Anything that is not a stored false is on. A step missing from the
        // row is a step this build knows about and that row didn't.
        enabled: record[`${key}Enabled`] !== false,
        actorId: readActorId(record[`${key}ActorId`], key),
      },
    ]),
  ) as Record<PipelineStepKey, PipelineStepSetting>;

  return {
    steps,
    promotionThreshold: readPromotionThreshold(record.promotionThreshold),
  };
}

// An actor ID as it will be used, or the built-in default. Normalised on the
// way through — a pasted `username/name` becomes `username~name`, which is
// what the console shows and what the API wants.
export function readActorId(raw: unknown, key: PipelineStepKey): string {
  if (typeof raw !== "string") return DEFAULT_ACTOR_IDS[key];
  return normalizeApifyId(raw) ?? DEFAULT_ACTOR_IDS[key];
}

// The bar, held to the scale. A number outside it, or no number at all, is the
// default rather than a chain that can never promote anything.
export function readPromotionThreshold(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_PROMOTION_THRESHOLD;
  const rounded = Math.round(n);
  if (rounded < MIN_PROMOTION_THRESHOLD) return MIN_PROMOTION_THRESHOLD;
  if (rounded > MAX_PROMOTION_THRESHOLD) return MAX_PROMOTION_THRESHOLD;
  return rounded;
}

// The settings as the flat columns the table stores. Written here rather than
// at the call site so the column names live next to the keys they came from.
export function pipelineSettingsRow(
  settings: PipelineSettings,
): Record<string, string | number | boolean> {
  const row: Record<string, string | number | boolean> = {
    promotionThreshold: settings.promotionThreshold,
  };
  for (const key of PIPELINE_STEP_KEYS) {
    row[`${key}Enabled`] = settings.steps[key].enabled;
    row[`${key}ActorId`] = settings.steps[key].actorId;
  }
  return row;
}

export function isPipelineStepKey(v: unknown): v is PipelineStepKey {
  return (
    typeof v === "string" &&
    (PIPELINE_STEP_KEYS as readonly string[]).includes(v)
  );
}

// Whether the stored settings are still the ones this app shipped with. The
// settings page says so, because "nothing here has been changed" is the most
// useful thing a settings page can tell somebody who has just opened it.
export function isDefaultPipelineSettings(settings: PipelineSettings): boolean {
  return (
    settings.promotionThreshold === DEFAULT_PROMOTION_THRESHOLD &&
    PIPELINE_STEP_KEYS.every(
      (key) =>
        settings.steps[key].enabled &&
        settings.steps[key].actorId === DEFAULT_ACTOR_IDS[key],
    )
  );
}

// ─── What a run costs ──────────────────────────────────────────────────────

// Rough published rates, per step, as of writing.
//
// Every number here is an approximation and the UI says so. They exist to
// answer "is this queue going to cost pennies or dollars" before somebody
// presses a button that spends real credit — a question that was previously
// unanswerable without opening the Apify console — and not to reconcile a
// bill. Actors change their pricing; when one does, this is the one place to
// correct it.
//
// unitsPerCandidate is what one candidate typically consumes, not the ceiling
// the run is capped at. The ads scraper is capped at fifty ads and a clinic
// running fifty ads is not a typical clinic, so the estimate uses the typical
// figure and would rather be a little low on the outlier than wildly high on
// everything else.
export interface PipelineStepRate {
  usdPerUnit: number;
  unitsPerCandidate: number;
  // What a unit is, for the line the settings page shows: "per company page".
  unit: string;
}

export const PIPELINE_STEP_RATES: Record<PipelineStepKey, PipelineStepRate> = {
  companyDetails: { usdPerUnit: 0.01, unitsPerCandidate: 1, unit: "company page" },
  facebookLookup: { usdPerUnit: 0.004, unitsPerCandidate: 1, unit: "search" },
  facebookAds: { usdPerUnit: 0.003, unitsPerCandidate: 10, unit: "ad" },
  websiteContent: { usdPerUnit: 0.001, unitsPerCandidate: 3, unit: "page" },
  googleReviews: { usdPerUnit: 0.004, unitsPerCandidate: 5, unit: "place" },
};

export function stepCostPerCandidate(key: PipelineStepKey): number {
  const rate = PIPELINE_STEP_RATES[key];
  return rate.usdPerUnit * rate.unitsPerCandidate;
}

// What one candidate costs to put through the chain, under these settings.
// Only the steps that are on, because a step that is off costs nothing — which
// is the other half of what the toggles are for.
export function costPerCandidate(settings: PipelineSettings): number {
  return PIPELINE_STEP_KEYS.filter((key) => settings.steps[key].enabled).reduce(
    (total, key) => total + stepCostPerCandidate(key),
    0,
  );
}

export function estimateQueueCost(
  candidates: number,
  settings: PipelineSettings,
): number {
  return Math.max(0, candidates) * costPerCandidate(settings);
}

// Money as an estimate reads, which is not how money reads. The tilde is part
// of the string on purpose: every number this produces is a guess, and one
// printed as "$2.40" would be read as a quote.
//
// Anything under a cent says so rather than rounding to "~$0.00", which looks
// like free.
export function fmtEstimate(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `~$${usd.toFixed(2)}`;
}

// "~$0.80 for 12 candidates". The whole sentence, built here so the queue
// dialog and the import wizard cannot word it two different ways.
export function estimateSentence(
  candidates: number,
  settings: PipelineSettings,
): string {
  const total = estimateQueueCost(candidates, settings);
  return `${fmtEstimate(total)} for ${candidates} candidate${candidates === 1 ? "" : "s"}`;
}
