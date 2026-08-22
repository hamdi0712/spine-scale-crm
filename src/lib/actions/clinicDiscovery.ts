"use server";

// Clinic-First Discovery — the run, and the write.
//
// Two actions, and the split between them is the same one the Apify import
// makes: searching costs money and returns something to look at, so it happens
// on its own and comes back to the browser; writing happens only when somebody
// has seen what would be written and pressed the button.
//
// What it writes is ordinary DiscoveryCandidate rows, Pending, exactly as the
// CSV and Apify imports write them. Nothing about the enrichment chain, the
// scoring or the promotion logic is reached from here — a clinic-first
// candidate goes through the same Process Queue as everything else, and the
// only thing that knows the difference is the verdict step, which will not
// promote a clinic with nobody named at it.
//
// The actor is a setting (Settings → Pipeline), never a constant: this app
// does not know which place-search actor an account has, and hardcoding one
// would make the pathway unusable for anybody whose account has a different
// one.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { runApifySync } from "@/lib/apify";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import {
  CLINIC_FIRST_BATCH_DESCRIPTION,
  CLINIC_FIRST_SOURCE,
  ClinicCandidate,
  clinicSearchInput,
  normalizeClinicRow,
  readClinicSearchConfig,
} from "@/lib/clinicDiscovery";
import {
  DEDUPE_RUNG_LABELS,
  DedupeIndex,
  mergeFill,
  mergeSources,
} from "@/lib/discoveryDedupe";
import { IMPORT_DEFAULT_STATUS, MAX_IMPORT_ROWS } from "@/lib/discoveryImport";
import { defaultBatchLabel, readBatchLabel } from "@/lib/discoveryBatch";
import { zoneFromLocation } from "@/lib/timezones";

// How many results one run keeps in total, across every term. The import cap
// again, and for the same reason: every row kept is a row the queue will spend
// five actor runs and a model call on.
const MAX_CLINIC_RESULTS = MAX_IMPORT_ROWS;

export type ClinicSearchResult =
  | {
      ok: true;
      actorId: string;
      // One per clinic found, already normalised and already de-duplicated
      // against each other — but not yet against what is stored. That check
      // runs at import time, against the database as it stands then.
      clinics: ClinicCandidate[];
      // What each term returned, so a term that found nothing says so rather
      // than disappearing into a total.
      perTerm: { term: string; found: number; error?: string }[];
    }
  | { ok: false; error: string };

// ─── The search ────────────────────────────────────────────────────────────

// Runs the configured actor once per search term and normalises everything it
// returns into clinic candidates.
//
// A term that fails does not fail the run. Nine terms and one bad one is nine
// terms' worth of clinics plus a line saying what happened to the tenth —
// throwing all of it away because one search 404'd would spend the credit and
// return nothing. A run where *every* term failed is a failed run, and says so
// with the first actor's own sentence.
export async function runClinicDiscoverySearch(args: {
  config: unknown;
  // Overrides the stored actor for this run only, so a different actor can be
  // tried without saving it. Nothing is persisted from here.
  actorId?: string;
}): Promise<ClinicSearchResult> {
  const config = readClinicSearchConfig(args?.config);
  if (config.terms.length === 0) {
    return { ok: false, error: "Add at least one search term to run." };
  }

  const settings = await loadPipelineSettings();
  if (!settings.clinicDiscovery.enabled) {
    return {
      ok: false,
      error:
        "Clinic-First Discovery is turned off. Turn it on under Settings → Pipeline, where its actor is set too.",
    };
  }
  // Held to the same shape a stored one is held to, so a typed override cannot
  // put anything into a URL that a saved setting could not.
  const actorId =
    typeof args?.actorId === "string" && args.actorId.trim() !== ""
      ? args.actorId.trim()
      : settings.clinicDiscovery.actorId;

  const clinics: ClinicCandidate[] = [];
  const perTerm: { term: string; found: number; error?: string }[] = [];
  // Within one run: the same clinic under two search terms is one clinic.
  const seen = new DedupeIndex<ClinicCandidate & { clinicName: string }>();
  const errors: string[] = [];

  for (const term of config.terms) {
    if (clinics.length >= MAX_CLINIC_RESULTS) {
      perTerm.push({ term, found: 0, error: "Not run — the result cap was already reached." });
      continue;
    }
    const result = await runApifySync({
      kind: "actor",
      id: actorId,
      input: JSON.stringify(clinicSearchInput(term, config)),
      maxItems: config.resultsPerTerm,
    });
    if (!result.ok) {
      errors.push(result.error);
      perTerm.push({ term, found: 0, error: result.error });
      continue;
    }

    let found = 0;
    for (const cells of result.rows) {
      if (clinics.length >= MAX_CLINIC_RESULTS) break;
      const clinic = normalizeClinicRow({ headers: result.headers, cells }, term);
      // No name, no candidate — and no invention of one.
      if (!clinic) continue;
      if (seen.match(clinic)) continue;
      seen.add(clinic);
      clinics.push(clinic);
      found++;
    }
    perTerm.push({ term, found });
  }

  if (clinics.length === 0 && errors.length === config.terms.length) {
    return { ok: false, error: errors[0] };
  }

  return { ok: true, actorId, clinics, perTerm };
}

