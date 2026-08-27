"use server";

// Decision-maker enrichment — the running half of src/lib/decisionMaker.ts.
//
// One button, on one candidate, running the procedure that module documents:
// a name off the clinic's own crawled copy, that exact name searched against
// the clinic on LinkedIn, the first profile in the results, a verification of
// it against the clinic, and then the name, the URL and a confidence written
// onto the record. When the site names nobody, and only then, the second-tier
// clinic-anchored searches.
//
// Three limits, all of them deliberate:
//
//   It re-runs nothing else. The company lookup, Maps, the ads library and the
//   crawler are not touched; this reads what they already wrote and spends
//   searches. "Retry" therefore costs this stage and not the chain.
//
//   It never overwrites. Every field it can write goes through mergeFill
//   (src/lib/discoveryDedupe.ts), so a contact somebody typed in survives a
//   search that disagrees with them.
//
//   It never rejects a plausible match for being unproven. A profile that
//   cannot be tied to the clinic outright is written at a lower confidence,
//   because a name somebody can check in ten seconds beats a blank field —
//   and the confidence is what says which of the two the record is holding.
//
// A candidate still waiting to be promoted is promoted the ordinary way when
// this lands somebody. A candidate that already became a lead has its lead
// filled in too, since that is where its contact lives now.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { runGoogleSearch } from "@/lib/googleSearchRun";
import { deepSeekJson } from "@/lib/deepseek";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { promoteToLead } from "@/lib/promoteLead";
import { parseBreakdown } from "@/lib/discovery";
import { mergeFill } from "@/lib/discoveryDedupe";
import {
  DecisionMakerAttempt,
  DecisionMakerCandidate,
  DecisionMakerConfidence,
  ExtractedName,
  MAX_NAMES_SEARCHED,
  MAX_SEARCH_QUERIES,
  VERIFY_SYSTEM_PROMPT,
  WEBSITE_NAME_SYSTEM_PROMPT,
  decisionMakerQueries,
  firstLinkedinProfile,
  hasDecisionMaker,
  isDecisionMakerConfidence,
  nameFromProfileUrl,
  nameLinkedinQuery,
  parseDecisionMakerLog,
  person,
  profileUrlsFromResults,
  rankCandidates,
  readExtractedNames,
  readVerification,
  serializeAttempts,
  serializeSocialUrls,
  verificationPrompt,
  websiteNamePrompt,
} from "@/lib/decisionMaker";

// The extraction reads a page of website copy and answers with a short list,
// and the verification answers with one object. Both are small on purpose:
// an answer longer than this has stopped answering the question.
const EXTRACTION_MAX_TOKENS = 500;
const VERIFICATION_MAX_TOKENS = 300;

