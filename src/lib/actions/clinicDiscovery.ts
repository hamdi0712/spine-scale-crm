"use server";

// Clinic-First Discovery — the write.
//
// The search itself is a background job (startClinicSearchJob in
// src/lib/actions/jobs.ts): it costs money and returns something to look at,
// and can run for many minutes. Writing happens only here, when somebody has
// seen what would be written and pressed the button.
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
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import {
  CLINIC_FIRST_BATCH_DESCRIPTION,
  CLINIC_FIRST_SOURCE,
  ClinicCandidate,
  MAX_CLINIC_RESULTS,
} from "@/lib/clinicDiscovery";
import {
  DEDUPE_RUNG_LABELS,
  DedupeIndex,
  mergeFill,
  mergeSources,
} from "@/lib/discoveryDedupe";
import { IMPORT_DEFAULT_STATUS } from "@/lib/discoveryImport";
import { defaultBatchLabel, readBatchLabel } from "@/lib/discoveryBatch";
import { zoneFromLocation } from "@/lib/timezones";
import { mapsEmailFields, pickMapsEmails } from "@/lib/emailFind";

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
    // The search's addresses, cleaned and ranked once for either path below:
    // junk and vendor addresses gone, the best one as the email, the rest as
    // alternates, none of them checked.
    const emailFields = mapsEmailFields(
      pickMapsEmails(clinic.email ? [clinic.email, ...clinic.emails] : clinic.emails, clinic),
    );

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
      // The email and what is known about it go together: all four only onto
      // a row with no email, so an address already there never ends up beside
      // a label or alternates that describe a different one.
      const emailPatch =
        (existing.email ?? "").trim() === "" && emailFields.email !== null ? emailFields : null;
      await prisma.discoveryCandidate.update({
        where: { id: existing.id },
        // The pathway is not rewritten. A candidate LinkedIn found first was
        // found by LinkedIn first, and `source` above is where the second
        // sighting is recorded.
        data: { ...patch, ...(emailPatch ?? {}), source },
      });
      // Keeps the index honest for the rest of this batch: the merged row now
      // carries whatever it just gained, so a later result matching on the new
      // website merges into it too.
      candidateIndex.add({ ...existing, ...patch, email: emailPatch?.email ?? existing.email });
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
        ...emailFields,
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
      emails: Array.isArray(record.emails)
        ? record.emails.map(text).filter((e): e is string => e !== null).slice(0, 50)
        : [],
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
