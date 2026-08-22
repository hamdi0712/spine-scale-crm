"use server";

// Decision-maker enrichment — the running half of src/lib/decisionMaker.ts.
//
// One button, on one candidate, and everything about how it is scoped is a
// deliberate limit rather than an omission:
//
//   It runs only on a candidate sitting in QUALIFIED_NO_CONTACT. That is the
//   whole point of the stage — the clinic has already been enriched and scored
//   and found worth pursuing, and only then is it worth spending a run finding
//   out who to pursue it with.
//
//   It re-runs nothing else. The company lookup, Maps, the ads library and the
//   crawler are not touched; this reads what they already wrote and spends at
//   most one profile search and a handful of Google queries. "Retry" therefore
//   costs this stage and not the chain.
//
//   It never overwrites. Every field it can write is written through mergeFill
//   (src/lib/discoveryDedupe.ts), so a contact somebody typed in survives a
//   search that disagrees with them.
//
// When it lands a person, the candidate is promoted the ordinary way — the
// same promoteToLead the queue calls, carrying the scorecard the run produced.
// When it lands nobody, the candidate stays exactly where it was, with a log
// of what was tried.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { APIFY_MIN_CHARGE_USD, runApifySync } from "@/lib/apify";
import { runGoogleSearch } from "@/lib/googleSearchRun";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { promoteToLead } from "@/lib/promoteLead";
import { parseBreakdown } from "@/lib/discovery";
import { mergeFill } from "@/lib/discoveryDedupe";
import {
  DecisionMakerAttempt,
  DecisionMakerCandidate,
  DecisionMakerConfidence,
  MAX_SEARCH_QUERIES,
  decisionMakerQueries,
  hasDecisionMaker,
  isDecisionMakerConfidence,
  nameFromProfileUrl,
  normalizeProfileRow,
  parseDecisionMakerLog,
  peopleFromWebsiteNotes,
  person,
  profileSearchInput,
  profileUrlsFromResults,
  rankCandidates,
  serializeAttempts,
  serializeSocialUrls,
} from "@/lib/decisionMaker";

// How many profiles one search reads. The owner of a clinic of ten people is
// in the first handful or the search was the wrong search; everything past
// this is billed and thrown away.
const MAX_PROFILES = 10;

// What one profile search is allowed to cost, and the second place in this app
// that exists because of how an actor is *billed* rather than what it does.
//
// The profile search bills per event. The enrichment actors bill per result,
// and a pay-per-result run is capped by asking for fewer results — which is
// what maxItems does, and what every one of those runs relies on. There is no
// per-result price on a pay-per-event actor for that to work against, so Apify
// reads a small maxItems as a cost ceiling far below its own platform minimum
// and refuses the run before it starts: "Maximum cost per run is less than the
// allowed minimum of $0.10". Ten profiles was therefore not a cheap run but no
// run at all.
//
// So it is capped in money instead, exactly as the Google Search actor is
// (GOOGLE_SEARCH_MAX_CHARGE_USD in src/lib/googleSearchRun.ts). The value is
// the platform floor rather than a budget anybody picked: one search of one
// clinic costs a fraction of it, what the run actually does is bounded by the
// input and by maxItems reading the dataset, and raising this would buy no
// more searching — only a higher ceiling on a run that went wrong.
//
// Not exported: a "use server" module may export nothing but async functions,
// and nothing outside this file needs the number.
const DECISION_MAKER_MAX_CHARGE_USD = APIFY_MIN_CHARGE_USD;

// What the browser gets back from a run: what happened, who was found, and
// everybody else worth offering as an alternative.
export type FindDecisionMakerResult =
  | {
      ok: true;
      status: "found" | "not_found" | "failed";
      // The person written onto the candidate, or null when nobody was.
      selected: DecisionMakerCandidate | null;
      // The rest, best first — the "several possible decision makers" case,
      // surfaced rather than silently discarded.
      alternates: DecisionMakerCandidate[];
      // Set when finding somebody promoted the candidate.
      promotedLeadId: string | null;
      // One line per source tried, for the panel to show without opening the log.
      steps: { label: string; detail: string }[];
    }
  | { ok: false; error: string };

// ─── The run ───────────────────────────────────────────────────────────────

