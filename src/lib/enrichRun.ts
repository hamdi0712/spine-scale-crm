// Running the actors — the part both enrichment callers share.
//
// Which of them run, and which actor each one runs, comes in as settings
// (src/lib/pipelineSettings.ts) rather than being decided here: the caller
// reads the row and hands it over, so a lead page run and a queue run cannot
// end up honouring different settings. A step switched off is skipped on
// exactly the terms a step with a missing input is skipped.
//
// Four actors, plus two lookups that are not actors: a URL another step cannot
// run without is searched for (src/lib/googleSearch.ts) immediately before the
// step that needs it, because otherwise that step is skipped on every run the
// record ever gets. Found, the URL is used by this run and returned to be
// saved; not found, the step it was for is skipped exactly as it was before.
//
//   The Facebook page, before the ads actor. Runs whenever the record has no
//   Facebook URL, because nothing else in the chain reports one.
//
//   The website, before the crawler — and only after the company lookup and
//   the Maps search have both had their turn, since both report a website of
//   their own. It is the last resort for the field, not the first attempt at
//   it, which is why the Maps actor now runs ahead of the crawler rather than
//   after it (see ENRICH_ACTORS).
//
// Both are the same actor under the same switch: one "Google Search" step in
// Pipeline Settings, because that is what turning it off means.
//
// There are two of them now. The lead page runs this against a Lead and writes
// what comes back onto that lead; the discovery queue runs it against a
// DiscoveryCandidate as step one of the scoring chain. They differ in what
// they do with the result and in nothing else, so the loop that actually
// spends money lives here, once, and neither of them owns it.
//
// Server-only, on the same terms as src/lib/apify.ts — this module reaches the
// network and must never be imported from a client component. It touches no
// database: it takes the fields a record already carries, returns what the
// actors said, and leaves the writing to the caller.
//
// It is deliberately not a "use server" module. Those may export nothing but
// server actions, and this is a helper two actions call — not an endpoint the
// browser is allowed to reach on its own.

import { runApifySync } from "@/lib/apify";
import {
  ENRICH_ACTORS,
  ENRICH_FIELD_LABELS,
  EnrichInputs,
  EnrichOutcome,
  EnrichTable,
  EnrichUpdate,
  candidateLabel,
  enrichFieldsWritten,
  enrichValuePreview,
  needsFacebookLookup,
  needsWebsiteLookup,
  sanitizeEnrichUpdate,
  LOOKUP_SETTINGS_KEY,
  STEP_TURNED_OFF_REASON,
} from "@/lib/leadEnrich";
import { PipelineSettings } from "@/lib/pipelineSettings";
import {
  facebookSearchQuery,
  firstClinicWebsite,
  firstFacebookPage,
  websiteSearchQuery,
} from "@/lib/googleSearch";
import { runGoogleSearch } from "@/lib/googleSearchRun";

export interface EnrichActorsResult {
  // One entry per actor, always — a run of four reports four things.
  outcomes: EnrichOutcome[];
  // Everything the run read, merged, ready to be written as-is.
  update: EnrichUpdate;
}

// What to do when an actor that identifies a clinic comes back with several of
// them. "ask" hands the candidates to the caller to put in front of a human —
// the lead page's chooser. "skip" writes nothing for that actor and says so,
// which is the only honest answer inside an unattended queue: there is nobody
// there to pick, and picking the first would put another clinic's review count
// on this record where it would read as a fact forever.
export type ChoiceHandling = "ask" | "skip";

