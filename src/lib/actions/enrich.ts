"use server";

// The enrichment run: four actors, one press.
//
// Called straight from the panel, which awaits the result rather than posting
// a form — the run's report has to come back to the browser to be read, and
// only the fields it could read with certainty have been written by then.
//
// The lead id is bound on the server (src/app/(app)/pipeline/[id]/page.tsx),
// so it is the record whose page the panel was opened from and not something
// the browser names. Neither function here can create a lead: prisma.lead is
// only ever updated, and only ever on that id.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { runApifySync } from "@/lib/apify";
import {
  ENRICH_ACTORS,
  ENRICH_FIELD_LABELS,
  EnrichInputs,
  EnrichOutcome,
  EnrichRunResult,
  EnrichTable,
  EnrichUpdate,
  candidateLabel,
  enrichActor,
  enrichFieldsWritten,
  enrichValuePreview,
  sanitizeEnrichUpdate,
} from "@/lib/leadEnrich";

const LEAD_INPUT_SELECT = {
  clinicName: true,
  companyLinkedinUrl: true,
  facebookUrl: true,
  websiteUrl: true,
  location: true,
} as const;

export async function runLeadEnrichment(
  leadId: string,
): Promise<EnrichRunResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: LEAD_INPUT_SELECT,
  });
  if (!lead) {
    return {
      outcomes: [],
      written: [],
      enrichedAt: null,
      error: "That lead no longer exists.",
    };
  }

  const inputs: EnrichInputs = lead;
  const outcomes: EnrichOutcome[] = [];
  let merged: EnrichUpdate = {};

  // In sequence rather than in parallel. Four runs at once would finish
  // sooner, but they are billed to a live account and a mistyped URL is
  // cheaper to notice one run at a time.
  for (const actor of ENRICH_ACTORS) {
    const required = inputs[actor.requires];
    if (typeof required !== "string" || required.trim() === "") {
      outcomes.push({
        key: actor.key,
        status: "skipped",
        detail: `no ${actor.requiresLabel} set`,
      });
      continue;
    }

    // One actor's failure is that actor's failure. The batch carries on: a
    // Facebook page that 404s should not cost the lead its website notes.
    let result;
    try {
      result = await runApifySync({
        kind: "actor",
        id: actor.actorId,
        // Built here and immediately re-read by the same JSON validation the
        // bulk import goes through, so there is one path into an actor run
        // rather than a checked one and a trusted one.
        input: JSON.stringify(actor.buildInput(inputs)),
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
    // lead. Nothing is written for this actor; the rows come back with the
    // report so the choice can be applied without paying for the run twice.
    if (actor.identifies && table.rows.length > 1) {
      outcomes.push({
        key: actor.key,
        status: "choose",
        detail: `${table.rows.length} possible matches — pick the right one`,
        headers: table.headers,
        rows: table.rows,
        options: table.rows.map((_, i) => candidateLabel(actor, table, i)),
      });
      continue;
    }

    const update = sanitizeEnrichUpdate(actor.read(table));
    const fields = enrichFieldsWritten(update);
    if (fields.length === 0) {
      outcomes.push({
        key: actor.key,
        status: "empty",
        detail: `ran, but nothing in the result reads as ${actor.writes
          .map((f) => ENRICH_FIELD_LABELS[f].toLowerCase())
          .join(" or ")}`,
      });
      continue;
    }

    merged = { ...merged, ...update };
    outcomes.push({
      key: actor.key,
      status: "wrote",
      fields,
      values: fields.map((f) => enrichValuePreview(f, update)),
    });
  }

  const enrichedAt = await writeEnrichment(leadId, merged);
  return {
    outcomes,
    written: enrichFieldsWritten(merged),
    enrichedAt,
  };
}

// Applies the item a human picked out of a "choose" outcome. The row travels
// back as it was sent, and is read by the same reader the automatic path
// uses — so choosing the first candidate by hand writes exactly what a
// single-candidate run would have written on its own.
export async function applyEnrichSelection(
  leadId: string,
  actorKey: string,
  headers: unknown,
  row: unknown,
): Promise<EnrichRunResult> {
  const actor = enrichActor(actorKey);
  if (!actor) {
    return {
      outcomes: [],
      written: [],
      enrichedAt: null,
      error: "That is not one of the enrichment actors.",
    };
  }

  const table: EnrichTable = {
    headers: strings(headers),
    rows: [strings(row)],
  };
  const update = sanitizeEnrichUpdate(actor.read(table));
  const fields = enrichFieldsWritten(update);
  if (fields.length === 0) {
    return {
      outcomes: [
        {
          key: actor.key,
          status: "empty",
          detail: `that result carries nothing that reads as ${actor.writes
            .map((f) => ENRICH_FIELD_LABELS[f].toLowerCase())
            .join(" or ")}`,
        },
      ],
      written: [],
      enrichedAt: null,
    };
  }

  const enrichedAt = await writeEnrichment(leadId, update);
  return {
    outcomes: [
      {
        key: actor.key,
        status: "wrote",
        fields,
        values: fields.map((f) => enrichValuePreview(f, update)),
      },
    ],
    written: fields,
    enrichedAt,
  };
}

function strings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => (typeof v === "string" ? v : ""));
}

// The only write in this file, and an update in every case — the id is the one
// bound to the action, and the data is at most the four enrichment fields plus
// their dates. Returns the stamp it wrote, or null when there was nothing to
// write: an empty update is not an enrichment and must not re-date one.
async function writeEnrichment(
  leadId: string,
  update: EnrichUpdate,
): Promise<string | null> {
  if (enrichFieldsWritten(update).length === 0) return null;

  const now = new Date();
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      ...update,
      // The review date belongs to the count and moves only with it, so a run
      // where the Maps actor was skipped leaves the old count reading as old.
      ...(update.reviewCount !== undefined ? { reviewsCheckedAt: now } : {}),
      enrichedAt: now,
    },
  });

  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${leadId}`);
  return now.toISOString();
}