export async function findDecisionMaker(id: string): Promise<FindDecisionMakerResult> {
  const candidate = await prisma.discoveryCandidate.findUnique({
    where: { id },
    select: {
      id: true,
      clinicName: true,
      location: true,
      websiteUrl: true,
      websiteNotes: true,
      companyLinkedinUrl: true,
      contactName: true,
      contactTitle: true,
      contactSocialUrls: true,
      linkedinUrl: true,
      email: true,
      phone: true,
      status: true,
      icpBreakdown: true,
      icpTotal: true,
      disqualified: true,
      promotedLeadId: true,
      decisionMakerLog: true,
    },
  });
  if (!candidate) {
    return { ok: false, error: "That candidate is no longer here." };
  }

  // The gate. Stated as three separate refusals because they are three
  // different situations and a single "cannot run" would leave somebody
  // guessing which one they are in.
  if (candidate.promotedLeadId) {
    return {
      ok: false,
      error: "This one is already a lead in the pipeline — its contact lives there now.",
    };
  }
  if (candidate.status !== "QUALIFIED_NO_CONTACT") {
    return {
      ok: false,
      error:
        "Decision-maker enrichment only runs on a candidate that has qualified and has nobody named — that is what keeps it from spending runs on clinics that would have been rejected anyway.",
    };
  }
  if (hasDecisionMaker(candidate)) {
    return {
      ok: false,
      error: `${candidate.contactName} is already recorded here. Clear the contact first if the search should look again.`,
    };
  }

  const settings = await loadPipelineSettings();
  if (!settings.decisionMaker.enabled) {
    return {
      ok: false,
      error:
        "Decision-maker enrichment is turned off. Turn it on under Settings → Pipeline, where its actor is set too.",
    };
  }
  const actorId = settings.decisionMaker.actorId;

  await prisma.discoveryCandidate.update({
    where: { id },
    data: { decisionMakerStatus: "searching" },
  });

  const attempt: DecisionMakerAttempt = {
    at: new Date().toISOString(),
    clinicName: candidate.clinicName,
    steps: [],
    selected: null,
    alternates: [],
  };
  const steps: { label: string; detail: string }[] = [];
  const found: DecisionMakerCandidate[] = [];

  // ─── 1. The clinic's own website, already crawled ───────────────────────
  //
  // Free, and the strongest evidence there is. It runs first for both reasons:
  // a team page that says "Founder" outranks anything a search can produce,
  // and finding one here means the two paid steps below never run at all.
  const fromWebsite = peopleFromWebsiteNotes(candidate.websiteNotes);
  found.push(...fromWebsite);
  attempt.steps.push({
    source: "website",
    query: "Team/about copy already crawled onto this candidate",
    actorId: null,
    results: fromWebsite.length,
    error:
      candidate.websiteNotes === null
        ? "No website copy has been crawled for this clinic yet."
        : null,
  });
  steps.push({
    label: "Clinic website",
    detail:
      candidate.websiteNotes === null
        ? "No crawled copy to read — the website crawler has not run, or found nothing."
        : `${fromWebsite.length} named ${fromWebsite.length === 1 ? "person" : "people"} with a role stated in the clinic's own copy.`,
  });

  // ─── 2. The profile search, anchored to this clinic ─────────────────────
  //
  // Skipped outright when the website already produced a High-confidence
  // finding: the actor cannot improve on the clinic stating its own founder,
  // and running it anyway would be a bill for a second opinion nobody needs.
  const strongAlready = found.some((c) => c.confidence === "HIGH");
  if (!strongAlready) {
    const input = profileSearchInput(candidate.clinicName, candidate.location, MAX_PROFILES);
    const result = await runApifySync({
      kind: "actor",
      id: actorId,
      input: JSON.stringify(input),
      // The cap in money, not in items — see DECISION_MAKER_MAX_CHARGE_USD.
      // maxItems still bounds what is read back out of the dataset; it is only
      // the *run's* ceiling that has to be expressed as a cost for this actor.
      maxItems: MAX_PROFILES,
      maxTotalChargeUsd: DECISION_MAKER_MAX_CHARGE_USD,
    });
    if (result.ok) {
      const people: DecisionMakerCandidate[] = [];
      for (const cells of result.rows) {
        const profile = normalizeProfileRow(
          { headers: result.headers, cells },
          candidate.clinicName,
        );
        if (profile) people.push(profile);
      }
      found.push(...people);
      attempt.steps.push({
        source: "linkedin",
        query: `Profiles at "${candidate.clinicName}" with an owner/director/manager title`,
        actorId,
        results: people.length,
        error: null,
      });
      steps.push({
        label: "LinkedIn profile search",
        detail: `${result.rows.length} profile${result.rows.length === 1 ? "" : "s"} returned, ${people.length} of them at this clinic.`,
      });
    } else {
      // An actor that failed is recorded and stepped over, not fatal: the
      // Google fallback below may still name somebody, and failing the whole
      // stage would throw away a finding the website already made.
      attempt.steps.push({
        source: "linkedin",
        query: `Profiles at "${candidate.clinicName}"`,
        actorId,
        results: 0,
        error: result.error,
      });
      steps.push({ label: "LinkedIn profile search", detail: result.error });
    }
  } else {
    attempt.steps.push({
      source: "linkedin",
      query: "Not run — the clinic's own site already named somebody",
      actorId,
      results: 0,
      error: null,
    });
    steps.push({
      label: "LinkedIn profile search",
      detail: "Not run — the clinic's own website already stated who runs it.",
    });
  }

  // ─── 3. The anchored Google search ──────────────────────────────────────
  //
  // Last, and only when the two above produced nobody at all. Every query
  // names the clinic — a search for "owner" alone would return the owners of
  // other people's practices.
  if (found.length === 0) {
    const searchActorId = settings.steps.facebookLookup.actorId;
    const queries = decisionMakerQueries(candidate.clinicName, candidate.location).slice(
      0,
      MAX_SEARCH_QUERIES,
    );
    let searched = 0;
    for (const query of queries) {
      const search = await runGoogleSearch(query, searchActorId);
      if (!search.ok) {
        attempt.steps.push({
          source: "search",
          query,
          actorId: searchActorId,
          results: 0,
          error: search.error ?? "The search failed.",
        });
        continue;
      }
      const profiles = profileUrlsFromResults(search.urls);
      searched += profiles.length;
      for (const url of profiles) {
        const name = nameFromProfileUrl(url);
        // A profile whose URL names nobody is left alone rather than stored
        // under a made-up name.
        if (name === null) continue;
        found.push(
          person({
            name,
            linkedinUrl: url,
            source: "search",
            evidence: `Google search — “${query}” returned this LinkedIn profile. Nothing found states their role at the clinic.`,
          }),
        );
      }
      attempt.steps.push({
        source: "search",
        query,
        actorId: searchActorId,
        results: profiles.length,
        error: null,
      });
      // One query that produced a name is enough; the rest are for the retry.
      if (found.length > 0) break;
    }
    steps.push({
      label: "Google search",
      detail:
        found.length === 0
          ? `${queries.length} clinic-anchored ${queries.length === 1 ? "query" : "queries"} run, no profile that could be named.`
          : `${searched} LinkedIn profile${searched === 1 ? "" : "s"} found against the clinic's name.`,
    });
  }

  // ─── The verdict ────────────────────────────────────────────────────────
  const ranked = rankCandidates(found);
  const selected = ranked[0] ?? null;
  const alternates = ranked.slice(1, 6);
  attempt.alternates = alternates.map((a) => a.name);

  if (selected === null) {
    // Nobody. The candidate keeps everything it had — its score, its evidence,
    // its place in the list — and gains a log of what was tried. Deleting or
    // rejecting it here would throw away a qualified clinic over a search.
    //
    // "Failed" and "not found" are separated on the one thing that tells them
    // apart: whether anything actually got to look. Every paid step erroring is
    // a failure to search, which is worth retrying as soon as whatever broke is
    // fixed; a clean search that turned nobody up is an answer, and retrying it
    // tomorrow will cost the same and say the same.
    const paid = attempt.steps.filter((step) => step.source !== "website");
    const everyStepErrored =
      paid.length > 0 && paid.every((step) => step.error !== null);
    attempt.selected = null;
    await writeAttempt(id, attempt, candidate.decisionMakerLog, {
      decisionMakerStatus: everyStepErrored ? "failed" : "not_found",
      decisionMakerAt: new Date(),
    });
    revalidatePath(`/discovery/${id}`);
    revalidatePath("/discovery");
    return {
      ok: true,
      status: everyStepErrored ? "failed" : "not_found",
      selected: null,
      alternates: [],
      promotedLeadId: null,
      steps,
    };
  }

  attempt.selected = {
    name: selected.name,
    title: selected.title,
    confidence: selected.confidence,
    source: selected.source,
  };
  const promotedLeadId = await applyDecisionMaker(id, candidate, selected, attempt, "found");

  revalidatePath(`/discovery/${id}`);
  revalidatePath("/discovery");
  if (promotedLeadId) {
    revalidatePath("/pipeline");
    revalidatePath("/");
  }
  return { ok: true, status: "found", selected, alternates, promotedLeadId, steps };
}

