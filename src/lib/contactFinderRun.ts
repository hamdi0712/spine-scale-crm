// The contact finder — the run, for one lead at a time. Server-only, and not a
// "use server" module: the contact-finder job (src/lib/actions/jobs.ts) calls
// it; the browser never does. The rules are src/lib/contactFinder.ts.
//
// Two modes:
//   apply    the automatic run: fills what is blank, routes the lead, and
//            writes contactStatus. Never overwrites what was set by hand or
//            through the connector, and changes nothing about the contact,
//            the email or the status once anything has been sent.
//   propose  "Look up again": the same steps, but nothing on the lead
//            changes. What differs from the lead is stored as a proposal
//            (contactProposal) for the lead page to offer: Replace or Keep.
//
// Spends only from the budget the job hands in, and stops — the lead marked
// needs_you, "Out of credits" — the moment Hunter or Instantly would go past
// this month's.

import { prisma } from "@/lib/prisma";
import { FIND_EMAILS_WHERE } from "@/lib/liveLeadWhere";
import {
  ContactProposal,
  ContactStatus,
  FAILED_STEP_RETRY_MS,
  missingKey,
  FoundAddress,
  MAX_STEP_FAILURES,
  NOT_RUN_YET,
  OUT_OF_CREDITS,
  OWNER_PICK_CALL_USD,
  OWNER_PICK_SYSTEM,
  OwnerCandidate,
  OwnerConfidence,
  OwnerEvidence,
  RUN_MARK,
  TraceEntry,
  UNKNOWN_RETRY_MS,
  addressesOf,
  asCandidate,
  canAutoAccept,
  contactLocked,
  contactSetByHand,
  emailSetByHand,
  ownerCandidates,
  ownerPickPrompt,
  parseFailures,
  parseProposal,
  parseTrace,
  readOwnerConfidence,
  readOwnerPick,
  routeFor,
  rulePick,
  serializeTrace,
  stepFailed,
} from "@/lib/contactFinder";
import { EmailSource, classifyAddress, clinicDomain, hasFrontDeskWord, isMailboxProvider, readDecisionMakerName } from "@/lib/emailFind";
import { decideOwner, matchNpiOrganization, npiNameQueries, samePerson, siteDoctorNames, stateFromLocation, NpiMatch, addressFromPattern, guessAddresses } from "@/lib/ownerFind";
import { searchNpiOrganizations } from "@/lib/npiRegistry";
import { findEmail, searchDomain } from "@/lib/hunter";
import { checkAddress, checkReadiness } from "@/lib/emailCheckRun";
import { hunterCreditsUsedThisMonth, rebuildDraft } from "@/lib/ownerFindRun";
import { findBackupEmail } from "@/lib/facebookEmailRun";
import { deepSeekJson } from "@/lib/deepseek";
import { getDeepseekApiKey, getHunterApiKey, getInstantlyApiKey } from "@/lib/appSecretsStore";
import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { FACEBOOK_PAGE_USD_PER_PAGE } from "@/lib/pipelineSettings";
import { pickContactFormLink } from "@/lib/contactForm";
import { riskyAccepted } from "@/lib/emailWorkflow";
import { syncLeadInbox } from "@/lib/emailInboxes";
import { fmtCredits } from "@/lib/emailCheck";

// ─── The budget a job spends from ──────────────────────────────────────────

export interface FinderBudget {
  hunterLeft: number;
  instantlyLeft: number;
  perCheck: number;
  guess: boolean;
  hunterSpent: number;
  instantlySpent: number;
  deepseekUsd: number;
  facebookUsd: number;
}

export async function finderBudget(now = new Date()): Promise<FinderBudget> {
  const [settings, hunterUsed, instantly] = await Promise.all([loadEmailSettings(), hunterCreditsUsedThisMonth(now), checkReadiness(0, now)]);
  return {
    hunterLeft: Math.max(0, settings.hunterCreditBudget - hunterUsed),
    instantlyLeft: instantly.left,
    perCheck: settings.creditsPerCheck,
    guess: settings.guessOwnerPatterns,
    hunterSpent: 0,
    instantlySpent: 0,
    deepseekUsd: 0,
    facebookUsd: 0,
  };
}

// ─── What a run reports ────────────────────────────────────────────────────

export interface FinderOutcome {
  status: ContactStatus | null;
  detail: string;
  // A refused key or a plan without API access: the job stops.
  stop?: boolean;
}