// ─── The write ─────────────────────────────────────────────────────────────

export interface ClinicImportSummary {
  created: number;
  merged: number;
  skipped: number;
  // One line per merge, so the page can say which clinic matched what and on
  // which rung rather than reporting a bare count.
  mergeNotes: string[];
}

// Writes the clinics the panel is showing.
//
// Every one of them is put through the match waterfall in
// src/lib/discoveryDedupe.ts against every candidate and every lead in the
// database — name and location first, then website domain, then company
// LinkedIn page, then name and contact. A hit is merged into the row that is
// already there: blank fields filled, the new source appended to the old one,
// and nothing that was already known overwritten. No second candidate is
// created, and nothing is ever deleted.
//
// A lead that matches is not merged into and not re-created either. That
// clinic has already been through Discovery and is in the pipeline; bringing
// it back as a candidate to be scored again is exactly what the duplicate test
// exists to prevent.
export async function importClinicDiscoveryCandidates(args: {
  clinics: unknown;
  actorId?: string;
  batchLabel?: string | null;
}): Promise<ClinicImportSummary> {
  const clinics = readClinics(args?.clinics);
  const summary: ClinicImportSummary = {
    created: 0,
    merged: 0,
    skipped: 0,
    mergeNotes: [],
  };
  if (clinics.length === 0) return summary;

  const actorId =
    typeof args?.actorId === "string" && args.actorId.trim() !== ""
      ? args.actorId.trim()
      : null;
  const batchLabel =
    readBatchLabel(args?.batchLabel ?? null) ??
    defaultBatchLabel(new Date(), CLINIC_FIRST_BATCH_DESCRIPTION);

  const [candidates, leads] = await Promise.all([
    prisma.discoveryCandidate.findMany({
      select: {
        id: true,
        clinicName: true,
        location: true,
        websiteUrl: true,
        companyLinkedinUrl: true,
        contactName: true,
        contactTitle: true,
        linkedinUrl: true,
        facebookUrl: true,
        phone: true,
        email: true,
        source: true,
        timeZone: true,
        sourceActor: true,
        sourceQuery: true,
      },
    }),
    prisma.lead.findMany({
      select: {
        clinicName: true,
        location: true,
        websiteUrl: true,
        companyLinkedinUrl: true,
        contactName: true,
      },
    }),
  ]);

  const candidateIndex = new DedupeIndex(candidates);
  const leadIndex = new DedupeIndex(leads);

  for (const clinic of clinics) {
    const inPipeline = leadIndex.match(clinic);
    if (inPipeline) {
      summary.skipped++;
      continue;
    }

    const hit = candidateIndex.match(clinic);
    if (hit) {
      const existing = hit.existing;
      // Absence is the only thing a merge may change — see mergeFill.
      const patch = mergeFill(existing, {
        websiteUrl: clinic.websiteUrl,
        location: clinic.location,
        companyLinkedinUrl: clinic.companyLinkedinUrl,
        facebookUrl: clinic.facebookUrl,
        phone: clinic.phone,
        email: clinic.email,
        contactName: clinic.contactName,
        contactTitle: clinic.contactTitle,
        linkedinUrl: clinic.linkedinUrl,
        timeZone: zoneFromLocation(clinic.location),
        // How this sighting found the clinic — kept only where nothing was
        // recorded before. The first search that found it is the one worth
        // knowing about, so a later term does not overwrite an earlier one.
        sourceActor: actorId,
        sourceQuery: clinic.sourceQuery,
      });
      const source = mergeSources(existing.source, CLINIC_FIRST_SOURCE);
      await prisma.discoveryCandidate.update({
        where: { id: existing.id },
        // The pathway is not rewritten. A candidate LinkedIn found first was
        // found by LinkedIn first, and `source` above is where the second
        // sighting is recorded.
        data: { ...patch, source },
      });
      // Keeps the index honest for the rest of this batch: the merged row now
      // carries whatever it just gained, so a later result matching on the new
      // website merges into it too.
      candidateIndex.add({ ...existing, ...patch });
      summary.merged++;
      summary.mergeNotes.push(
        `${clinic.clinicName} — already in Discovery as “${existing.clinicName}” (${DEDUPE_RUNG_LABELS[hit.rung]})`,
      );
      continue;
    }

    const created = await prisma.discoveryCandidate.create({
      data: {
        clinicName: clinic.clinicName,
        websiteUrl: clinic.websiteUrl,
        location: clinic.location,
        timeZone: zoneFromLocation(clinic.location),
        companyLinkedinUrl: clinic.companyLinkedinUrl,
        facebookUrl: clinic.facebookUrl,
        phone: clinic.phone,
        email: clinic.email,
        // All three stay null unless the actor really returned them. A
        // clinic-first candidate with no decision-maker is the ordinary case,
        // and a blank person on the record would read as a person.
        contactName: clinic.contactName,
        contactTitle: clinic.contactTitle,
        linkedinUrl: clinic.linkedinUrl,
        source: CLINIC_FIRST_SOURCE,
        discoverySource: "CLINIC_FIRST",
        sourceActor: actorId,
        sourceQuery: clinic.sourceQuery,
        status: IMPORT_DEFAULT_STATUS,
        batchLabel,
      },
      select: {
        id: true,
        clinicName: true,
        location: true,
        websiteUrl: true,
        companyLinkedinUrl: true,
        contactName: true,
        contactTitle: true,
        linkedinUrl: true,
        facebookUrl: true,
        phone: true,
        email: true,
        source: true,
        timeZone: true,
        sourceActor: true,
        sourceQuery: true,
      },
    });
    // So the rest of this batch dedupes against it too — and, because it is
    // the row as written, a second sighting of it merges against what it
    // actually has rather than against a half-filled copy.
    candidateIndex.add(created);
    summary.created++;
  }

  revalidatePath("/discovery");
  return summary;
}

