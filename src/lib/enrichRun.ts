// Running the four actors — the part both enrichment callers share.
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
  sanitizeEnrichUpdate,
} from "@/lib/leadEnrich";

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
  { onChoice = "ask" }: { onChoice?: ChoiceHandling } = {},
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
        id: actor.actorId,
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

function omitWebsite(update: EnrichUpdate): EnrichUpdate {
  const { websiteUrl: _dropped, ...rest } = update;
  return rest;
}
