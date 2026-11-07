// Owner-finding — the run, for one lead at a time. Server-only, and not a
// "use server" module: the job (src/lib/actions/jobs.ts) and the lead page's
// action (src/lib/actions/ownerFind.ts) call it; the browser never does.
// The rules are src/lib/ownerFind.ts.
//
//   findOwner       the name: NPI Registry + the stored crawl. Free.
//   findOwnerEmail  the address: Hunter's Email Finder, then — only with
//                   Settings → Email's "Guess owner emails from patterns" on —
//                   the pattern or the guesses, each checked with Instantly
//                   before anything is saved.
//                   Spends from a budget the caller hands in, and stops
//                   the moment either runs out.
//
// Neither ever overwrites what somebody typed: an owner picked by hand is not
// looked up again, and a main email typed by hand stays the main email.

import { prisma } from "@/lib/prisma";
import { PIPELINE_DEFAULT_WHERE, FIND_EMAILS_WHERE } from "@/lib/liveLeadWhere";
import { clinicDomain, isMailboxProvider, parseAlternates, readDecisionMakerName } from "@/lib/emailFind";
import {
  ownerCostPerLead,
  NpiMatch,
  OwnerEmailCandidate,
  OwnerSource,
  addressFromPattern,
  decideOwner,
  guessAddresses,
  hasOwnerEmail,
  matchNpiOrganization,
  npiNameQueries,
  readOwnerSource,
  siteDoctorNames,
  stateFromLocation,
  withOwnerEmail,
} from "@/lib/ownerFind";
import { searchNpiOrganizations } from "@/lib/npiRegistry";
import { findEmail, searchDomain } from "@/lib/hunter";
import { checkAddress, checkReadiness } from "@/lib/emailCheckRun";
import { monthStart } from "@/lib/emailCheck";
import { getHunterApiKey } from "@/lib/appSecretsStore";
import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { defaultEmailVersion, renderEmail } from "@/lib/emailWorkflow";
import { hasUsableEmail } from "@/lib/emailBuckets";
import { ownerEmailBlocker } from "@/lib/ownerFind";
export { ownerEmailBlocker } from "@/lib/ownerFind";

// ─── Credits ───────────────────────────────────────────────────────────────

export async function hunterCreditsUsedThisMonth(now = new Date()): Promise<number> {
  const r = await prisma.hunterCall.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { creditsUsed: true } });
  return r._sum.creditsUsed ?? 0;
}

// What a job of n leads could cost at most, and whether that fits what is
// left of both budgets this month.
export async function ownerReadiness(n: number, now = new Date()) {
  const [hunterKey, settings, hunterUsed, instantly] = await Promise.all([
    getHunterApiKey(),
    loadEmailSettings(),
    hunterCreditsUsedThisMonth(now),
    loadEmailSettings().then((s) => checkReadiness(n * ownerCostPerLead(s.guessOwnerPatterns).instantly, now)),
  ]);
  const cost = ownerCostPerLead(settings.guessOwnerPatterns);
  const hunterLeft = Math.max(0, settings.hunterCreditBudget - hunterUsed);
  const hunterNeeded = n * cost.hunter;
  const perLeadInstantly = cost.instantly * settings.creditsPerCheck;
  const affordable = Math.min(
    Math.floor(hunterLeft / cost.hunter + 1e-9),
    Math.floor(instantly.left / perLeadInstantly + 1e-9),
  );
  return {
    hasHunterKey: hunterKey !== null,
    hasInstantlyKey: instantly.hasKey,
    hunter: { used: hunterUsed, budget: settings.hunterCreditBudget, left: hunterLeft, needed: hunterNeeded, fits: hunterNeeded <= hunterLeft },
    instantly: { used: instantly.used, budget: settings.checkCreditBudget, left: instantly.left, needed: instantly.needed, fits: instantly.fits },
    perCheck: settings.creditsPerCheck,
    guess: settings.guessOwnerPatterns,
    fits: hunterNeeded <= hunterLeft && instantly.fits,
    affordable: Math.max(0, affordable),
  };
}

// What one job may still spend, drawn down as it goes. Shared by every lead
// in the run, so the run as a whole never passes the budget.
export interface OwnerBudget {
  hunterLeft: number;
  instantlyLeft: number;
  perCheck: number;
  // Settings → Email's "Guess owner emails from patterns".
  guess: boolean;
  hunterSpent: number;
  instantlySpent: number;
}

export async function ownerBudget(): Promise<OwnerBudget> {
  const r = await ownerReadiness(0);
  return { hunterLeft: r.hunter.left, instantlyLeft: r.instantly.left, perCheck: r.perCheck, guess: r.guess, hunterSpent: 0, instantlySpent: 0 };
}

// ─── Which leads ───────────────────────────────────────────────────────────

