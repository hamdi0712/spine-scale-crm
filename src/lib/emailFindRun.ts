// Find emails for one lead — the actor calls and the write. Every decision
// the run makes is in src/lib/emailFind.ts; this file is the order they are
// made in and what each one spends.
//
// Server-only, and not a "use server" module: it is the job runner's per-item
// function (src/lib/actions/jobs.ts), not an endpoint.
//
// The order, cheapest first, stopping at the first valid owner address:
//
//   1. A manual address: skipped, nothing read or written.
//   2. An imported address: verified. Valid, it stays and the lead is done —
//      nothing found later could replace it. Invalid, it moves to the
//      alternates and the lead is searched as if it had none.
//   3. The stored crawl, for free. The extractor actor only if that found
//      nothing on the clinic's domain or a mailbox provider.
//   4. Each found address verified, ones carrying the decision-maker's name
//      first. Once a generic one is valid, further generic ones are not sent.
//   5. No valid owner yet and a decision-maker named: first@, firstlast@,
//      first.last@, drlast@ on the clinic's domain, one verification each,
//      stopping at the first valid. None at all on a catch-all domain — and a
//      guess that reveals the domain is catch-all ends the guessing.
//
// Nothing is written unless the lead's address is still not manual at the
// moment of writing: an address typed into the lead form while the run was
// in flight wins.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { APIFY_MIN_CHARGE_USD, runApifySync } from "@/lib/apify";
import { PipelineSettings } from "@/lib/pipelineSettings";
import {
  EmailCandidate,
  EmailStatus,
  EXTRACTOR_MAX_PAGES,
  FindOutcome,
  MAX_FOUND_VERIFIED,
  VERIFIER_USD_PER_ADDRESS,
  belongsToClinic,
  chooseEmail,
  classifyAddress,
  clinicDomain,
  decisionMakerFor,
  effectiveEmailSource,
  emailsFromStoredCrawl,
  extractEmails,
  extractorCost,
  leadCeilingUsd,
  namePatternGuesses,
  outcomeFor,
  readVerdict,
  rowForAddress,
} from "@/lib/emailFind";

export const FIND_EMAIL_LEAD_SELECT = {
  id: true,
  clinicName: true,
  email: true,
  emailSource: true,
  websiteUrl: true,
  websiteNotes: true,
  websiteLinks: true,
  contactName: true,
  icpBreakdown: true,
} as const;

type FindLead = {
  id: string;
  clinicName: string;
  email: string | null;
  emailSource: string | null;
  websiteUrl: string | null;
  websiteNotes: string | null;
  websiteLinks: string | null;
  contactName: string | null;
  icpBreakdown: string | null;
};

// ─── The plan, for the estimate ────────────────────────────────────────────

export interface FindPlan {
  skip: boolean; // manual
  imported: boolean;
  found: number; // usable addresses in the stored crawl
  needsExtractor: boolean;
  guesses: number;
  ceilingUsd: number;
}

// What the run would do on this lead, worked out from what is stored, so the
// confirm dialog can say how many leads need the paid extractor before
// anybody presses anything.
export function planLead(lead: FindLead, settings: PipelineSettings): FindPlan {
  const source = effectiveEmailSource(lead);
  if (source === "manual") {
    return { skip: true, imported: false, found: 0, needsExtractor: false, guesses: 0, ceilingUsd: 0 };
  }
  const domain = clinicDomain(lead.websiteUrl);
  const imported = source === "imported" && (lead.email ?? "").trim() !== "";
  const found = emailsFromStoredCrawl(lead.websiteNotes, lead.websiteLinks).filter((a) => belongsToClinic(a, domain)).length;
  const needsExtractor = found === 0 && domain !== null && settings.emailExtractor.enabled;
  const person = decisionMakerFor(lead);
  const guesses = person && domain ? namePatternGuesses(person, domain).length : 0;
  return {
    skip: false,
    imported,
    found,
    needsExtractor,
    guesses,
    ceilingUsd: leadCeilingUsd({ imported, found, needsExtractor, guesses }),
  };
}

// ─── One lead ──────────────────────────────────────────────────────────────

