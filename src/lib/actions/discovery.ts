"use server";

// Discovery — the import that feeds it, and the queue that empties it.
//
// The queue is the whole point of this file, and one property of it is worth
// stating before the code: it runs one candidate per call, in the foreground,
// while somebody watches. There is no job runner in this app and this does not
// pretend to be one. The browser asks for the queue, then calls
// processDiscoveryCandidate once per candidate and shows each result as it
// lands; closing the tab stops the queue after whatever candidate is in flight,
// and every candidate it never reached is still Pending for next time.
//
// That is a deliberate choice rather than a shortcut. Each candidate costs four
// actor runs and a model call against live accounts, and a queue that empties
// itself in the background is a queue that can spend a day's credit while
// nobody is looking at it. The UI says so in as many words.
//
// The chain per candidate is fixed and in order: enrich, compute what can be
// computed, ask the model for the rest, combine, then promote or reject. It
// only ever moves forward — a candidate is processed from the top each time
// rather than resumed — because scoring on half a run's evidence is the one
// thing this flow exists to prevent.
//
// Three gates enforce that, and they are the same rule at three depths. An
// actor that failed outright stops the candidate, because the evidence is
// incomplete in a way the numbers would not show. Nothing gathered at all
// stops it, because a total would be a number put on an empty page. And two
// or more scored categories with nothing to attempt them on stop it too, with
// the missing inputs named — a clinic nobody managed to look at is not a
// clinic that scored badly, and a stored 3/10 would say it was.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runEnrichActors } from "@/lib/enrichRun";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { deepSeekJson } from "@/lib/deepseek";
import {
  ENRICH_STEP_LABELS,
  EnrichInputs,
  isEnrichLookupKey,
  EnrichOutcome,
  EnrichUpdate,
  enrichFieldsWritten,
} from "@/lib/leadEnrich";
import {
  DISCOVERY_QUEUE_STATUSES,
  DiscoveryBreakdown,
  DiscoveryProcessResult,
  DiscoveryScoringInput,
  DiscoveryStep,
  budgetSignalScore,
  buildBreakdown,
  leadScorecardPrefill,
  parseBreakdown,
  rejectionReason,
  serializeBreakdown,
  staffSizeScore,
} from "@/lib/discovery";
import {
  DISCOVERY_ASSIST_MAX_TOKENS,
  MIN_UNGATHERED_TO_FAIL,
  buildDiscoveryPrompt,
  parseDiscoverySuggestion,
  precheckGaps,
  precheckNote,
  ungatheredFailureReason,
  ungatheredItems,
} from "@/lib/discoveryAssist";
import { assistEvidenceLabels, hasAssistEvidence } from "@/lib/icpAssist";
import { ICP_MAX_SCORE, IcpGapKey } from "@/lib/icp";
import {
  IMPORT_DEFAULT_STATUS,
  ImportSummary,
  ImportedCandidate,
  MAX_IMPORT_ROWS,
  dedupeKey,
  mapRow,
  mappedColumn,
  readMapping,
} from "@/lib/discoveryImport";
import {
  BATCH_QUEUE_DESCRIPTION,
  defaultBatchLabel,
  readBatchLabel,
} from "@/lib/discoveryBatch";
import {
  ADD_BY_NAME_BATCH_DESCRIPTION,
  ADD_BY_NAME_SOURCE,
  AddByNameResult,
  clinicNameKey,
  readClinicName,
  readLocation,
} from "@/lib/discoveryAddByName";
// One promotion path for the queue, the manual override and the
// decision-maker stage — see src/lib/promoteLead.ts.
import { promoteToLead } from "@/lib/promoteLead";
import { firstClinicWebsite, websiteSearchQuery } from "@/lib/googleSearch";
import { runGoogleSearch } from "@/lib/googleSearchRun";
import { isUsTimeZone, zoneFromLocation } from "@/lib/timezones";

// Anything past this is a misclick that got through the confirmation rather
// than a day's work. Same ceiling, and the same reasoning, as the pipeline
// table's bulk actions.
const MAX_BULK_CANDIDATES = 200;

// ─── Import ────────────────────────────────────────────────────────────────