// ─── Choosing somebody by hand ─────────────────────────────────────────────

// The manual path, and it serves two situations that are the same write: an
// alternate picked out of the results the panel is showing, and a person
// somebody knows about and typed in.
//
// Both are recorded as manually_added with whatever evidence came with them,
// because a person a human chose is a different kind of fact from a person an
// actor returned, and the record should say which it is holding.
export async function setDecisionMaker(args: {
  id: string;
  name: string;
  title?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  socialUrls?: string[];
  confidence?: string | null;
  evidence?: string | null;
}): Promise<{ ok: true; promotedLeadId: string | null } | { ok: false; error: string }> {
  const name = typeof args?.name === "string" ? args.name.trim() : "";
  if (name === "") return { ok: false, error: "Enter the decision maker's name." };

  const candidate = await prisma.discoveryCandidate.findUnique({
    where: { id: args.id },
    select: {
      id: true,
      clinicName: true,
      contactName: true,
      contactTitle: true,
      contactSocialUrls: true,
      linkedinUrl: true,
      email: true,
      phone: true,
      status: true,
      icpBreakdown: true,
      icpTotal: true,
      disqualified: true,
      promotedLeadId: true,
      decisionMakerLog: true,
    },
  });
  if (!candidate) return { ok: false, error: "That candidate is no longer here." };
  if (candidate.promotedLeadId) {
    return { ok: false, error: "This one is already a lead in the pipeline." };
  }

  const chosen = person({
    name,
    title: args.title ?? null,
    linkedinUrl: args.linkedinUrl ?? null,
    email: args.email ?? null,
    phone: args.phone ?? null,
    socialUrls: Array.isArray(args.socialUrls) ? args.socialUrls : [],
    source: "manual",
    confidence: isDecisionMakerConfidence(args.confidence)
      ? (args.confidence as DecisionMakerConfidence)
      : undefined,
    evidence:
      typeof args.evidence === "string" && args.evidence.trim() !== ""
        ? args.evidence.trim()
        : `Chosen by hand as the decision maker at ${candidate.clinicName}.`,
  });

  const attempt: DecisionMakerAttempt = {
    at: new Date().toISOString(),
    clinicName: candidate.clinicName,
    steps: [
      {
        source: "manual",
        query: "Chosen by hand",
        actorId: null,
        results: 1,
        error: null,
      },
    ],
    selected: {
      name: chosen.name,
      title: chosen.title,
      confidence: chosen.confidence,
      source: "manual",
    },
    alternates: [],
  };

  const promotedLeadId = await applyDecisionMaker(
    args.id,
    candidate,
    chosen,
    attempt,
    "manually_added",
  );

  revalidatePath(`/discovery/${args.id}`);
  revalidatePath("/discovery");
  if (promotedLeadId) {
    revalidatePath("/pipeline");
    revalidatePath("/");
  }
  return { ok: true, promotedLeadId };
}