export type FindEmailsResult =
  | {
      ok: true;
      clinicName: string;
      outcome: FindOutcome;
      primary: EmailCandidate | null;
      alternates: EmailCandidate[];
      // The steps it took, for the activity line: "crawl 2 · verified 3 · catch-all".
      steps: string[];
      spentUsd: number;
      // An imported address kept in the field while a better one went to the
      // alternates — worth saying in the line.
      betterInAlternates: boolean;
    }
  | { ok: false; clinicName: string; error: string; capacity?: boolean; spentUsd: number };

class VerifyFailed extends Error {
  constructor(
    message: string,
    readonly capacity: boolean,
  ) {
    super(message);
  }
}

export async function findEmailsForLead(id: string, settings: PipelineSettings): Promise<FindEmailsResult> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: FIND_EMAIL_LEAD_SELECT });
  if (!lead) return { ok: false, clinicName: "That lead", error: "No longer here.", spentUsd: 0 };
  const name = lead.clinicName;

  const source = effectiveEmailSource(lead);
  if (source === "manual") {
    return {
      ok: true,
      clinicName: name,
      outcome: "skipped_manual",
      primary: null,
      alternates: [],
      steps: ["entered by hand — left alone"],
      spentUsd: 0,
      betterInAlternates: false,
    };
  }
  if (!settings.emailVerifier.enabled) {
    return { ok: false, clinicName: name, error: "The email verifier is off in Settings → Pipeline.", spentUsd: 0 };
  }

  const domain = clinicDomain(lead.websiteUrl);
  const person = decisionMakerFor(lead);
  const steps: string[] = [];
  let spent = 0;
  const candidates: EmailCandidate[] = [];
  const catchAllDomains = new Set<string>();
  const has = (address: string) => candidates.some((c) => c.address.toLowerCase() === address.toLowerCase());

  async function verify(c: EmailCandidate): Promise<EmailStatus> {
    const r = await runApifySync({
      kind: "actor",
      id: settings.emailVerifier.actorId,
      input: JSON.stringify({ emails: [c.address] }),
      maxItems: 5,
      maxTotalChargeUsd: APIFY_MIN_CHARGE_USD,
    });
    spent += VERIFIER_USD_PER_ADDRESS;
    if (!r.ok) {
      const capacity = /limit for runs at once or memory/i.test(r.error);
      throw new VerifyFailed(`Verifier: ${r.error}`, capacity);
    }
    const row = rowForAddress(r.headers, r.rows, c.address);
    const verdict = row ? readVerdict(r.headers, row) : { status: "unknown" as const, catchAll: false };
    c.status = verdict.status;
    if (verdict.catchAll) catchAllDomains.add(c.address.slice(c.address.indexOf("@") + 1));
    return verdict.status;
  }

  const validOwner = () => candidates.some((c) => c.status === "valid" && c.type === "owner");
  const validGeneric = () => candidates.some((c) => c.status === "valid" && c.type === "generic");

  try {
    // 2. The imported address.
    // Kept exactly as it was written: never replaced means not re-cased either.
    const importedAddress = source === "imported" ? (lead.email ?? "").trim() : "";
    if (importedAddress !== "") {
      const c: EmailCandidate = {
        address: importedAddress,
        type: classifyAddress(importedAddress.toLowerCase(), person),
        status: null,
        source: "imported",
      };
      candidates.push(c);
      const status = await verify(c);
      steps.push(`imported ${status}`);
    }
    const importedKept = candidates.find((c) => c.source === "imported" && c.status === "valid");

    if (!importedKept) {
      // 3. The stored crawl, then the extractor.
      let found = emailsFromStoredCrawl(lead.websiteNotes, lead.websiteLinks).filter(
        (a) => belongsToClinic(a, domain) && !has(a),
      );
      let foundSource: EmailCandidate["source"] = "site_crawl";
      if (found.length > 0) steps.push(`crawl ${found.length}`);
      else if (domain && settings.emailExtractor.enabled && lead.websiteUrl) {
        const r = await runApifySync({
          kind: "actor",
          id: settings.emailExtractor.actorId,
          input: JSON.stringify({
            startUrls: [{ url: /^https?:\/\//i.test(lead.websiteUrl.trim()) ? lead.websiteUrl.trim() : `https://${lead.websiteUrl.trim()}` }],
            maxDepth: 1,
            maxRequestsPerStartUrl: EXTRACTOR_MAX_PAGES,
            sameDomain: true,
          }),
          maxItems: EXTRACTOR_MAX_PAGES,
          maxTotalChargeUsd: APIFY_MIN_CHARGE_USD,
        });
        spent += extractorCost();
        if (!r.ok) {
          // An empty dataset is the extractor finding nothing, not failing.
          if (/dataset is empty/i.test(r.error)) steps.push("extractor 0");
          else if (/limit for runs at once or memory/i.test(r.error)) throw new VerifyFailed(`Extractor: ${r.error}`, true);
          else steps.push("extractor failed");
        } else {
          // Every cell of every page read for addresses: the extractor's own
          // field for them is "emails" today, and a renamed field should not
          // lose them.
          found = extractEmails(r.rows.map((row) => row.join(" ")).join("\n")).filter(
            (a) => belongsToClinic(a, domain) && !has(a),
          );
          foundSource = "extractor";
          steps.push(`extractor ${found.length}`);
        }
      } else if (domain && !settings.emailExtractor.enabled) steps.push("crawl 0 · extractor off");
      else steps.push("crawl 0");

      // 4. Verify what was found, the decision-maker's own first.
      const typed = found
        .map((address) => ({ address, type: classifyAddress(address, person), status: null, source: foundSource }) as EmailCandidate)
        .sort((a, b) => (a.type === b.type ? 0 : a.type === "owner" ? -1 : 1));
      candidates.push(...typed);
      let sent = 0;
      for (const c of typed) {
        if (validOwner() || sent >= MAX_FOUND_VERIFIED) break;
        if (c.type === "generic" && validGeneric()) continue;
        await verify(c);
        sent++;
      }
      if (sent > 0) steps.push(`verified ${sent}`);

      // 5. Guess, unless the domain accepts everything.
      if (!validOwner() && person && domain) {
        if (catchAllDomains.has(domain)) steps.push("catch-all — no guesses");
        else {
          let tried = 0;
          for (const address of namePatternGuesses(person, domain)) {
            if (has(address)) continue;
            const c: EmailCandidate = { address, type: "owner", status: null, source: "name_pattern" };
            candidates.push(c);
            tried++;
            const status = await verify(c);
            if (status === "valid") break;
            if (catchAllDomains.has(domain)) {
              steps.push("catch-all");
              break;
            }
          }
          steps.push(`guessed ${tried}`);
        }
      }
    }
  } catch (err) {
    if (err instanceof VerifyFailed) {
      return { ok: false, clinicName: name, error: err.message, capacity: err.capacity, spentUsd: spent };
    }
    throw err;
  }

  const { primary, alternates } = chooseEmail(candidates);
  const outcome = outcomeFor(primary);
  const best = outcomeFor(chooseEmail(candidates.filter((c) => c.source !== "imported")).primary);
  const betterInAlternates =
    primary?.source === "imported" && primary.status !== "valid" && (best === "valid_owner" || best === "valid_generic");

  const written = await prisma.lead.updateMany({
    where: { id, OR: [{ emailSource: null }, { emailSource: { not: "manual" } }] },
    data: {
      email: primary?.address ?? null,
      emailType: primary?.type ?? "not_found",
      emailStatus: primary?.status ?? null,
      emailSource: primary?.source ?? null,
      emailCheckedAt: new Date(),
      emailAlternates: alternates.length > 0 ? JSON.stringify(alternates) : null,
    },
  });
  if (written.count === 0) {
    return {
      ok: true,
      clinicName: name,
      outcome: "skipped_manual",
      primary: null,
      alternates: [],
      steps: [...steps, "an address was typed in meanwhile — left alone"],
      spentUsd: spent,
      betterInAlternates: false,
    };
  }
  revalidatePath(`/pipeline/${id}`);
  return { ok: true, clinicName: name, outcome, primary, alternates, steps, spentUsd: spent, betterInAlternates };
}