// What the browser gets back from a run: what happened, who was found, and
// everybody else worth offering as an alternative.
export type FindDecisionMakerResult =
  | {
      ok: true;
      status: "found" | "not_found" | "failed";
      // The person written onto the record, or null when nobody was.
      selected: DecisionMakerCandidate | null;
      // The rest, best first — surfaced rather than silently discarded.
      alternates: DecisionMakerCandidate[];
      // Set when finding somebody promoted the candidate.
      promotedLeadId: string | null;
      // One line per step of the procedure, in the order it ran, for the panel
      // to show without opening the log.
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

  // The gate. Two refusals rather than one, because they are two different
  // situations and a single "cannot run" would leave somebody guessing which
  // of them they are in.
  if (hasDecisionMaker(candidate)) {
    return {
      ok: false,
      error: `${candidate.contactName} is already recorded here. Clear the contact first if the search should look again.`,
    };
  }
  if (candidate.status === "REJECTED" || candidate.disqualified) {
    return {
      ok: false,
      error:
        "This clinic was rejected, so there is nobody at it worth finding — requeue it first if that was wrong.",
    };
  }

  const settings = await loadPipelineSettings();
  if (!settings.decisionMaker.enabled) {
    return {
      ok: false,
      error:
        "Decision-maker enrichment is turned off. Turn it on under Settings → Pipeline, where its search actor is set too.",
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

  // ─── Steps 1-2. A name off the website already crawled ──────────────────
  //
  // Free — no crawl is run, the copy is already on the candidate — and the
  // whole procedure turns on it. A name with no role stated beside it counts:
  // that is the shape most clinic sites come in, and the rule that used to
  // require a title was throwing away the common case.
  let names: ExtractedName[] = [];
  let extractionError: string | null = null;

  if ((candidate.websiteNotes ?? "").trim() === "") {
    extractionError =
      "No website copy has been crawled onto this clinic, so there was nothing to read a name out of.";
  } else {
    const reply = await deepSeekJson({
      system: WEBSITE_NAME_SYSTEM_PROMPT,
      user: websiteNamePrompt(candidate.clinicName, candidate.websiteNotes),
      maxTokens: EXTRACTION_MAX_TOKENS,
    });
    if (reply.ok) names = readExtractedNames(reply.content);
    else extractionError = reply.error;
  }

  attempt.steps.push({
    source: "website",
    query: "DeepSeek — any named individual in the crawled website copy",
    actorId: null,
    results: names.length,
    error: extractionError,
  });
  steps.push({
    label: "Name from the website",
    detail:
      extractionError !== null
        ? extractionError
        : names.length === 0
          ? "The crawled copy named nobody — no doctor, owner or member of staff appears in it."
          : `${names.length} ${names.length === 1 ? "name" : "names"}: ${names.map((n) => n.name).join(", ")}.`,
  });

  // ─── Steps 3-6. That exact name, searched and verified ──────────────────
  //
  // One name at a time, and it stops at the first that verifies to anything
  // other than a contradiction: a second search once somebody has been found
  // is a bill for a name nobody will use. The names it did not get to are
  // there for the retry.
  let searchedNames = 0;
  for (const extracted of names.slice(0, MAX_NAMES_SEARCHED)) {
    if (found.length > 0) break;
    searchedNames += 1;

    const query = nameLinkedinQuery(extracted.name, candidate.clinicName);
    const search = await runGoogleSearch(query, actorId);
    if (!search.ok) {
      attempt.steps.push({
        source: "name_search",
        query,
        actorId,
        results: 0,
        error: search.error ?? "The search failed.",
      });
      steps.push({ label: `Search — ${extracted.name}`, detail: search.error ?? "The search failed." });
      continue;
    }

    const profile = firstLinkedinProfile(search.entries);
    if (profile === null) {
      attempt.steps.push({
        source: "name_search",
        query,
        actorId,
        results: 0,
        error: null,
      });
      steps.push({
        label: `Search — ${extracted.name}`,
        detail: `${search.urls.length} result${search.urls.length === 1 ? "" : "s"}, none of them a LinkedIn profile.`,
      });
      continue;
    }

    // Step 6. The check that tells this person from a stranger who shares the
    // name. A verification that cannot be run at all is not a rejection — the
    // profile is kept at Low, which is what "nobody checked" is worth.
    const check = await deepSeekJson({
      system: VERIFY_SYSTEM_PROMPT,
      user: verificationPrompt({
        clinicName: candidate.clinicName,
        extractedName: extracted.name,
        roleContext: extracted.roleContext,
        profileUrl: profile.url,
        resultTitle: profile.title,
        resultSnippet: profile.snippet,
      }),
      maxTokens: VERIFICATION_MAX_TOKENS,
    });
    const verdict = check.ok
      ? readVerification(check.content)
      : {
          verdict: "unsure" as const,
          confidence: "LOW" as DecisionMakerConfidence,
          name: null,
          title: null,
          reason: `The match could not be verified — ${check.error} It is kept at low confidence rather than assumed.`,
        };

    attempt.steps.push({
      source: "name_search",
      query,
      actorId,
      results: 1,
      error: verdict.verdict === "different" ? `Rejected — ${verdict.reason}` : null,
    });

    if (verdict.verdict === "different") {
      steps.push({
        label: `Search — ${extracted.name}`,
        detail: `A profile came back and was rejected: ${verdict.reason}`,
      });
      continue;
    }

    found.push(
      person({
        // The website's spelling unless the profile gave a fuller one. The
        // record should carry the name the person publishes under.
        name: verdict.name ?? extracted.name,
        title: verdict.title ?? extracted.roleContext,
        linkedinUrl: profile.url,
        source: "name_search",
        confidence: verdict.confidence,
        evidence: `“${extracted.name}” was named on ${candidate.clinicName}'s own website. Searching ${query} returned this profile, and ${verdict.verdict === "same" ? "the result confirms it" : "nothing in the result contradicts it"} — ${verdict.reason}`,
      }),
    );
    steps.push({
      label: `Search — ${extracted.name}`,
      detail: `${profile.url} — ${verdict.verdict === "same" ? "verified" : "kept unverified"}. ${verdict.reason}`,
    });
  }

  // ─── The second tier ────────────────────────────────────────────────────
  //
  // Only from here. The name path has been tried and produced nobody — either
  // the site named no one, or the names it gave searched to nothing — and this
  // is a guess about who runs the clinic rather than a search for somebody the
  // clinic named. Running it any earlier would spend the budget answering a
  // question the website could have answered.
  if (found.length === 0) {
    const queries = decisionMakerQueries(candidate.clinicName, candidate.location).slice(
      0,
      MAX_SEARCH_QUERIES,
    );
    let profilesSeen = 0;
    for (const query of queries) {
      const search = await runGoogleSearch(query, actorId);
      if (!search.ok) {
        attempt.steps.push({
          source: "search",
          query,
          actorId,
          results: 0,
          error: search.error ?? "The search failed.",
        });
        continue;
      }
      const profiles = profileUrlsFromResults(search.urls);
      profilesSeen += profiles.length;
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
            evidence: `The clinic's website named nobody, so this came from searching ${query}. Nothing found states their role at the clinic.`,
          }),
        );
      }
      attempt.steps.push({
        source: "search",
        query,
        actorId,
        results: profiles.length,
        error: null,
      });
      // One query that produced a name is enough; the rest are for the retry.
      if (found.length > 0) break;
    }
    steps.push({
      label: "Clinic-anchored search",
      detail:
        found.length === 0
          ? `${queries.length} ${queries.length === 1 ? "query" : "queries"} run against the clinic's name, no profile that could be named.`
          : `${profilesSeen} LinkedIn profile${profilesSeen === 1 ? "" : "s"} found against the clinic's name — no verification, so nothing here is above low confidence.`,
    });
  } else if (names.length > searchedNames) {
    steps.push({
      label: "Clinic-anchored search",
      detail: "Not run — the name from the website found somebody.",
    });
  }

  // ─── Step 7. The verdict ────────────────────────────────────────────────
  const ranked = rankCandidates(found);
  const selected = ranked[0] ?? null;
  const alternates = ranked.slice(1, 6);
  attempt.alternates = alternates.map((a) => a.name);

  if (selected === null) {
    // Nobody. The candidate keeps everything it had — its score, its evidence,
    // its place in the list — and gains a log of what was tried.
    //
    // "Failed" and "not found" are separated on the one thing that tells them
    // apart: whether anything actually got to look. Every step that could
    // search erroring is a failure to search, worth retrying as soon as
    // whatever broke is fixed; a clean run that turned nobody up is an answer,
    // and retrying it tomorrow will cost the same and say the same.
    const everyStepErrored =
      attempt.steps.length > 0 && attempt.steps.every((step) => step.error !== null);
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
  if (candidate.promotedLeadId || promotedLeadId) {
    revalidatePath("/pipeline");
    revalidatePath("/outreach");
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
// because a person a human chose is a different kind of fact from a person a
// search returned, and the record should say which it is holding.
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
  if (candidate.promotedLeadId || promotedLeadId) {
    revalidatePath("/pipeline");
    revalidatePath("/outreach");
    revalidatePath("/");
  }
  return { ok: true, promotedLeadId };
}

// ─── Writing one on ────────────────────────────────────────────────────────

// Puts a found person onto the candidate, and then wherever else that clinic's
// contact now lives.
//
// Two rules hold here. Nothing already on the record is overwritten — a
// contact, a LinkedIn URL or an email that was already there wins over
// anything a search returned. And where the clinic has already become a lead,
// the same patch goes onto the lead: it is promoted on its score alone now, so
// the pipeline is where a decision maker found afterwards is actually needed.
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
    promotedLeadId: string | null;
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

  // Already a lead: fill the same fields in there, and again only where they
  // are empty — a name typed onto the lead by whoever is working it is worth
  // more than one a search found, and is not replaced.
  if (candidate.promotedLeadId !== null) {
    await fillLead(candidate.promotedLeadId, chosen);
    return null;
  }

  // Not a lead yet, and qualified: promote it the ordinary way, through the
  // same path the queue uses.
  if (candidate.status !== "QUALIFIED_NO_CONTACT") return null;
  const breakdown = parseBreakdown(candidate.icpBreakdown);
  return promoteToLead(id, breakdown, new Date());
}

// The lead half of the write above. Its own function because it re-reads the
// lead first: the candidate's columns say what the candidate had, and what the
// lead has is a separate question — somebody may have typed a contact straight
// onto it.
async function fillLead(leadId: string, chosen: DecisionMakerCandidate): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      contactName: true,
      contactTitle: true,
      contactSocialUrls: true,
      linkedinUrl: true,
      email: true,
      phone: true,
    },
  });
  if (lead === null) return;

  const patch = mergeFill(lead, {
    contactName: chosen.name,
    contactTitle: chosen.title,
    linkedinUrl: chosen.linkedinUrl,
    email: chosen.email,
    phone: chosen.phone,
    contactSocialUrls: serializeSocialUrls(chosen.socialUrls),
  });
  if (Object.keys(patch).length === 0) return;
  await prisma.lead.update({ where: { id: leadId }, data: patch });
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