// Bulk import from a mapped CSV or Apify run
// (src/components/DiscoveryImportWizard.tsx). The wizard posts the raw rows
// plus the column mapping the user confirmed, and the rows are read here with
// the same helpers that produced the preview — so what was previewed is what
// gets written.
//
// It creates candidates, never leads. Nothing about the ICP scorecard is
// touched either: a staff count comes in as staffCountRaw and is not scored
// until the queue scores it.
export async function importDiscoveryCandidates(formData: FormData) {
  const rows = parseJson<string[][]>(formData, "rows");
  const rawMapping = parseJson<unknown[]>(formData, "mapping");
  if (!Array.isArray(rows) || rows.length === 0) redirect("/discovery/import");

  const mapping = readMapping(
    rawMapping,
    Array.isArray(rawMapping) ? rawMapping.length : 0,
  );
  if (mappedColumn(mapping, "clinicName") === -1) redirect("/discovery/import");

  // One label for the whole run, read from what the wizard showed on the
  // confirm step — so the batch every row is filed under is the one the person
  // importing had in front of them. A post that carries none is still a run
  // and still gets a batch; it is dated here rather than left null.
  const batchLabel =
    readBatchLabel(formData.get("batchLabel")) ?? defaultBatchLabel(new Date());

  const capped = rows.slice(0, MAX_IMPORT_ROWS);
  const summary: ImportSummary = {
    created: 0,
    // Rows dropped past the cap are counted as skipped like any other row that
    // produced no candidate, so the summary always accounts for the whole file.
    skipped: rows.length - capped.length,
    duplicates: 0,
  };

  // One read of the existing keys up front, rather than a lookup per row —
  // from both tables. A clinic that has already been through the queue and
  // become a lead must not come back as a candidate to be scored again.
  const [candidates, leads] = await Promise.all([
    prisma.discoveryCandidate.findMany({
      select: { clinicName: true, contactName: true },
    }),
    prisma.lead.findMany({ select: { clinicName: true, contactName: true } }),
  ]);
  const seen = new Set(
    [...candidates, ...leads].map((r) => dedupeKey(r.clinicName, r.contactName)),
  );

  const toCreate: ImportedCandidate[] = [];
  for (const row of capped) {
    const candidate = Array.isArray(row) ? mapRow(row, mapping) : null;
    if (!candidate) {
      summary.skipped++;
      continue;
    }
    const key = dedupeKey(candidate.clinicName, candidate.contactName);
    // seen grows as the batch is read, so a file that repeats a clinic inside
    // itself imports it once.
    if (seen.has(key)) {
      summary.duplicates++;
      continue;
    }
    seen.add(key);
    toCreate.push(candidate);
  }

  if (toCreate.length > 0) {
    await prisma.$transaction(
      toCreate.map((candidate) =>
        prisma.discoveryCandidate.create({
          data: { ...candidate, status: IMPORT_DEFAULT_STATUS, batchLabel },
        }),
      ),
    );
    summary.created = toCreate.length;
  }

  revalidatePath("/discovery");
  redirect(
    `/discovery?imported=${summary.created}&duplicates=${summary.duplicates}&skipped=${summary.skipped}`,
  );
}