const OWNER_LEAD_WHERE = {
  ...FIND_EMAILS_WHERE,
  channel: "email",
  suppressedAt: null,
  emailUnsubscribedAt: null,
  ownerEmailAt: null,
} as const;

// Email leads Find owners would work on: no owner address yet, the email
// step not run, and either the name not looked up or the owner confirmed.
// (A lead waiting on a pick is left until it is picked.)
export async function findOwnerLeads(opts: { onlyNew?: boolean; includePipeline?: boolean } = {}): Promise<{ id: string; clinicName: string }[]> {
  const rows = await prisma.lead.findMany({
    where: opts.onlyNew ? { ...OWNER_LEAD_WHERE, ownerCheckedAt: null } : { ...OWNER_LEAD_WHERE, OR: [{ ownerCheckedAt: null }, { ownerStatus: "confirmed" }] },
    select: { id: true, clinicName: true, email: true, emailType: true, emailAlternates: true, emailStatus: true, ownerStatus: true },
    orderBy: { updatedAt: "asc" },
  });
  // Only the Email queue: a confirmed owner with a valid or risky address is
  // in the Email pipeline already (src/lib/emailBuckets.ts). A run for named
  // leads (a hand pick, a lead's own button) still looks for the owner's own
  // address on those.
  return rows
    .filter((r) => opts.includePipeline || !(r.ownerStatus === "confirmed" && hasUsableEmail(r)))
    .filter((r) => !hasOwnerEmail(r)).map((r) => ({ id: r.id, clinicName: r.clinicName }));
}

// ─── 1. The name ───────────────────────────────────────────────────────────

export type OwnerNameOutcome =
  | { kind: "confirmed"; name: string; source: OwnerSource; detail: string }
  | { kind: "pick"; choices: string[]; detail: string }
  | { kind: "not_found"; detail: string }
  | { kind: "skipped"; detail: string }
  | { kind: "failed"; detail: string };

export async function findOwner(leadId: string, opts: { force?: boolean } = {}): Promise<OwnerNameOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { kind: "skipped", detail: "No longer here." };
  if (readOwnerSource(lead.ownerSource) === "manual" && lead.ownerStatus === "confirmed") {
    return { kind: "confirmed", name: lead.contactName ?? "", source: "manual", detail: `${lead.contactName} — picked by hand` };
  }
  if (lead.ownerCheckedAt && !opts.force) {
    if (lead.ownerStatus === "confirmed") return { kind: "confirmed", name: lead.contactName ?? "", source: readOwnerSource(lead.ownerSource) ?? "npi", detail: `${lead.contactName} — confirmed earlier` };
    return { kind: "skipped", detail: "Already looked up." };
  }

  // The registry, by name, in the lead's state; a record counts only when
  // its phone or its town confirms it.
  const state = stateFromLocation(lead.location);
  let match: NpiMatch | null = null;
  for (const q of npiNameQueries(lead.clinicName)) {
    const r = await searchNpiOrganizations(q, state);
    if (!r.ok) return { kind: "failed", detail: r.error };
    match = matchNpiOrganization(lead, r.results);
    if (match) break;
  }

  const siteNames = siteDoctorNames(lead.websiteNotes, lead.websiteLinks);
  const decision = decideOwner(match, siteNames);
  const now = new Date();
  const npi = match
    ? { npiNumber: match.org.number, npiOfficialName: decision.official, npiOfficialTitle: match.org.official.title }
    : { npiNumber: null, npiOfficialName: null, npiOfficialTitle: null };

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      ...npi,
      ownerStatus: decision.status,
      ownerSource: decision.source,
      ownerSiteNames: decision.choices.length > 0 ? JSON.stringify(decision.choices) : siteNames.length > 0 ? JSON.stringify(siteNames) : null,
      ownerCheckedAt: now,
    },
  });
  if (decision.status === "confirmed" && decision.name) {
    const title = decision.source !== "site" && match && decision.officialIsDecisionMaker ? match.org.official.title : null;
    await setOwnerAsContact(leadId, decision.name, title);
    return { kind: "confirmed", name: decision.name, source: decision.source!, detail: decision.detail };
  }
  if (decision.status === "pick") return { kind: "pick", choices: decision.choices, detail: decision.detail };
  return { kind: "not_found", detail: decision.detail };
}

// The confirmed owner becomes the lead's contact — the person the owner email
// greets and the front-desk email asks to be passed to — and the contact
// check is settled. An unsent drafted email is rebuilt around them, and a
// lead already in sequence keeps the contact it was sent to.
export async function setOwnerAsContact(leadId: string, name: string, title: string | null): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { emailSends: { select: { id: true } } } });
  if (!lead || lead.emailSends.length > 0) return;
  const updated = { ...lead, contactName: name, contactTitle: title ?? lead.contactTitle };
  const settings = lead.emailOpener ? await loadEmailSettings() : null;
  const email = settings && lead.emailOpener ? renderEmail(settings, updated, defaultEmailVersion(lead), lead.emailOpener) : null;
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      contactName: name,
      ...(title ? { contactTitle: title } : {}),
      contactConfirmedAt: new Date(),
      ...(email && (email.subject !== lead.emailSubject || email.body !== lead.emailBody)
        ? { emailSubject: email.subject, emailBody: email.body, emailApprovedAt: null }
        : {}),
    },
  });
}