// ─── Writing one on ────────────────────────────────────────────────────────

// Puts a found person onto the candidate and, where the candidate has already
// qualified, promotes it.
//
// Two rules hold here. Nothing already on the record is overwritten — a
// contact, a LinkedIn URL or an email that was already there wins over
// anything a search returned. And the promotion is the existing one: the same
// transaction the queue uses, with the scorecard the queue produced, so a lead
// created this way is indistinguishable from one the queue promoted except
// that its contact was found a stage later.
async function applyDecisionMaker(
  id: string,
  candidate: {
    contactName: string | null;
    contactTitle: string | null;
    contactSocialUrls: string | null;
    linkedinUrl: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    icpBreakdown: string | null;
    decisionMakerLog: string | null;
  },
  chosen: DecisionMakerCandidate,
  attempt: DecisionMakerAttempt,
  status: "found" | "manually_added",
): Promise<string | null> {
  const patch = mergeFill(
    {
      contactName: candidate.contactName,
      contactTitle: candidate.contactTitle,
      linkedinUrl: candidate.linkedinUrl,
      email: candidate.email,
      phone: candidate.phone,
      contactSocialUrls: candidate.contactSocialUrls,
    },
    {
      contactName: chosen.name,
      contactTitle: chosen.title,
      linkedinUrl: chosen.linkedinUrl,
      email: chosen.email,
      phone: chosen.phone,
      contactSocialUrls: serializeSocialUrls(chosen.socialUrls),
    },
  );

  await writeAttempt(id, attempt, candidate.decisionMakerLog, {
    ...patch,
    decisionMakerStatus: status,
    decisionMakerConfidence: chosen.confidence,
    decisionMakerEvidence: chosen.evidence,
    decisionMakerAt: new Date(),
  });

  // Only a candidate that qualified is promoted from here, and only one that
  // now has a name on it. Anything else stays where it is — this stage decides
  // who to talk to, not whether the clinic was worth talking to.
  if (candidate.status !== "QUALIFIED_NO_CONTACT") return null;
  const breakdown = parseBreakdown(candidate.icpBreakdown);
  return promoteToLead(id, breakdown, new Date());
}

// Appends one attempt to the candidate's log, newest first, alongside whatever
// else this write is putting on the record — one update rather than two, so a
// candidate is never left with a status the log cannot explain.
async function writeAttempt(
  id: string,
  attempt: DecisionMakerAttempt,
  existingLog: string | null,
  data: Record<string, unknown>,
): Promise<void> {
  const log = serializeAttempts([attempt, ...parseDecisionMakerLog(existingLog)]);
  await prisma.discoveryCandidate.update({
    where: { id },
    data: { ...data, decisionMakerLog: log },
  });
}