const SOURCE_LABEL: Partial<Record<EmailSource, string>> = {
  maps_contacts: "Maps",
  site_crawl: "Site",
  extractor: "Site",
  facebook_page: "Facebook",
  hunter: "Hunter",
  hunter_inferred: "Hunter",
  pattern_guess: "Guess",
  manual: "By hand",
  imported: "Imported",
};

type LeadRow = NonNullable<Awaited<ReturnType<typeof loadLead>>>;

function loadLead(leadId: string) {
  return prisma.lead.findUnique({ where: { id: leadId }, include: { _count: { select: { emailSends: true } } } });
}

const credits = (n: number, what: string) => `${fmtCredits(n)} ${what} credit${n === 1 ? "" : "s"}`;

// ─── The run ───────────────────────────────────────────────────────────────

export async function runContactFinder(
  leadId: string,
  budget: FinderBudget,
  opts: { mode?: "apply" | "propose"; now?: Date } = {},
): Promise<FinderOutcome> {
  const now = opts.now ?? new Date();
  const lead = await loadLead(leadId);
  if (!lead) return { status: null, detail: "No longer here." };
  // Email leads only: the LinkedIn pipeline is never touched.
  if (lead.channel !== "email") return { status: null, detail: "Not an email lead — left alone." };

  const locked = contactLocked(lead, lead._count.emailSends);
  // A sent lead can only ever be shown a proposal.
  const mode = locked ? "propose" : (opts.mode ?? "apply");
  const approved = lead.emailApprovedAt !== null;
  const trace: TraceEntry[] = parseTrace(lead.contactTrace);
  const add = (e: Omit<TraceEntry, "at">) => trace.push({ ...e, at: now.toISOString() });
  add({ step: RUN_MARK, result: mode === "propose" ? "Look up again" : "Contact finder" });
  const failures = parseFailures(lead.contactFailures);

  // Writes common to every way a run ends.
  const finish = async (data: Record<string, unknown>, out: FinderOutcome): Promise<FinderOutcome> => {
    await prisma.lead.update({
      where: { id: leadId },
      data: { contactTrace: serializeTrace(trace), contactFailures: JSON.stringify(failures), ...data },
    });
    return out;
  };
  // A block that needs a person. In a look-up, the lead's own status stays.
  const needsYou = (reason: string, out: Partial<FinderOutcome> = {}) =>
    mode === "propose"
      ? finish({}, { status: null, detail: reason, ...out })
      : finish({ contactStatus: "needs_you", contactStatusReason: reason, contactRetryAt: null }, { status: "needs_you", detail: reason, ...out });
  // An API error: needs you on the second in a row, tried again later on the first.
  const failed = async (step: string, error: string, stop = false) => {
    failures[step] = (failures[step] ?? 0) + 1;
    add({ step, result: `failed — ${error}` });
    if (failures[step] >= MAX_STEP_FAILURES || stop) return needsYou(stepFailed(step), { stop });
    if (mode === "propose") return finish({}, { status: null, detail: `${step} failed: ${error}` });
    return finish(
      { contactStatus: "finding", contactStatusReason: null, contactRetryAt: new Date(now.getTime() + FAILED_STEP_RETRY_MS) },
      { status: "finding", detail: `${step} failed once — tried again shortly. ${error}` },
    );
  };
  const succeeded = (step: string) => {
    delete failures[step];
  };

  if (locked && opts.mode !== "propose") {
    add({ step: "Locked", result: "already sent — nothing changed" });
    return finish({}, { status: null, detail: "Already sent: the finder changes nothing on it." });
  }

  // ─── 1. Collect ──────────────────────────────────────────────────────────
  const addresses: FoundAddress[] = addressesOf(lead);
  const bySource = new Map<string, string[]>();
  for (const a of addresses) {
    const label = (a.source && SOURCE_LABEL[a.source]) ?? "On file";
    bySource.set(label, [...(bySource.get(label) ?? []), a.address]);
  }
  if (bySource.size === 0) add({ step: "Maps/site", result: "none" });
  for (const [label, list] of Array.from(bySource)) add({ step: label, result: list.join(", ") });

  // ─── 2. The owner ────────────────────────────────────────────────────────
  const handContact = contactSetByHand(lead);
  let owner: string | null = null;
  let confidence: OwnerConfidence | null = null;
  let ownerReason: string | null = null;
  const ownerWrites: Record<string, unknown> = {};
  const storedConfidence = readOwnerConfidence(lead.ownerConfidence);

  if (handContact && (lead.contactName ?? "").trim() !== "") {
    owner = lead.contactName;
    confidence = "high";
    add({ step: "Owner", result: `${owner} (set by hand)` });
  } else if (mode === "apply" && storedConfidence && lead.ownerCheckedAt) {
    // Looked up on an earlier run: not asked again (no second DeepSeek call).
    owner = lead.ownerStatus === "confirmed" ? lead.contactName : null;
    confidence = owner ? storedConfidence : null;
    add({ step: "Owner", result: owner ? `${owner} (earlier, ${storedConfidence})` : "not found (earlier)" });
  } else {
    const r = await lookUpOwner(lead, add);
    if (r.kind === "failed") return failed("NPI", r.error);
    succeeded("NPI");
    owner = r.name;
    confidence = r.confidence;
    ownerReason = r.reason;
    budget.deepseekUsd += r.deepseekUsd;
    Object.assign(ownerWrites, r.writes);
  }

  // Who the email is to: blanks filled; a contact set by hand never touched; a
  // machine-set one replaced only by a high-confidence owner.
  let contactName = lead.contactName;
  if (!handContact && owner) {
    const blank = (lead.contactName ?? "").trim() === "";
    if (blank || (confidence === "high" && !samePerson(lead.contactName, owner))) contactName = owner;
  }
  const contactIsOwner = owner !== null && samePerson(contactName, owner);
  const finalConfidence: OwnerConfidence | null = handContact ? null : contactName ? (contactIsOwner ? confidence : "low") : null;

  // Addresses read again against the owner: drhishon@ is the owner's once
  // Dr. Hishon is known. A front-desk word (paportofrontdesk@) always means
  // the front desk, whatever was stored. A type set by hand stays.
  const person = readDecisionMakerName(contactName);
  for (const a of addresses) {
    if (a.main && lead.emailTypeByHand) continue;
    if (hasFrontDeskWord(a.address)) a.type = "generic";
    else if (person && a.type === "generic" && classifyAddress(a.address, person) === "owner") a.type = "owner";
  }

  // ─── 3a. Hunter: the owner's own address ─────────────────────────────────
  const domain = clinicDomain(lead.websiteUrl);
  const hasOwnerAddress = addresses.some((a) => a.type === "owner" && a.status !== "invalid");
  const ownerName = readDecisionMakerName(owner ?? contactName);
  if (hasOwnerAddress) {
    // Nothing to look for.
  } else if ((confidence !== "high" && !handContact) || !ownerName?.first || !ownerName.last) {
    add({ step: "Hunter", result: confidence === "low" ? "skipped (owner not certain)" : "skipped (no owner name)" });
  } else if (!domain || isMailboxProvider(domain)) {
    add({ step: "Hunter", result: "skipped (no clinic domain)" });
  } else if (!(await getHunterApiKey())) {
    // Hunter is needed here (no owner address, a sure owner, the clinic's own
    // domain) and cannot run: the lead needs you until a key is saved.
    add({ step: "Hunter", result: "no API key" });
    return needsYou(missingKey("Hunter"));
  } else {
    if (budget.hunterLeft < 1) {
      add({ step: "Hunter", result: "out of credits" });
      return needsYou(OUT_OF_CREDITS);
    }
    const f = await findEmail(domain, ownerName.first, ownerName.last);
    if (!f.ok) {
      if (f.code === "quota") {
        add({ step: "Hunter", result: "Hunter's credits are used up" });
        return needsYou(OUT_OF_CREDITS);
      }
      if (f.code === "claimed") add({ step: "Hunter", result: "the owner asked Hunter not to process them" });
      else return failed("Hunter", f.error, f.code === "auth");
    } else {
      succeeded("Hunter");
      await prisma.hunterCall.create({ data: { leadId, endpoint: "email-finder", domain, result: f.email, creditsUsed: f.creditsUsed } });
      budget.hunterLeft -= f.creditsUsed;
      budget.hunterSpent += f.creditsUsed;
      const onDomain = f.email && f.email.endsWith(`@${domain}`) ? f.email : null;
      if (onDomain && !addresses.some((a) => a.address === onDomain)) {
        addresses.push({ address: onDomain, type: "owner", status: null, source: f.provenance === "found" ? "hunter" : "hunter_inferred", main: false });
      }
      add({ step: "Hunter", result: onDomain ? `${onDomain} (${f.provenance})` : "none", cost: f.creditsUsed > 0 ? credits(f.creditsUsed, "Hunter") : undefined });
      // The guesses, only with Settings → Email's switch on.
      if (!onDomain && budget.guess) {
        if (budget.hunterLeft < 1) return needsYou(OUT_OF_CREDITS);
        const d = await searchDomain(domain);
        if (!d.ok) return failed("Hunter", d.error, d.code === "auth");
        await prisma.hunterCall.create({ data: { leadId, endpoint: "domain-search", domain, result: d.pattern, creditsUsed: d.creditsUsed } });
        budget.hunterLeft -= d.creditsUsed;
        budget.hunterSpent += d.creditsUsed;
        const fromPattern = d.pattern ? addressFromPattern(d.pattern, ownerName, domain) : null;
        const guesses = fromPattern ? [fromPattern] : guessAddresses(ownerName, domain);
        for (const g of guesses) if (!addresses.some((a) => a.address === g)) addresses.push({ address: g, type: "owner", status: null, source: "pattern_guess", main: false });
        add({ step: "Hunter", result: `${guesses.length} guess${guesses.length === 1 ? "" : "es"}${d.pattern ? ` from ${d.pattern}` : ""}`, cost: d.creditsUsed > 0 ? credits(d.creditsUsed, "Hunter") : undefined });
      }
    }
  }

  // ─── 3b. Facebook: only with no address at all ───────────────────────────
  if (!addresses.some((a) => a.status !== "invalid")) {
    const pipeline = await loadPipelineSettings();
    if (!pipeline.facebookEmails.enabled) add({ step: "Facebook", result: "off in Settings" });
    else if ((lead.facebookUrl ?? "").trim() === "") add({ step: "Facebook", result: "no page" });
    else if (lead.facebookEmailAt) add({ step: "Facebook", result: "read earlier" });
    else if (mode === "propose") add({ step: "Facebook", result: "not read in a look-up" });
    else {
      const r = await findBackupEmail(leadId, pipeline);
      if (r.kind === "failed") return failed("Facebook", r.detail);
      succeeded("Facebook");
      budget.facebookUsd += FACEBOOK_PAGE_USD_PER_PAGE;
      // findBackupEmail wrote what it found (only while the lead's email was empty).
      const fresh = await loadLead(leadId);
      for (const a of fresh ? addressesOf(fresh) : []) if (!addresses.some((x) => x.address === a.address)) addresses.push(a);
      add({ step: "Facebook", result: r.kind === "found" ? r.email : "none", cost: `$${FACEBOOK_PAGE_USD_PER_PAGE} Apify` });
    }
  }

  // ─── 4. Instantly: every new address once ────────────────────────────────
  const retryDue = lead.contactRetryAt !== null && lead.contactRetryAt.getTime() <= now.getTime();
  const handMain = emailSetByHand(lead);
  let firstUnknown = false;
  const guessed = addresses.filter((a) => a.source === "pattern_guess");
  for (const a of addresses) {
    const due = a.status === null || (a.status === "unknown" && retryDue);
    if (!due) continue;
    // Guesses: the first good one is enough; a catch-all accepts them all alike.
    if (a.source === "pattern_guess" && guessed.some((g) => g !== a && (g.status === "valid" || g.status === "risky"))) continue;
    if (budget.instantlyLeft + 1e-9 < budget.perCheck) {
      add({ step: "Instantly", result: "out of credits" });
      return needsYou(OUT_OF_CREDITS);
    }
    const c = await checkAddress(leadId, a.address);
    if (!c.ok) {
      if (c.code === "no_key") {
        // Nothing can be checked: the lead needs you until a key is saved
        // (saving one wakes the finder; see finderDueLeads).
        add({ step: "Instantly", result: "no API key" });
        return needsYou(missingKey("Instantly"));
      }
      return failed("Instantly", c.error, c.code === "auth" || c.code === "plan");
    }
    succeeded("Instantly");
    budget.instantlyLeft -= c.credits;
    budget.instantlySpent += c.credits;
    const was = a.status;
    let status: string = c.status;
    let note = "";
    if (status === "unknown") {
      if (was === "unknown") {
        // Its one retry, still unsettled: treated as risky from here on.
        status = "risky";
        note = " — unknown again, treated as risky";
      } else {
        firstUnknown = true;
        note = " — retried in 24h";
      }
    }
    a.status = status;
    add({ step: "Instantly", result: `${a.address} ${c.status}${note}`, cost: credits(c.credits, "Instantly") });
  }

  // Risky and found on the clinic's own domain or free mail: accepted.
  const handAccepted = (a: FoundAddress) => a.main && riskyAccepted(lead);
  // An address the operator revoked is theirs to accept again, never the finder's.
  const revoked = await revokedAddresses(leadId);
  const autoAcceptable = (a: FoundAddress) => !revoked.has(a.address) && canAutoAccept(a, lead.websiteUrl);
  const accepted = (a: FoundAddress) => handAccepted(a) || autoAcceptable(a);

  // ─── 5. Route ────────────────────────────────────────────────────────────
  const contactFormUrl = pickContactFormLink(lead.websiteLinks, lead.websiteUrl);
  // A main email set by hand stays the main email: route on it alone.
  const routable = handMain ? addresses.filter((a) => a.main) : addresses;
  const routed = routeFor(routable, accepted, contactFormUrl);
  const pendingUnknown = addresses.some((a) => a.status === "unknown");
  const waitForRetry = pendingUnknown && (routed.route === "contact_form" || routed.route === "call");
  const retryAt = pendingUnknown && (firstUnknown || !lead.contactRetryAt || retryDue) ? new Date(now.getTime() + UNKNOWN_RETRY_MS) : pendingUnknown ? lead.contactRetryAt : null;

  // ─── Look up again: nothing changes, differences are proposed ────────────
  if (mode === "propose") {
    const foundEmail = routed.address;
    const proposal: ContactProposal = {
      owner: owner && !samePerson(lead.contactName, owner) ? { current: lead.contactName, found: owner, confidence: confidence ?? "low", reason: ownerReason } : null,
      email:
        foundEmail && foundEmail.address !== (lead.email ?? "").trim().toLowerCase()
          ? { current: lead.email, found: foundEmail.address, type: foundEmail.type, status: foundEmail.status, source: foundEmail.source }
          : null,
      route: routed.route,
      at: now.toISOString(),
    };
    const differs = proposal.owner !== null || proposal.email !== null;
    add({ step: "Look up again", result: differs ? "found something different — Replace or Keep" : "same as on file" });
    // The address on file, accepted if the rules say so: replacing nothing,
    // so not a proposal. Never on a sent lead.
    const mainNow = addresses.find((a) => a.main) ?? null;
    const accept =
      !locked && mainNow && mainNow.status === "risky" && !handAccepted(mainNow) && autoAcceptable(mainNow)
        ? await autoAcceptWrite(lead, mainNow, now, add)
        : {};
    const out = await finish(
      { contactProposal: differs ? JSON.stringify(proposal) : null, ...accept },
      { status: null, detail: differs ? "Different result — waiting on you." : "Same as on file." },
    );
    // Accepted: it may be Ready now, so its inbox follows.
    if (Object.keys(accept).length > 0) await syncLeadInbox(leadId);
    return out;
  }

  // ─── Apply ───────────────────────────────────────────────────────────────
  const current = lead.contactStatus as ContactStatus | null;
  const settled = current === "owner_email" || current === "front_desk";
  // Approved (or Ready) already: the result goes in the trace and the lead
  // stays where it is — no upgrade, no new main email.
  if (approved && settled && routed.route !== current) {
    add({ step: "Route", result: `${routed.route === "owner_email" ? "owner address" : routed.route} now possible — left as is (approved)` });
    return finish({ ...ownerWrites, contactRetryAt: retryAt }, { status: current, detail: "Approved already: left where it is." });
  }

  const status: ContactStatus = waitForRetry ? "finding" : routed.route;
  const data: Record<string, unknown> = {
    ...ownerWrites,
    contactStatus: status,
    contactStatusReason: null,
    contactRetryAt: retryAt,
    contactProposal: null,
    ownerConfidence: finalConfidence,
  };
  const contactChanged = contactName !== lead.contactName;
  if (contactChanged) {
    data.contactName = contactName;
    // A confirmed owner settles the contact check; a low one names nobody anyway.
    if (finalConfidence === "high") data.contactConfirmedAt = now;
  }

  // The email columns: the route's address becomes the main one (unless the
  // main one was set by hand, or the lead is approved); every other address
  // kept in the alternates with what is now known about it.
  const mainBefore = addresses.find((a) => a.main) ?? null;
  const chosen = !handMain && !approved && routed.address ? routed.address : mainBefore;
  // An invalid main address found by a machine goes to the alternates.
  const newMain = chosen && (chosen.status !== "invalid" || handMain) ? chosen : null;
  const alternates = addresses.filter((a) => a.address !== newMain?.address).map(asCandidate);
  data.emailAlternates = alternates.length > 0 ? JSON.stringify(alternates) : null;
  const mainChanged = (newMain?.address ?? "") !== (mainBefore?.address ?? "");
  if (newMain) {
    data.email = newMain.address;
    if (!(newMain.main && lead.emailTypeByHand)) data.emailType = newMain.type;
    data.emailStatus = newMain.status;
    if (mainChanged) data.emailSource = newMain.source;
    // Compared with what was stored: the address objects above carry the new
    // verdicts already.
    if (mainChanged || newMain.status !== lead.emailStatus) data.emailCheckedAt = now;
    // Accepted automatically: logged, and from here it counts as an accepted
    // risky address everywhere — the risky daily limit, a bounce on its domain.
    if (newMain.status === "risky" && !handAccepted(newMain) && autoAcceptable(newMain)) {
      Object.assign(data, await autoAcceptWrite(lead, newMain, now, add));
    }
  } else if (mainBefore) {
    Object.assign(data, { email: null, emailType: null, emailStatus: null, emailSource: null });
  }

  add({ step: "Route", result: waitForRetry ? "waiting on the Instantly retry" : routed.address ? `${routed.address.address}` : routed.route === "contact_form" ? "contact form" : "call" });
  await prisma.lead.update({ where: { id: leadId }, data: { contactTrace: serializeTrace(trace), contactFailures: JSON.stringify(failures), ...data } });
  // The greeting is built from the contact and the address: an unapproved
  // draft is rebuilt around them (the opener itself is not touched).
  if ((contactChanged || mainChanged) && !approved) await rebuildDraft(leadId);
  await syncLeadInbox(leadId);
  return { status, detail: `${routed.address ? routed.address.address : routed.route === "contact_form" ? "Contact form" : "Call list"}${waitForRetry ? " (waiting on a retry)" : ""}` };
}