// A pick between the names shown: the chosen one becomes the confirmed owner.
// The lead goes back to "not looked up yet" (both markers cleared), so if the
// automatic lookup that follows does not finish, the next Find owners run
// covers it. The hand-picked owner is kept: findOwner never replaces one.
export async function pickOwner(leadId: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { ownerSiteNames: true, npiOfficialName: true } });
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const choices = new Set([...parsePickNames(lead.ownerSiteNames), ...(lead.npiOfficialName ? [lead.npiOfficialName] : [])]);
  const chosen = name.trim();
  if (!choices.has(chosen)) return { ok: false, error: "Pick one of the names shown." };
  await prisma.lead.update({ where: { id: leadId }, data: { ownerStatus: "confirmed", ownerSource: "manual", ownerCheckedAt: null, ownerEmailAt: null } });
  await setOwnerAsContact(leadId, chosen, null);
  await prisma.lead.update({ where: { id: leadId }, data: { contactNameByHand: true } });
  return { ok: true };
}

function parsePickNames(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ─── 2. The address ────────────────────────────────────────────────────────

export type OwnerEmailOutcome =
  | { kind: "found"; email: string; status: string; source: "hunter" | "hunter_inferred" | "pattern_guess"; placed: "main" | "alternate"; detail: string }
  // Tried, and every address came back invalid (kept as invalid alternates).
  | { kind: "invalid"; detail: string }
  | { kind: "none"; detail: string }
  | { kind: "skipped"; detail: string; budget?: boolean }
  | { kind: "failed"; detail: string; stop?: boolean };

// Reasons a lead's email step can never run, whatever is retried: marked
// done (ownerEmailAt) so the lead stops counting toward Find owners. The rule
// itself (ownerEmailBlocker) is in src/lib/ownerFind.ts, which the queue reads
// too.
const PERMANENT = /domain|can't be guessed|too short/;

async function logHunter(leadId: string, endpoint: string, domain: string, result: string | null, credits: number, budget: OwnerBudget) {
  await prisma.hunterCall.create({ data: { leadId, endpoint, domain, result, creditsUsed: credits } });
  budget.hunterLeft -= credits;
  budget.hunterSpent += credits;
}

export async function findOwnerEmail(leadId: string, budget: OwnerBudget): Promise<OwnerEmailOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { kind: "skipped", detail: "No longer here." };
  const blocked = ownerEmailBlocker(lead);
  if (blocked) {
    if (PERMANENT.test(blocked)) await prisma.lead.update({ where: { id: leadId }, data: { ownerEmailAt: new Date() } });
    return { kind: "skipped", detail: blocked };
  }
  const domain = clinicDomain(lead.websiteUrl)!;
  const person = readDecisionMakerName(lead.contactName)!;

  const tried: OwnerEmailCandidate[] = [];
  const instantly = async (address: string) => {
    if (budget.instantlyLeft + 1e-9 < budget.perCheck) return null;
    const r = await checkAddress(leadId, address);
    if (r.ok) {
      budget.instantlyLeft -= r.credits;
      budget.instantlySpent += r.credits;
    }
    return r;
  };
  const outOfBudget = (which: string): OwnerEmailOutcome => ({ kind: "skipped", detail: `This month's ${which} budget ran out before this lead — nothing saved.`, budget: true });

  // ─── Hunter's Email Finder ───────────────────────────────────────────────
  if (person.first) {
    if (budget.hunterLeft < 1) return outOfBudget("Hunter");
    const f = await findEmail(domain, person.first, person.last!);
    if (!f.ok) return { kind: "failed", detail: f.error, stop: f.code === "auth" || f.code === "no_key" || f.code === "quota" };
    await logHunter(leadId, "email-finder", domain, f.email, f.creditsUsed, budget);
    if (f.email && f.email.endsWith(`@${domain}`)) {
      const c = await instantly(f.email);
      if (c === null) return outOfBudget("Instantly");
      if (!c.ok) return { kind: "failed", detail: c.error, stop: c.code === "auth" || c.code === "plan" || c.code === "no_key" };
      const candidate: OwnerEmailCandidate = { address: f.email, status: c.status, source: f.provenance === "found" ? "hunter" : "hunter_inferred", found: f.provenance === "found" };
      if (c.status !== "invalid") return save(leadId, candidate, [], `Hunter (${f.provenance})`);
      tried.push(candidate);
    }
  }

  // ─── The pattern, or the guesses — only when switched on ─────────────────
  if (!budget.guess) {
    await recordTried(leadId, tried);
    if (tried.length > 0) return { kind: "invalid", detail: `${tried[0].address} (Hunter) — invalid; guessing is off` };
    return { kind: "none", detail: person.first ? "Hunter's Email Finder has no address for the owner; guessing is off." : "Only the owner's last name is known, and guessing is off." };
  }
  if (budget.hunterLeft < 1) return outOfBudget("Hunter");
  const d = await searchDomain(domain);
  if (!d.ok) return { kind: "failed", detail: d.error, stop: d.code === "auth" || d.code === "no_key" || d.code === "quota" };
  await logHunter(leadId, "domain-search", domain, d.pattern, d.creditsUsed, budget);

  const fromPattern = d.pattern ? addressFromPattern(d.pattern, person, domain) : null;
  const guesses = (fromPattern ? [fromPattern] : guessAddresses(person, domain)).filter((a) => !tried.some((t) => t.address === a));
  for (const address of guesses) {
    const c = await instantly(address);
    if (c === null) {
      if (tried.length > 0) break;
      return outOfBudget("Instantly");
    }
    if (!c.ok) return { kind: "failed", detail: c.error, stop: c.code === "auth" || c.code === "plan" || c.code === "no_key" };
    const candidate: OwnerEmailCandidate = { address, status: c.status, source: "pattern_guess", found: false };
    // valid: the first good one. risky: a catch-all domain accepts every
    // guess alike, so the rest would prove nothing either.
    if (c.status === "valid" || c.status === "risky") return save(leadId, candidate, tried, fromPattern ? `pattern ${d.pattern}` : "guess");
    tried.push(candidate);
  }

  const detailTried = tried.map((t) => t.address).join(", ");
  await recordTried(leadId, tried);
  if (tried.length > 0) return { kind: "invalid", detail: `${detailTried} — invalid${tried.length === 1 ? "" : ", every one"}` };
  return { kind: "none", detail: d.pattern ? `Hunter's pattern ${d.pattern} doesn't fit the owner's name.` : "Nothing to try." };
}

