"use server";

// The enrichment run on a lead: four actors, one press.
//
// The loop that runs them lives in src/lib/enrichRun.ts, because the discovery
// queue runs exactly the same four against a candidate. What is left here is
// this side of it — reading the lead's inputs, and writing the result back onto
// that lead.
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
import { runEnrichActors } from "@/lib/enrichRun";
import {
  ENRICH_FIELD_LABELS,
  EnrichInputs,
  EnrichRunResult,
  EnrichTable,
  EnrichUpdate,
  enrichActor,
  enrichFieldsWritten,
  enrichValuePreview,
  fillableWebsiteUrl,
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
  // "ask": several candidate clinics coming back is a question for the person
  // whose lead this is, and this dialog is where they answer it.
  const { outcomes, update } = await runEnrichActors(inputs, {
    onChoice: "ask",
  });

  const enrichedAt = await writeEnrichment(leadId, update);
  return {
    outcomes,
    written: enrichFieldsWritten(update),
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
  const read = sanitizeEnrichUpdate(actor.read(table));

  // Same rule the run itself applies: a website URL is filled, never
  // overwritten, and dropping it here means the report below says what was
  // actually kept rather than what was read.
  const current = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { websiteUrl: true },
  });
  const update =
    read.websiteUrl !== undefined && !fillableWebsiteUrl(read, current?.websiteUrl)
      ? omitWebsiteUrl(read)
      : read;

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

function omitWebsiteUrl(update: EnrichUpdate): EnrichUpdate {
  const { websiteUrl: _dropped, ...rest } = update;
  return rest;
}

// The only write in this file, and an update in every case — the id is the one
// bound to the action, and the data is at most the enrichment fields plus their
// dates. Returns the stamp it wrote, or null when there was nothing to write:
// an empty update is not an enrichment and must not re-date one.
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