// Addresses whose acceptance the operator revoked on this lead (logged by
// revokeRiskyEmail as EMAIL_RISKY_REVOKED).
export async function revokedAddresses(leadId: string): Promise<Set<string>> {
  const rows = await prisma.activityLog.findMany({ where: { leadId, kind: "EMAIL_RISKY_REVOKED" }, select: { summary: true } });
  const out = new Set<string>();
  for (const r of rows) {
    const m = /risky address (\S+@\S+?) for /.exec(r.summary);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

// Accepting a risky address automatically: the lead's fields, and the
// activity-feed line. From here it counts as an accepted risky address
// everywhere — the risky daily limit, a bounce on its domain.
export async function autoAcceptWrite(
  lead: { id: string; clinicName: string },
  a: { address: string; source: EmailSource | null },
  now: Date,
  add?: (e: Omit<TraceEntry, "at">) => void,
): Promise<Record<string, unknown>> {
  await prisma.activityLog.create({
    data: {
      kind: "EMAIL_RISKY_ACCEPTED",
      summary: `Auto-accepted risky address ${a.address} for ${lead.clinicName} (found on ${SOURCE_LABEL[a.source ?? "imported"] ?? "file"}, catch-all domain)`,
      leadId: lead.id,
    },
  });
  add?.({ step: "Instantly", result: `${a.address} risky — auto-accepted` });
  return { emailRiskyAcceptedAt: now, emailRiskyAcceptedEmail: a.address };
}

// ─── The owner step ────────────────────────────────────────────────────────

type OwnerLookup =
  | { kind: "failed"; error: string }
  | { kind: "done"; name: string | null; confidence: OwnerConfidence | null; reason: string | null; deepseekUsd: number; writes: Record<string, unknown> };

async function lookUpOwner(lead: LeadRow, add: (e: Omit<TraceEntry, "at">) => void): Promise<OwnerLookup> {
  const state = stateFromLocation(lead.location);
  let match: NpiMatch | null = null;
  for (const q of npiNameQueries(lead.clinicName)) {
    const r = await searchNpiOrganizations(q, state);
    if (!r.ok) return { kind: "failed", error: r.error };
    match = matchNpiOrganization(lead, r.results);
    if (match) break;
  }
  const siteNames = siteDoctorNames(lead.websiteNotes, lead.websiteLinks);
  const decision = decideOwner(match, siteNames);
  const now = new Date();
  const writes: Record<string, unknown> = {
    npiNumber: match ? match.org.number : null,
    npiOfficialName: match ? decision.official : null,
    npiOfficialTitle: match ? match.org.official.title : null,
    ownerSiteNames: siteNames.length > 0 ? JSON.stringify(siteNames) : null,
    ownerCheckedAt: now,
  };
  const label = match ? "NPI" : "Site";

  if (decision.status === "confirmed" && decision.name) {
    add({ step: label, result: `${decision.name} (high)`, reason: decision.detail });
    return { kind: "done", name: decision.name, confidence: "high", reason: decision.detail, deepseekUsd: 0, writes: { ...writes, ownerStatus: "confirmed", ownerSource: decision.source } };
  }
  const candidates: OwnerCandidate[] = ownerCandidates(decision.official, decision.officialIsDecisionMaker, siteNames);
  if (candidates.length === 0) {
    add({ step: label, result: "no doctor found" });
    return { kind: "done", name: null, confidence: null, reason: null, deepseekUsd: 0, writes: { ...writes, ownerStatus: "not_found", ownerSource: null } };
  }
  const sourceOf = (c: OwnerCandidate) => (c.npi ? (c.onSite ? "npi_site" : "npi") : "site");
  if (candidates.length === 1) {
    const c = candidates[0];
    add({ step: label, result: `${c.name} (high)` });
    return { kind: "done", name: c.name, confidence: "high", reason: decision.detail, deepseekUsd: 0, writes: { ...writes, ownerStatus: "confirmed", ownerSource: sourceOf(c) } };
  }

  // Several: DeepSeek picks, on the stored evidence only.
  const ev: OwnerEvidence = {
    websiteNotes: lead.websiteNotes,
    addresses: addressesOf(lead).map((a) => a.address),
    websiteUrl: lead.websiteUrl,
    npiOfficial: decision.official,
    npiTitle: match?.org.official.title ?? null,
  };
  let pick = null as ReturnType<typeof readOwnerPick>;
  let usd = 0;
  let aiNote = "AI off";
  if (await getDeepseekApiKey()) {
    // Twice at most; then the same priorities applied by code.
    for (let attempt = 0; attempt < 2 && pick === null; attempt++) {
      const reply = await deepSeekJson({ system: OWNER_PICK_SYSTEM, user: ownerPickPrompt(candidates, ev), maxTokens: 300, networkRetries: 1 });
      if (!reply.ok) {
        aiNote = "AI failed twice";
        continue;
      }
      usd += OWNER_PICK_CALL_USD;
      pick = readOwnerPick(reply.content, candidates, ev);
      if (pick === null) aiNote = "AI answer unusable";
    }
  }
  if (pick) {
    const chosen = candidates.find((c) => c.name === pick!.name)!;
    add({ step: label, result: `${pick.name} (AI, ${pick.confidence})`, cost: `$${usd.toFixed(3)} DeepSeek`, quote: pick.quote ?? undefined, reason: pick.reason });
    return {
      kind: "done",
      name: pick.name,
      confidence: pick.confidence,
      reason: pick.reason,
      deepseekUsd: usd,
      writes: { ...writes, ownerStatus: "confirmed", ownerSource: sourceOf(chosen) },
    };
  }
  const fallback = rulePick(candidates, ev);
  const chosen = candidates.find((c) => c.name === fallback.name)!;
  add({ step: label, result: `${fallback.name} (rule, low — ${aiNote})`, cost: usd > 0 ? `$${usd.toFixed(3)} DeepSeek` : undefined, reason: fallback.rule });
  return {
    kind: "done",
    name: fallback.name,
    confidence: "low",
    reason: fallback.rule,
    deepseekUsd: usd,
    writes: { ...writes, ownerStatus: "confirmed", ownerSource: sourceOf(chosen) },
  };
}

// ─── Replace / Keep ────────────────────────────────────────────────────────

// Replace: what "Look up again" found goes onto the lead, as the operator's
// own choice (set by hand from here). The status follows the new address —
// except on a sent lead, whose status never changes.
export async function applyProposal(leadId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const lead = await loadLead(leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const p = parseProposal(lead.contactProposal);
  if (!p) return { ok: false, error: "There is nothing to replace — look it up again." };
  const data: Record<string, unknown> = { contactProposal: null };
  const trace = parseTrace(lead.contactTrace);
  const now = new Date();
  if (p.owner) {
    Object.assign(data, { contactName: p.owner.found, contactNameByHand: true, contactConfirmedAt: now, ownerConfidence: null, ownerStatus: "confirmed", ownerSource: "manual" });
    trace.push({ step: "Replaced", result: `contact ${lead.contactName ?? "(none)"} → ${p.owner.found}`, at: now.toISOString() });
  }
  if (p.email) {
    const addresses = addressesOf(lead);
    const old = addresses.find((a) => a.main) ?? null;
    const others = addresses.filter((a) => a.address !== p.email!.found && a.address !== old?.address).map(asCandidate);
    const alternates = [...(old ? [asCandidate(old)] : []), ...others];
    Object.assign(data, {
      email: p.email.found,
      emailType: p.email.type,
      emailTypeByHand: true,
      emailStatus: p.email.status,
      emailSource: p.email.source ?? "manual",
      emailCheckedAt: now,
      emailAlternates: alternates.length > 0 ? JSON.stringify(alternates) : null,
    });
    trace.push({ step: "Replaced", result: `email ${lead.email ?? "(none)"} → ${p.email.found}`, at: now.toISOString() });
  }
  if (!contactLocked(lead, lead._count.emailSends) && p.route) {
    data.contactStatus = p.route;
    data.contactStatusReason = null;
  }
  data.contactTrace = serializeTrace(trace);
  await prisma.lead.update({ where: { id: leadId }, data });
  if (lead._count.emailSends === 0 && !lead.emailApprovedAt) await rebuildDraft(leadId);
  await syncLeadInbox(leadId);
  return { ok: true };
}

export async function keepCurrent(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { contactTrace: true } });
  if (!lead) return;
  const trace = parseTrace(lead.contactTrace);
  trace.push({ step: "Kept", result: "the lead as it was", at: new Date().toISOString() });
  await prisma.lead.update({ where: { id: leadId }, data: { contactProposal: null, contactTrace: serializeTrace(trace) } });
}

// ─── Which leads ───────────────────────────────────────────────────────────

// Email leads the finder may work on at all: live, not Lost, nothing sent,
// not replied to or stopped. LinkedIn leads never.
const FINDER_LEAD_WHERE = {
  ...FIND_EMAILS_WHERE,
  channel: "email",
  emailSends: { none: {} },
  emailRepliedAt: null,
  suppressedAt: null,
  emailUnsubscribedAt: null,
} as const;

// Puts these leads in line for the finder ("finding"), clearing an old block.
// Leads the finder may not touch (LinkedIn, sent, stopped) are left as they are.
export async function markForFinder(leadIds: string[]): Promise<string[]> {
  if (leadIds.length === 0) return [];
  const rows = await prisma.lead.findMany({ where: { ...FINDER_LEAD_WHERE, id: { in: leadIds } }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { contactStatus: "finding", contactStatusReason: null, contactRetryAt: null, contactFailures: null } });
  }
  return ids;
}