// The good address onto the lead (main or risky alternate), with every
// invalid one tried kept as an alternate so it is never offered again. Only
// lands if the lead's email is still what it was when the run read it.
async function save(leadId: string, c: OwnerEmailCandidate, tried: OwnerEmailCandidate[], how: string): Promise<OwnerEmailOutcome> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  let base = lead.emailAlternates;
  for (const t of tried) base = withOwnerEmail({ ...lead, emailAlternates: base }, t).fields.emailAlternates;
  const { placed, fields } = withOwnerEmail({ ...lead, emailAlternates: base }, c);
  const now = new Date();
  const { count } = await prisma.lead.updateMany({
    where: { id: leadId, email: lead.email },
    data: {
      ...fields,
      ownerEmailAt: now,
      ...(placed === "main" ? { emailCheckedAt: now, emailApprovedAt: null, ...(lead.emailVersion === "front_desk" ? { emailVersion: null } : {}) } : {}),
    },
  });
  if (count === 0) return { kind: "skipped", detail: "The lead's email changed while this ran — nothing saved." };
  if (placed === "main") await rebuildDraft(leadId);
  const where = placed === "main" ? "now the main email" : c.status === "valid" ? "kept as an alternate (the main email was typed by hand)" : "kept as a risky alternate — the domain accepts every address, so it can't be confirmed";
  return { kind: "found", email: c.address, status: c.status, source: c.source, placed, detail: `${c.address} (${how}) — ${c.status}, ${where}` };
}

async function recordTried(leadId: string, tried: OwnerEmailCandidate[]): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  let alternates = lead.emailAlternates;
  for (const t of tried) alternates = withOwnerEmail({ ...lead, emailAlternates: alternates }, t).fields.emailAlternates;
  await prisma.lead.update({ where: { id: leadId }, data: { emailAlternates: alternates, ownerEmailAt: new Date() } });
}

// The owner's address is the main email now: an unsent draft written for the
// front desk is rebuilt as the owner-direct version.
export async function rebuildDraft(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { emailSends: { select: { id: true } } } });
  if (!lead || !lead.emailOpener || lead.emailSends.length > 0) return;
  const settings = await loadEmailSettings();
  const email = renderEmail(settings, lead, defaultEmailVersion(lead), lead.emailOpener);
  // Unchanged copy keeps its approval.
  if (email.subject === lead.emailSubject && email.body === lead.emailBody) return;
  await prisma.lead.update({ where: { id: leadId }, data: { emailSubject: email.subject, emailBody: email.body, emailApprovedAt: null } });
}