export async function runEnrichActors(
  inputs: EnrichInputs,
  {
    onChoice = "ask",
    settings,
  }: { onChoice?: ChoiceHandling; settings: PipelineSettings },
): Promise<EnrichActorsResult> {
  const outcomes: EnrichOutcome[] = [];
  let merged: EnrichUpdate = {};

  // The inputs as they stand *during* the run, which is not always how they
  // started: the company lookup runs first and can report a website the record
  // never had, and the crawler two actors later is the one thing that needs
  // it. A website discovered mid-run is therefore used by the same run rather
  // than sitting unused until the next one.
  const live: EnrichInputs = { ...inputs };

  // In sequence rather than in parallel. Four runs at once would finish
  // sooner, but they are billed to a live account and a mistyped URL is
  // cheaper to notice one run at a time.
  for (const actor of ENRICH_ACTORS) {
    // The one step that runs in front of an actor rather than as one.
    //
    // Without a Facebook URL the ads step is skipped, and on a record that
    // never had one it is skipped on every run forever — so before giving up
    // on it, the clinic's name is searched for the page. What comes back is
    // used by this run and merged into the update, which is what stops the
    // next run having to search again.
    //
    // Nothing about the skip itself changes: a search that finds no usable
    // page leaves live.facebookUrl empty, and the check below skips the ads
    // actor for exactly the reason it always did.
    if (
      actor.key === "facebookAds" &&
      needsFacebookLookup(live) &&
      settings.steps[LOOKUP_SETTINGS_KEY].enabled
    ) {
      const found = await lookUpFacebookUrl(live, outcomes, settings);
      if (found !== null) {
        live.facebookUrl = found;
        // Merged here rather than with the ads actor's own result. The two are
        // separate findings: the page was found whether or not the run that
        // follows reads an ad off it, and a failed ads run must not cost the
        // record the URL that would have made the next one cheaper.
        merged = { ...merged, facebookUrl: found };
      }
    }

    // The same again, for the website the crawler needs.
    //
    // The condition worth reading is needsWebsiteLookup(live) rather than
    // (inputs): live carries what this run has learned, so by the time the
    // crawler's turn comes round both the company lookup and the Maps search
    // have had their chance to report a website — and if either did, no search
    // is run at all. This is the last resort, and only reached when the two
    // actors that get a website for free came back without one.
    if (
      actor.key === "websiteContent" &&
      needsWebsiteLookup(live) &&
      settings.steps[LOOKUP_SETTINGS_KEY].enabled
    ) {
      const found = await lookUpWebsiteUrl(live, outcomes, settings);
      if (found !== null) {
        live.websiteUrl = found;
        merged = { ...merged, websiteUrl: found };
      }
    }

    // Turned off in Pipeline Settings. Skipped on exactly the terms a step
    // with no URL to work from is skipped — reported, never fatal, and the
    // rest of the chain carries on — so nothing downstream had to learn a new
    // kind of nothing when the toggles arrived.
    if (!settings.steps[actor.key].enabled) {
      outcomes.push({
        key: actor.key,
        status: "skipped",
        detail: STEP_TURNED_OFF_REASON,
      });
      continue;
    }

    const required = live[actor.requires];
    if (typeof required !== "string" || required.trim() === "") {
      outcomes.push({
        key: actor.key,
        status: "skipped",
        detail: `no ${actor.requiresLabel} set`,
      });
      continue;
    }

    // One actor's failure is that actor's failure. The batch carries on: a
    // Facebook page that 404s should not cost the record its website notes.
    let result;
    try {
      result = await runApifySync({
        kind: "actor",
        // The actor this step runs, as Pipeline Settings has it — the ID this
        // app shipped with unless somebody has changed it.
        id: settings.steps[actor.key].actorId,
        // Built here and immediately re-read by the same JSON validation the
        // bulk import goes through, so there is one path into an actor run
        // rather than a checked one and a trusted one.
        input: JSON.stringify(actor.buildInput(live)),
        maxItems: actor.maxItems,
      });
    } catch {
      outcomes.push({
        key: actor.key,
        status: "failed",
        detail:
          "The run could not be reached. Check the server's network connection and try again.",
      });
      continue;
    }

    if (!result.ok) {
      outcomes.push({ key: actor.key, status: "failed", detail: result.error });
      continue;
    }

    const table: EnrichTable = { headers: result.headers, rows: result.rows };

    // Several candidate clinics, and no way to tell from here which is this
    // record.
    if (actor.identifies && table.rows.length > 1) {
      outcomes.push(
        onChoice === "ask"
          ? {
              key: actor.key,
              status: "choose",
              detail: `${table.rows.length} possible matches — pick the right one`,
              headers: table.headers,
              rows: table.rows,
              options: table.rows.map((_, i) => candidateLabel(actor, table, i)),
            }
          : {
              key: actor.key,
              status: "empty",
              detail: `${table.rows.length} possible matches came back — nothing was written rather than assume which of them is this clinic`,
            },
      );
      continue;
    }

    const read = sanitizeEnrichUpdate(actor.read(table));
    // The website is filled, never overwritten. Dropping it here rather than
    // at the write means the outcome below reports what was actually kept.
    const droppedWebsite =
      read.websiteUrl !== undefined && (live.websiteUrl ?? "").trim() !== "";
    const update = droppedWebsite ? omitWebsite(read) : read;

    const fields = enrichFieldsWritten(update);
    if (fields.length === 0) {
      outcomes.push({
        key: actor.key,
        status: "empty",
        detail: droppedWebsite
          ? "ran, and the only thing it added was a website URL this record already has"
          : `ran, but nothing in the result reads as ${actor.writes
              .map((f) => ENRICH_FIELD_LABELS[f].toLowerCase())
              .join(" or ")}`,
      });
      continue;
    }

    if (update.websiteUrl !== undefined) live.websiteUrl = update.websiteUrl;

    merged = { ...merged, ...update };
    outcomes.push({
      key: actor.key,
      status: "wrote",
      fields,
      values: fields.map((f) => enrichValuePreview(f, update)),
    });
  }

  return { outcomes, update: merged };
}