// What the automatic run takes: leads waiting to be found (or due a retry of
// a failed step), leads with an unknown address due its one retry, and leads
// blocked only by credits once both budgets have room again.
export async function finderDueLeads(now = new Date()): Promise<{ id: string; clinicName: string }[]> {
  const budget = await finderBudget(now);
  const room = budget.hunterLeft >= 1 && budget.instantlyLeft + 1e-9 >= budget.perCheck;
  // A key saved since: the leads it blocked are due again.
  const keys = [
    ...((await getInstantlyApiKey()) ? [missingKey("Instantly")] : []),
    ...((await getHunterApiKey()) ? [missingKey("Hunter")] : []),
  ];
  return prisma.lead.findMany({
    where: {
      ...FINDER_LEAD_WHERE,
      OR: [
        { contactStatus: "finding", OR: [{ contactRetryAt: null }, { contactRetryAt: { lte: now } }] },
        { contactRetryAt: { lte: now } },
        ...(room ? [{ contactStatus: "needs_you", contactStatusReason: OUT_OF_CREDITS }] : []),
        ...(keys.length > 0 ? [{ contactStatus: "needs_you", contactStatusReason: { in: keys } }] : []),
      ],
    },
    select: { id: true, clinicName: true },
    orderBy: { createdAt: "asc" },
  });
}

// The Settings → Email backfill: every lead the Email queue holds — not run
// yet, finding, or needing you.
export async function finderQueueLeads(): Promise<{ id: string; clinicName: string }[]> {
  // The ones the finder has never run on: from before it existed ("Not run
  // yet"), or with no status at all. Leads that need you for a reason have
  // their own Retry.
  return prisma.lead.findMany({
    where: { ...FINDER_LEAD_WHERE, OR: [{ contactStatus: null }, { contactStatus: "needs_you", contactStatusReason: NOT_RUN_YET }] },
    select: { id: true, clinicName: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function findingCount(): Promise<number> {
  return prisma.lead.count({ where: { ...FINDER_LEAD_WHERE, contactStatus: "finding" } });
}
