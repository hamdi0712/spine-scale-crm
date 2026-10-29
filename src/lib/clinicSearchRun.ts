// One Clinic-first search term, run on Apify and read into clinics.
//
// Server-only and not a "use server" module, on the same terms as
// src/lib/websiteCrawlRun.ts: the job in src/lib/actions/jobs.ts calls it once
// per term, and the browser never reaches it on its own.
//
// It starts the run and checks on it until it ends (runApifyActor) rather than
// holding one request open. With contact scraping on, the Maps crawler visits
// every place's website, and a term routinely takes longer than the two
// minutes the one-call run allowed — which timed out and threw away every
// place it had already found. The actor now gets fifteen minutes of its own,
// and a run that still hits that limit keeps what it collected.

import { fmtSeconds, runApifyActor } from "@/lib/apify";
import {
  ClinicCandidate,
  ClinicSearchConfig,
  ClinicTermResult,
  clinicSearchInput,
  normalizeClinicRow,
} from "@/lib/clinicDiscovery";
import { recordApifySearchRun } from "@/lib/actions/apifySearchLog";

// The actor's own time limit on Apify for one term. This server keeps
// checking on the run until it ends, so this is also how long one term can
// take.
export const CLINIC_SEARCH_RUN_TIMEOUT_SECONDS = 15 * 60;

export async function runClinicSearchTerm(
  term: string,
  config: ClinicSearchConfig,
  actorId: string,
): Promise<ClinicTermResult> {
  // One term, one run, one count — a term whose actor fails still cost a
  // call and still counts as having been tried. A count that cannot be
  // written (this runs after the action that started it has answered) is
  // not a reason to skip the search. Logged as email: what this search finds
  // lands in Email Discovery.
  await recordApifySearchRun({ type: "CLINIC_KEYWORD", raw: term, channel: "email" }).catch(() => {});

  const result = await runApifyActor({
    kind: "actor",
    id: actorId,
    input: JSON.stringify(clinicSearchInput(term, config)),
    maxItems: config.resultsPerTerm,
    runTimeoutSeconds: CLINIC_SEARCH_RUN_TIMEOUT_SECONDS,
  });
  if (!result.ok) {
    return { term, actorId, clinics: [], timedOut: result.code === "timeout", ranSeconds: result.ranSeconds ?? null, error: result.error };
  }

  const clinics: ClinicCandidate[] = [];
  for (const cells of result.rows) {
    // No name, no candidate — and no invention of one.
    const clinic = normalizeClinicRow({ headers: result.headers, cells }, term);
    if (clinic) clinics.push(clinic);
  }
  return { term, actorId, clinics, timedOut: result.timedOut, ranSeconds: result.ranSeconds, error: null };
}

// The one line the progress panel shows for a term.
export function clinicTermLine(r: ClinicTermResult): { outcome: "ok" | "warn" | "error"; detail: string } {
  const n = `${r.clinics.length} clinic${r.clinics.length === 1 ? "" : "s"}`;
  if (r.error) return { outcome: "error", detail: r.error };
  if (r.timedOut) {
    return {
      outcome: "warn",
      detail: `Timed out on Apify after ${fmtSeconds(r.ranSeconds ?? CLINIC_SEARCH_RUN_TIMEOUT_SECONDS)} — kept the ${n} it collected`,
    };
  }
  return { outcome: "ok", detail: `${n} found` };
}