// The Facebook page lookup: one search, the first result on facebook.com, and
// an outcome saying which of those two it got to. Reports through the same
// outcome list as the actors — a step that spends money reports what it spent
// it on, whether or not it found anything.
//
// Returns the URL, or null for every way of not having one. A failed search is
// the run's own affair and not the record's: the caller carries on to the same
// skip it would have reached without this step at all.
async function lookUpFacebookUrl(
  live: EnrichInputs,
  outcomes: EnrichOutcome[],
  settings: PipelineSettings,
): Promise<string | null> {
  const query = facebookSearchQuery(live.clinicName, live.location);
  const search = await runGoogleSearch(
    query,
    settings.steps[LOOKUP_SETTINGS_KEY].actorId,
  );

  if (!search.ok) {
    outcomes.push({
      key: "facebookLookup",
      status: "failed",
      detail:
        search.error ??
        "The search for a Facebook page failed, so the Facebook Ads step had no URL to run on.",
    });
    return null;
  }

  // The first result on facebook.com, which is what the search was for. It is
  // sanitized on the way through rather than trusted, because this value is
  // about to be stored and handed to another actor.
  const page = firstFacebookPage(search.urls);
  const url =
    page === null ? undefined : sanitizeEnrichUpdate({ facebookUrl: page }).facebookUrl;
  if (url === undefined) {
    outcomes.push({
      key: "facebookLookup",
      status: "empty",
      detail: `searched for “${query}” and nothing in the results was a Facebook page — the Facebook Ads step is skipped, as it was before`,
    });
    return null;
  }

  outcomes.push({
    key: "facebookLookup",
    status: "wrote",
    fields: ["facebookUrl"],
    values: [enrichValuePreview("facebookUrl", { facebookUrl: url })],
  });
  return url;
}

// The website lookup: the same shape as the Facebook one above, and different
// in exactly two places.
//
// It rejects more than it accepts. A search for a clinic's Facebook page has
// one right kind of answer and facebook.com identifies it; a search for a
// clinic's website has one right answer surrounded by results that all look
// like websites — the Yelp listing, the Healthgrades profile, the directory
// entry that outranks the clinic's own site. firstClinicWebsite steps over
// those (the list is in src/lib/googleSearch.ts) rather than crawling somebody
// else's page and filing it as this clinic's copy.
//
// And it runs later than a reader might expect, which is the point of it: two
// actors above it report a website for free, so this only happens when neither
// did.
async function lookUpWebsiteUrl(
  live: EnrichInputs,
  outcomes: EnrichOutcome[],
  settings: PipelineSettings,
): Promise<string | null> {
  const query = websiteSearchQuery(live.clinicName, live.location);
  const search = await runGoogleSearch(
    query,
    settings.steps[LOOKUP_SETTINGS_KEY].actorId,
  );

  if (!search.ok) {
    outcomes.push({
      key: "websiteLookup",
      status: "failed",
      detail:
        search.error ??
        "The search for a website failed, so the Website Content Crawler had no URL to run on.",
    });
    return null;
  }

  // Held to the same standard a scraped website is held to, because it is
  // about to be stored in the same field and handed to the same crawler.
  const site = firstClinicWebsite(search.urls);
  const url =
    site === null ? undefined : sanitizeEnrichUpdate({ websiteUrl: site }).websiteUrl;
  if (url === undefined) {
    outcomes.push({
      key: "websiteLookup",
      status: "empty",
      detail: `searched for “${query}” and nothing in the results was the clinic's own site — the Website Content Crawler is skipped, as it was before`,
    });
    return null;
  }

  outcomes.push({
    key: "websiteLookup",
    status: "wrote",
    fields: ["websiteUrl"],
    values: [enrichValuePreview("websiteUrl", { websiteUrl: url })],
  });
  return url;
}

function omitWebsite(update: EnrichUpdate): EnrichUpdate {
  const { websiteUrl: _dropped, ...rest } = update;
  return rest;
}