// The clinics as they came back over the wire. They were produced by the
// search action above, but they made a round trip through a browser to get
// here, so every field is read again rather than trusted.
function readClinics(raw: unknown): ClinicCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: ClinicCandidate[] = [];
  for (const item of raw.slice(0, MAX_CLINIC_RESULTS)) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const clinicName = text(record.clinicName);
    if (clinicName === null) continue;
    out.push({
      clinicName,
      websiteUrl: text(record.websiteUrl),
      location: text(record.location),
      city: text(record.city),
      state: text(record.state),
      country: text(record.country),
      companyLinkedinUrl: text(record.companyLinkedinUrl),
      facebookUrl: text(record.facebookUrl),
      phone: text(record.phone),
      email: text(record.email),
      contactName: text(record.contactName),
      contactTitle: text(record.contactTitle),
      linkedinUrl: text(record.linkedinUrl),
      sourceQuery: text(record.sourceQuery) ?? "",
    });
  }
  return out;
}

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

// The config a run uses, for the panel. Nothing sensitive: the actor ID and
// whether the pathway is on at all, so the page can say "off" rather than
// offering a button that always fails.
export async function clinicDiscoverySettings(): Promise<{
  enabled: boolean;
  actorId: string;
}> {
  const settings = await loadPipelineSettings();
  return settings.clinicDiscovery;
}