function parseJson<T>(formData: FormData, key: string): T | null {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ─── Add one clinic, by name ───────────────────────────────────────────────

// The single-record entry point, beside the two bulk ones: a name, optionally
// a town, a Google search for the clinic's website, and one Pending candidate.
//
// It creates a candidate and nothing else, exactly as the imports do. It
// writes no status but Pending, no score, no tier, no breakdown — this is a
// way in, not a way round: the candidate it makes goes through the same
// Process Queue and the same chain as one that arrived in a CSV of four
// hundred, and nothing downstream can tell the difference beyond the source
// and batch labels saying how it got here.
//
// Called straight from the dialog, which awaits the result rather than posting
// a form: the search takes as long as an actor run takes, and what it found —
// or didn't — has to come back to the browser to be read.
export async function addDiscoveryCandidateByName(args: {
  clinicName: string;
  location?: string | null;
}): Promise<AddByNameResult> {
  const clinicName = readClinicName(args?.clinicName);
  if (clinicName === null) {
    return { ok: false, error: "Enter the clinic's name." };
  }
  const location = readLocation(args?.location);

  // Already here — as a candidate, or as a lead it was promoted into. Checked
  // before the search rather than after, because a search costs a run and the
  // answer to "add this clinic" is already no.
  const key = clinicNameKey(clinicName);
  const [candidates, leads] = await Promise.all([
    prisma.discoveryCandidate.findMany({
      select: { id: true, clinicName: true, status: true },
    }),
    prisma.lead.findMany({ select: { id: true, clinicName: true } }),
  ]);
  const existingCandidate = candidates.find(
    (c) => clinicNameKey(c.clinicName) === key,
  );
  if (existingCandidate) {
    return {
      ok: false,
      error: `${clinicName} is already in Discovery.`,
      duplicateId: existingCandidate.id,
      duplicateStatus: existingCandidate.status,
    };
  }
  if (leads.some((l) => clinicNameKey(l.clinicName) === key)) {
    return {
      ok: false,
      error: `${clinicName} has already been through Discovery and is in the pipeline.`,
    };
  }

  // The search. A failure here is not a reason to lose the name: the candidate
  // is created either way, because the Maps actor in the enrichment chain
  // searches on the clinic name alone and can still find something to score
  // on. The result says which of the three happened — found, found nothing,
  // or could not run — and the dialog reports it rather than smoothing it over.
  // Run under whichever search actor Pipeline Settings names, because a swap
  // made there is a swap of "how this app searches Google" and this is the
  // other place it does that.
  //
  // The step's on/off switch is deliberately not read here. That toggle turns
  // off the Facebook fallback inside the enrichment chain; it is not a switch
  // for this button, and a form that silently stopped finding websites because
  // of a setting about Facebook would be indefensible.
  const settings = await loadPipelineSettings();
  const query = websiteSearchQuery(clinicName, location);
  const search = await runGoogleSearch(
    query,
    settings.steps.facebookLookup.actorId,
  );
  const websiteUrl = search.ok ? firstClinicWebsite(search.urls) : null;

  const created = await prisma.discoveryCandidate.create({
    data: {
      clinicName,
      websiteUrl,
      location,
      // Read off the location the same way the bulk import reads it, so a
      // by-name candidate carries the zone a mapped one would have carried.
      timeZone: zoneFromLocation(location),
      source: ADD_BY_NAME_SOURCE,
      status: IMPORT_DEFAULT_STATUS,
      batchLabel: defaultBatchLabel(new Date(), ADD_BY_NAME_BATCH_DESCRIPTION),
    },
    select: { id: true },
  });

  revalidatePath("/discovery");
  return {
    ok: true,
    id: created.id,
    clinicName,
    websiteUrl,
    query,
    ...(search.ok ? {} : { searchError: search.error }),
  };
}

// ─── Editing a candidate ───────────────────────────────────────────────────

// The candidate's own fields, by hand. It exists for one reason above all
// others: the commonest way a candidate fails is having no URL for any actor
// to work from, and the fix for that is typing one in and running the queue
// again.
//
// It reaches none of the verdict. Status, score, tier, breakdown and the
// promotion link are written by the chain and by the override, never from a
// form — a scorecard somebody could edit into existence on a candidate would
// make "nothing reaches Pipeline unscored" a matter of trust rather than of
// how the app is built.
export async function updateDiscoveryCandidate(id: string, formData: FormData) {
  const zone = str(formData, "timeZone");
  const contactName = str(formData, "contactName");

  // A decision maker typed in by hand is a decision maker, and the stage that
  // looks for one should say so rather than still reading "Not searched". It
  // is recorded as manually_added with no confidence attached: a name somebody
  // knows is not evidence this app gathered, and claiming a level for it would
  // be putting words in their mouth. Clearing the contact puts the stage back
  // to where it was, so the search can run.
  const existing = await prisma.discoveryCandidate.findUnique({
    where: { id },
    select: { contactName: true, decisionMakerStatus: true },
  });
  const wasNamed = (existing?.contactName ?? "").trim() !== "";
  const nowNamed = (contactName ?? "").trim() !== "";
  const decisionMaker =
    !wasNamed && nowNamed
      ? {
          decisionMakerStatus: "manually_added",
          decisionMakerEvidence: "Entered by hand on the candidate.",
          decisionMakerAt: new Date(),
        }
      : wasNamed && !nowNamed && existing?.decisionMakerStatus === "manually_added"
        ? {
            decisionMakerStatus: "not_started",
            decisionMakerEvidence: null,
            decisionMakerConfidence: null,
          }
        : {};
  await prisma.discoveryCandidate.update({
    where: { id },
    data: {
      ...decisionMaker,
      clinicName: str(formData, "clinicName") ?? "Untitled clinic",
      contactName,
      contactTitle: str(formData, "contactTitle"),
      phone: str(formData, "phone"),
      email: str(formData, "email"),
      source: str(formData, "source"),
      linkedinUrl: str(formData, "linkedinUrl"),
      companyLinkedinUrl: str(formData, "companyLinkedinUrl"),
      // The three the enrichment run is built from. An empty one is what makes
      // that run skip an actor rather than run it against nothing.
      websiteUrl: str(formData, "websiteUrl"),
      facebookUrl: str(formData, "facebookUrl"),
      location: str(formData, "location"),
      // Blank is a real answer here — a candidate whose zone nobody knows — so
      // anything outside the four zones stores as null rather than defaulting.
      timeZone: isUsTimeZone(zone) ? zone : null,
      staffCountRaw: int(formData, "staffCountRaw"),
      estValue: num(formData, "estValue"),
      // The batch is a label somebody is allowed to correct — a run named
      // after the actor it came from is often not what it turned out to be.
      // Cleared to null rather than to "", which is what every candidate that
      // predates batches carries and what the filter groups them under.
      batchLabel: readBatchLabel(formData.get("batchLabel")),
    },
  });
  revalidatePath("/discovery");
  revalidatePath(`/discovery/${id}`);
}

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function num(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(formData: FormData, key: string): number | null {
  const n = num(formData, key);
  return n === null ? null : Math.round(n);
}

// ─── The queue ─────────────────────────────────────────────────────────────

// Everything the queue would run, read at the moment the button is pressed
// rather than when the page was loaded — a list that has sat open for an hour
// should not process a candidate somebody deleted in the meantime, or miss one
// they added.
//
// Oldest first: a queue that reordered itself would make "it stopped after
// four" impossible to reason about.
export async function discoveryQueue(): Promise<
  { id: string; clinicName: string }[]
> {
  return prisma.discoveryCandidate.findMany({
    where: { status: { in: DISCOVERY_QUEUE_STATUSES } },
    orderBy: { createdAt: "asc" },
    select: { id: true, clinicName: true },
  });
}

// One candidate, all the way through. Called once per candidate by the queue
// component, which awaits each result before asking for the next — so the four
// actor runs and the model call in here are the reason a queue of thirty takes
// the best part of an hour, and why it says so.
//
// runBatchLabel is the queue run's own batch, generated once when the run
// starts and passed with every candidate in it. It only ever fills a gap: a
// candidate imported with a batch keeps the one it arrived on, and one from
// before batches existed — or from an import that somehow wrote none — is
// filed under the run that first picked it up, which is the truest thing left
// to say about where it came from.
export async function processDiscoveryCandidate(
  id: string,
  runBatchLabel?: string | null,
): Promise<DiscoveryProcessResult> {
  const candidate = await prisma.discoveryCandidate.findUnique({
    where: { id },
    select: {
      id: true,
      clinicName: true,
      batchLabel: true,
      contactName: true,
      discoverySource: true,
      companyLinkedinUrl: true,
      facebookUrl: true,
      websiteUrl: true,
      location: true,
      staffCountRaw: true,
      metaAdsSignal: true,
      reviewCount: true,
      websiteNotes: true,
      status: true,
      promotedLeadId: true,
    },
  });
  if (!candidate) {
    return {
      id,
      clinicName: "That candidate",
      status: "FAILED",
      headline: "No longer here — it was deleted while the queue was running.",
      total: null,
      tier: null,
      promotedLeadId: null,
      steps: [],
    };
  }

  // Already resolved. The queue reads its list once and a candidate can be
  // promoted by hand from another tab while it runs, so this is a real case
  // rather than a formality — and re-running it would create a second lead.
  if (candidate.promotedLeadId) {
    return {
      id,
      clinicName: candidate.clinicName,
      status: "PROMOTED",
      headline: "Already promoted — left alone.",
      total: null,
      tier: null,
      promotedLeadId: candidate.promotedLeadId,
      steps: [],
    };
  }

  const steps: DiscoveryStep[] = [];
  const notes: string[] = [];

  await prisma.discoveryCandidate.update({
    where: { id },
    data: {
      status: "ENRICHING",
      failureReason: null,
      batchLabel:
        candidate.batchLabel ??
        readBatchLabel(runBatchLabel) ??
        defaultBatchLabel(new Date(), BATCH_QUEUE_DESCRIPTION),
    },
  });

  // ─── 1. Enrichment ───────────────────────────────────────────────────────
  //
  // The same four actors the lead page runs, from the same module, against
  // this candidate's own fields. "skip" rather than "ask" on an ambiguous
  // identity: there is nobody here to pick which of three clinics this is.
  const inputs: EnrichInputs = {
    clinicName: candidate.clinicName,
    companyLinkedinUrl: candidate.companyLinkedinUrl,
    facebookUrl: candidate.facebookUrl,
    websiteUrl: candidate.websiteUrl,
    location: candidate.location,
  };

  // Read once, at the top of this candidate's run, and used for both halves of
  // it — which actors run, and the bar the total is judged against at the end.
  // One read per candidate rather than one per run: a queue that took an hour
  // should honour a setting changed halfway through it.
  const settings = await loadPipelineSettings();

  let outcomes: EnrichOutcome[];
  let update: EnrichUpdate;
  try {
    ({ outcomes, update } = await runEnrichActors(inputs, {
      onChoice: "skip",
      settings,
    }));
  } catch {
    return failCandidate(
      candidate,
      steps,
      "The enrichment run could not be reached. Check the server's network connection and run the queue again.",
    );
  }

  for (const outcome of outcomes) {
    const label = ENRICH_STEP_LABELS[outcome.key] ?? outcome.key;
    steps.push({
      label,
      status:
        outcome.status === "wrote"
          ? "ok"
          : outcome.status === "failed"
            ? "failed"
            : outcome.status === "skipped"
              ? "skipped"
              : "warned",
      detail:
        outcome.status === "wrote"
          ? `Wrote ${outcome.fields.length} field${outcome.fields.length === 1 ? "" : "s"}`
          : outcome.detail,
    });
    if (outcome.status !== "wrote" && outcome.status !== "failed") {
      notes.push(`${label}: ${outcome.detail}`);
    }
  }

  // Whatever was read is written whether or not the run as a whole was clean.
  // Storing evidence is not scoring it, and the alternative — throwing away
  // three good actor results because a fourth failed — makes the retry cost
  // four runs where it needed one.
  const enriched = await writeCandidateEnrichment(id, update);

  // ─── The failure gate ────────────────────────────────────────────────────
  //
  // An actor that failed outright means the evidence is incomplete in a way
  // nobody can see from the numbers, so nothing is scored on it. The candidate
  // goes to Failed with the actor's own sentence and the next queue run picks
  // it up again.
  //
  // The two lookups are the exception, and they are one because of what they
  // are: a search for a URL the candidate hasn't got, in front of a step that
  // was going to be skipped without it. A search that fails leaves the run
  // exactly where it stood before that lookup existed — the ads step skipped
  // for want of a Facebook URL, the crawler skipped for want of a website —
  // and failing a candidate over it would reject clinics this app used to
  // score.
  //
  // What a failed website lookup *can* still do is leave the card too thin to
  // attempt, and the gate below catches that on the evidence rather than on
  // the search: no notes is no notes however the URL went missing.
  const failed = outcomes.filter(
    (o): o is Extract<EnrichOutcome, { status: "failed" }> =>
      o.status === "failed" && !isEnrichLookupKey(o.key),
  );
  if (failed.length > 0) {
    return failCandidate(
      candidate,
      steps,
      failed
        .map((f) => `${ENRICH_STEP_LABELS[f.key] ?? f.key}: ${f.detail}`)
        .join(" · "),
    );
  }

  const evidence = {
    clinicName: candidate.clinicName,
    websiteNotes: enriched.websiteNotes,
    metaAdsSignal: enriched.metaAdsSignal,
    reviewCount: enriched.reviewCount,
  };

  // Nothing failed, and nothing came back either — every actor was skipped for
  // want of a URL, or ran and found nothing. This is not a C-tier clinic, it
  // is a clinic nobody has looked at, and scoring it would put a number on
  // that. Failed, with the one thing that would fix it.
  if (!hasAssistEvidence(evidence)) {
    return failCandidate(
      candidate,
      steps,
      "Nothing was gathered to score on. The enrichment run had no website, Facebook page or company page to work from — add one on the candidate and run the queue again.",
    );
  }

  // ─── 2. What can be computed ─────────────────────────────────────────────
  const staffSize = staffSizeScore(enriched.staffCountRaw);
  const budget = budgetSignalScore(enriched.metaAdsSignal, enriched.reviewCount);
  steps.push({
    label: "Staff Size Fit and Budget Signal",
    status: "ok",
    detail: `${staffSize.points}/2 and ${budget.points}/2, computed from the data`,
  });

  // ─── 3. The model, for the rest ──────────────────────────────────────────
  const precheck = precheckGaps(enriched.websiteNotes);
  const { system, user } = buildDiscoveryPrompt(evidence, precheck);
  const reply = await deepSeekJson({
    system,
    user,
    maxTokens: DISCOVERY_ASSIST_MAX_TOKENS,
  });
  if (!reply.ok) {
    steps.push({
      label: "DeepSeek scoring assist",
      status: "failed",
      detail: reply.error,
    });
    return failCandidate(candidate, steps, reply.error);
  }
  const suggestion = parseDiscoverySuggestion(reply.content);
  if (!suggestion) {
    const detail =
      "DeepSeek answered, but not in a shape that reads as scores. Nothing was scored — run the queue again.";
    steps.push({
      label: "DeepSeek scoring assist",
      status: "failed",
      detail,
    });
    return failCandidate(candidate, steps, detail);
  }
  steps.push({
    label: "DeepSeek scoring assist",
    status: "ok",
    detail: `${Object.keys(suggestion.disqualifiers).length} disqualifier${
      Object.keys(suggestion.disqualifiers).length === 1 ? "" : "s"
    } flagged, Package/Economics ${
      suggestion.packageEconomics
        ? `${suggestion.packageEconomics.points}/3`
        : "not answered"
    }, ${Object.keys(suggestion.gaps).length}/3 gaps answered`,
  });

  // ─── The partial-evidence gate ───────────────────────────────────────────
  //
  // The same rule as the "nothing was gathered" gate above, one step in. That
  // one catches a candidate with no evidence at all; this catches one whose
  // evidence covered so little of the card that the total would be arithmetic
  // on absences — two or more scored categories that were never attempted,
  // because what they are read from was never gathered.
  //
  // It runs after the model rather than before it, and that is deliberate
  // despite costing a call on a candidate that is about to fail. Only the
  // model's answer distinguishes the two cases this rule turns on: a category
  // it declined after reading real evidence is a finding and must not count,
  // and a category it answered from evidence this code did not expect it to
  // use has been attempted whatever the inputs suggest. Guessing either from
  // the inputs alone would fail candidates that scored perfectly well.
  const ungathered = ungatheredItems(enriched, suggestion);
  if (ungathered.length >= MIN_UNGATHERED_TO_FAIL) {
    const reason = ungatheredFailureReason(ungathered, enriched, {
      // The website URL as it stands *after* enrichment: the company lookup
      // and the Maps search both report one, and a candidate that arrived
      // without a website may well have gained one in this very run.
      websiteUrl: update.websiteUrl ?? candidate.websiteUrl,
      companyLinkedinUrl: candidate.companyLinkedinUrl,
      facebookUrl: update.facebookUrl ?? candidate.facebookUrl,
    });
    steps.push({
      label: "Evidence check",
      status: "failed",
      detail: reason,
    });
    return failCandidate(candidate, steps, reason);
  }

  // ─── 4. Combine ──────────────────────────────────────────────────────────
  //
  // The gap reasons carry the pre-check's own finding appended to the model's
  // sentence, so a breakdown row says both halves of how that box was decided
  // rather than presenting the model's confirmation as the whole story.
  const gaps: DiscoveryScoringInput["gaps"] = {};
  for (const [key, answer] of Object.entries(suggestion.gaps)) {
    const gapKey = key as IcpGapKey;
    gaps[gapKey] = {
      checked: answer.checked,
      reason: `${answer.reason}${precheckNote(precheck[gapKey])}`,
    };
  }

  const now = new Date();
  const breakdown = buildBreakdown(
    {
      staffSize,
      budgetSignal: budget,
      packageEconomics: suggestion.packageEconomics,
      gaps,
      disqualifiers: suggestion.disqualifiers,
      summary: suggestion.summary,
      evidence: assistEvidenceLabels(evidence),
      notes,
    },
    now,
  );

  await prisma.discoveryCandidate.update({
    where: { id },
    data: {
      status: "SCORED",
      icpTotal: breakdown.total,
      icpTier: breakdown.tier,
      icpBreakdown: serializeBreakdown(breakdown),
      disqualified: breakdown.tier === "DISQUALIFIED",
      disqualifiedReason: null,
      failureReason: null,
    },
  });

  // ─── 5, 6, 7. The verdict ────────────────────────────────────────────────
  //
  // The bar is a setting now (Pipeline Settings), defaulting to the 5 this was
  // hardcoded at. A disqualifier still stops a candidate whatever the bar says
  // — Layer 1 is "any yes = STOP", not a score to clear.
  const threshold = settings.promotionThreshold;
  if (breakdown.tier === "DISQUALIFIED" || breakdown.total < threshold) {
    const reason = rejectionReason(breakdown, threshold);
    await prisma.discoveryCandidate.update({
      where: { id },
      data: {
        status: "REJECTED",
        disqualified: breakdown.tier === "DISQUALIFIED",
        disqualifiedReason: reason,
        processedAt: now,
      },
    });
    steps.push({ label: "Verdict", status: "warned", detail: reason });
    revalidatePath("/discovery");
    return {
      id,
      clinicName: candidate.clinicName,
      status: "REJECTED",
      headline: reason,
      total: breakdown.total,
      tier: breakdown.tier,
      promotedLeadId: null,
      steps,
    };
  }

  // Qualified is qualified, whichever pathway found it. A clinic-first
  // candidate used to stop here when no decision maker had been found and wait
  // in QUALIFIED_NO_CONTACT for one — which left qualified clinics sitting in
  // Discovery on a missing field rather than a missing verdict. The scoring
  // says whether the clinic is worth pursuing; who to pursue it with is a name
  // typed onto the lead afterwards, so it promotes with a blank contact and is
  // filled in by hand from the pipeline.

  const leadId = await promoteToLead(id, breakdown, now);
  const headline = `Promoted — ${breakdown.tier}-tier, ${breakdown.total}/${ICP_MAX_SCORE}`;
  steps.push({ label: "Verdict", status: "ok", detail: headline });
  revalidatePath("/discovery");
  revalidatePath("/pipeline");
  revalidatePath("/");
  return {
    id,
    clinicName: candidate.clinicName,
    status: "PROMOTED",
    headline,
    total: breakdown.total,
    tier: breakdown.tier,
    promotedLeadId: leadId,
    steps,
  };
}

// ─── Promotion ─────────────────────────────────────────────────────────────

// The override on the rejected list. Same promotion the queue does, on a
// candidate the queue decided against — the scorecard it arrives with is the
// one the run produced, disqualifier flags and all, because the override says
// "pursue this anyway", not "the evidence was different".
export async function promoteDiscoveryCandidate(id: string) {
  const candidate = await prisma.discoveryCandidate.findUnique({
    where: { id },
    select: { id: true, icpBreakdown: true, promotedLeadId: true },
  });
  if (!candidate) return;
  if (candidate.promotedLeadId) {
    redirect(`/pipeline/${candidate.promotedLeadId}`);
  }

  const breakdown = parseBreakdown(candidate.icpBreakdown);
  const leadId = await promoteToLead(id, breakdown, new Date());

  revalidatePath("/discovery");
  revalidatePath("/discovery/rejected");
  revalidatePath("/pipeline");
  revalidatePath("/");
  redirect(`/pipeline/${leadId}`);
}

// ─── Failure ───────────────────────────────────────────────────────────────

// Everything that stops the chain short lands here: the record is marked
// Failed with the sentence explaining it, nothing is scored, and the next
// queue run picks it up again from the top.
async function failCandidate(
  candidate: { id: string; clinicName: string },
  steps: DiscoveryStep[],
  reason: string,
): Promise<DiscoveryProcessResult> {
  await prisma.discoveryCandidate.update({
    where: { id: candidate.id },
    data: {
      status: "FAILED",
      failureReason: reason,
      processedAt: new Date(),
    },
  });
  revalidatePath("/discovery");
  return {
    id: candidate.id,
    clinicName: candidate.clinicName,
    status: "FAILED",
    headline: reason,
    total: null,
    tier: null,
    promotedLeadId: null,
    steps,
  };
}

// Writes what the actors read, and hands back the candidate's evidence fields
// as they now stand — the scoring below has to read the values that were
// written, not the ones that were there when the run started.
async function writeCandidateEnrichment(
  id: string,
  update: EnrichUpdate,
): Promise<{
  staffCountRaw: number | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
  websiteNotes: string | null;
}> {
  const select = {
    staffCountRaw: true,
    metaAdsSignal: true,
    reviewCount: true,
    websiteNotes: true,
  } as const;

  if (enrichFieldsWritten(update).length === 0) {
    const current = await prisma.discoveryCandidate.findUniqueOrThrow({
      where: { id },
      select,
    });
    return current;
  }

  return prisma.discoveryCandidate.update({
    where: { id },
    data: { ...update, enrichedAt: new Date() },
    select,
  });
}

// ─── Back into the queue ───────────────────────────────────────────────────

// Puts a settled candidate back to Pending so the next queue run picks it up
// from the top.
//
// It exists for the one status that is settled but not finished: Qualified —
// Decision Maker Missing, which is deliberately not a queue status (see
// DISCOVERY_QUEUE_STATUSES) because re-running five actors changes nothing
// about a clinic whose only gap is a person. When something *has* changed —
// a website typed in, a company page found — this is how that candidate is
// scored again.
//
// It clears the verdict along with the status, because a stored total is the
// transcript of a run and a candidate waiting to be re-run has no current one.
// A promoted candidate is left alone: its lead is a real record by now.
export async function requeueDiscoveryCandidate(id: string) {
  const candidate = await prisma.discoveryCandidate.findUnique({
    where: { id },
    select: { promotedLeadId: true },
  });
  if (!candidate || candidate.promotedLeadId) return;

  await prisma.discoveryCandidate.update({
    where: { id },
    data: {
      status: "PENDING",
      icpTotal: null,
      icpTier: null,
      icpBreakdown: null,
      disqualified: false,
      disqualifiedReason: null,
      failureReason: null,
      processedAt: null,
    },
  });
  revalidatePath("/discovery");
  revalidatePath(`/discovery/${id}`);
}

// ─── Bulk actions from the discovery table ─────────────────────────────────
//
// Ids arriving from the browser are only ever matched against existing rows —
// an id for a candidate that isn't there deletes nothing — and this is a no-op
// on an empty list rather than a statement with no WHERE clause.

export async function deleteDiscoveryCandidates(ids: string[]) {
  const list = candidateIds(ids);
  if (list.length === 0) return;
  await prisma.discoveryCandidate.deleteMany({ where: { id: { in: list } } });
  revalidatePath("/discovery");
  revalidatePath("/discovery/rejected");
}

function candidateIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter(
    (id): id is string => typeof id === "string" && id.trim() !== "",
  );
  return Array.from(new Set(ids)).slice(0, MAX_BULK_CANDIDATES);
}

// The single delete, from a candidate's own page. A promoted candidate keeps
// its lead — the lead is its own record by then, and deleting the paperwork
// behind it should not delete it.
export async function deleteDiscoveryCandidate(id: string) {
  await prisma.discoveryCandidate.delete({ where: { id } });
  revalidatePath("/discovery");
  revalidatePath("/discovery/rejected");
  redirect("/discovery");
}
