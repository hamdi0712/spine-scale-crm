"use client";

// Clinic-First Discovery — the panel that configures a search, runs it, and
// shows what it found before anything is written.
//
// It is the same two-beat shape as the Apify import: run, look, confirm. What
// it does not have is a mapping step, and that is the point — a clinic-first
// result is normalised on the server (src/lib/clinicDiscovery.ts) by matching
// whatever the actor called its fields against the names actors actually use,
// so the thing on screen is already a clinic rather than a table of columns.
//
// Nothing here invents a decision-maker. A clinic with nobody named says "Not
// found", in those words, and is imported that way: it will be scored on the
// clinic's own evidence and will wait for a person rather than being promoted
// with a blank one.

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  CLINIC_HEADCOUNT_RANGES,
  ClinicCandidate,
  ClinicHeadcountRange,
  DEFAULT_CLINIC_SEARCH_LOCATION,
  DEFAULT_CLINIC_SEARCH_TERMS,
  DEFAULT_RESULTS_PER_TERM,
  MAX_CLINIC_SEARCH_TERMS,
  MAX_RESULTS_PER_TERM,
} from "@/lib/clinicDiscovery";
import {
  ClinicImportSummary,
  ClinicSearchResult,
  importClinicDiscoveryCandidates,
  runClinicDiscoverySearch,
} from "@/lib/actions/clinicDiscovery";
import { ApifySearchLogRow, searchStatus } from "@/lib/apifySearchLog";
import { clinicKeywordStatuses } from "@/lib/actions/apifySearchLog";
import { SearchUsageBadge } from "@/components/Badge";
import { normalizeApifyId } from "@/lib/apifyId";
import { EMAIL_TYPE_LABELS, pickMapsEmails } from "@/lib/emailFind";
import { MAX_BATCH_LABEL_LENGTH, defaultBatchLabel } from "@/lib/discoveryBatch";
import {
  PipelineSettings,
  estimateSentence,
  fmtEstimate,
  mapsContactsCost,
} from "@/lib/pipelineSettings";

export default function ClinicDiscoveryPanel({
  enabled,
  actorId,
  settings,
  termStatuses,
}: {
  // Whether the pathway is on at all, and the actor it would run — both read
  // from Pipeline Settings on the server. The panel says so rather than
  // offering a button that always fails.
  enabled: boolean;
  actorId: string;
  // Only for the cost estimate. Importing spends nothing; the chain these
  // describe runs later, at the queue.
  settings: PipelineSettings;
  // How worn each of the default terms is, read on the server so the pills are
  // there on first paint rather than appearing a moment later. Terms added
  // here are looked up as they are added; a term with no row is New.
  termStatuses: Record<string, ApifySearchLogRow>;
}) {
  const [terms, setTerms] = useState<string[]>(DEFAULT_CLINIC_SEARCH_TERMS);
  const [newTerm, setNewTerm] = useState("");
  const [location, setLocation] = useState(DEFAULT_CLINIC_SEARCH_LOCATION);
  const [headcount, setHeadcount] = useState<ClinicHeadcountRange | "">("");
  const [perTerm, setPerTerm] = useState(DEFAULT_RESULTS_PER_TERM);
  // Empty means "whatever Settings says". Typing here overrides the actor for
  // this run only and saves nothing.
  const [actorOverride, setActorOverride] = useState("");
  const [batch, setBatch] = useState<string | null>(null);

  // Keyed by the term exactly as it is typed — the lookup normalises on the
  // server, so "Spinal Decompression" finds the row "spinal decompression"
  // has been building up.
  const [statuses, setStatuses] =
    useState<Record<string, ApifySearchLogRow>>(termStatuses);

  const [result, setResult] = useState<ClinicSearchResult | null>(null);
  const [summary, setSummary] = useState<ClinicImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [importing, startImport] = useTransition();

  const actorInUse = actorOverride.trim() === "" ? actorId : actorOverride.trim();
  const actorMalformed =
    actorOverride.trim() !== "" && normalizeApifyId(actorOverride) === null;
  const batchDefault = defaultBatchLabel(new Date(), actorInUse);
  const batchLabel = batch ?? batchDefault;
  const found = result?.ok ? result.clinics : [];

  // Re-read the statuses for whatever terms are on screen. Called when the
  // set changes and again after a run, because a run is what moves them: nine
  // terms searched is nine counts one higher than they were a minute ago.
  const refreshStatuses = useCallback(async (list: string[]) => {
    try {
      setStatuses(await clinicKeywordStatuses(list));
    } catch {
      // A pill that cannot be read is a pill that is not drawn. Nothing about
      // the search depends on it.
    }
  }, []);

  useEffect(() => {
    void refreshStatuses(terms);
  }, [terms, refreshStatuses]);

  function addTerm() {
    const trimmed = newTerm.trim();
    if (trimmed === "") return;
    setTerms((prev) =>
      prev.some((t) => t.toLowerCase() === trimmed.toLowerCase()) ||
      prev.length >= MAX_CLINIC_SEARCH_TERMS
        ? prev
        : [...prev, trimmed],
    );
    setNewTerm("");
  }

  async function run() {
    // The search spends credit the moment it starts — the contact scraping
    // most of all — so it says what it will add before it does. window.confirm
    // rather than a dialog of its own, as everywhere else in the app.
    const places = terms.length * perTerm;
    if (
      !confirm(
        `Search ${terms.length} term${terms.length === 1 ? "" : "s"} × up to ${perTerm} result${perTerm === 1 ? "" : "s"}?\n\n` +
          `Contact scraping adds ${fmtEstimate(mapsContactsCost(terms.length, perTerm))} at most ` +
          `(${places} place${places === 1 ? "" : "s"}), on top of the search itself. ` +
          `Emails it finds are not verified here.`,
      )
    )
      return;
    setError(null);
    setSummary(null);
    setRunning(true);
    try {
      const res = await runClinicDiscoverySearch({
        config: {
          terms,
          location,
          headcount: headcount === "" ? null : headcount,
          resultsPerTerm: perTerm,
        },
        actorId: actorOverride.trim() === "" ? undefined : actorOverride.trim(),
      });
      setResult(res);
      if (!res.ok) setError(res.error);
    } catch {
      setResult(null);
      setError(
        "The search could not be run. Check the server's network connection and try again.",
      );
    } finally {
      setRunning(false);
      // Every term just ran, so every pill just moved.
      void refreshStatuses(terms);
    }
  }

  function importFound() {
    if (found.length === 0) return;
    startImport(async () => {
      const written = await importClinicDiscoveryCandidates({
        clinics: found,
        actorId: actorInUse,
        batchLabel,
      });
      setSummary(written);
      // What was just written is now stored, and re-importing it would only
      // find its own rows again. The results stay on screen to be read.
      setResult(null);
    });
  }

  return (
    <div className="space-y-8">
      {!enabled && (
        <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
          <p className="text-sm font-medium">Clinic-First Discovery is off</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            It runs an actor every time it searches, so it stays off until it is
            switched on and pointed at one.{" "}
            <Link href="/settings/pipeline" className="text-accent hover:underline">
              Turn it on under Settings → Pipeline
            </Link>
            , where its actor ID is set too.
          </p>
        </div>
      )}

      {/* ─── What to search for ────────────────────────────────────────── */}
      <section>
        <h2 className="display mb-1 text-xl font-semibold">Search terms</h2>
        <p className="helper-text mb-4 text-sm text-muted">
          One run per term. These are a starting set, not a rule — remove what
          is not working and add what is.
        </p>
        <div className="card p-6">
          <div className="flex flex-wrap gap-2">
            {terms.map((term) => {
              const logged = statuses[term];
              // No row means no runs, which is exactly what New means — so an
              // unlogged term wears the same pill a logged-but-never-run one
              // would, rather than wearing nothing.
              const { status, manual } = searchStatus(
                logged ?? { runCount: 0, manualStatusOverride: null },
              );
              return (
              <span
                key={term}
                className="inline-flex items-center gap-2 rounded-full border border-line/70 bg-wash/60 py-1 pl-3 pr-2 text-xs"
              >
                {term}
                <SearchUsageBadge
                  status={status}
                  manual={manual}
                  runCount={logged?.runCount ?? 0}
                />
                <button
                  type="button"
                  onClick={() => setTerms((prev) => prev.filter((t) => t !== term))}
                  aria-label={`Remove ${term}`}
                  className="text-muted hover:text-ink"
                >
                  ×
                </button>
              </span>
              );
            })}
            {terms.length === 0 && (
              <p className="text-xs text-muted">
                No terms — add at least one to run a search.
              </p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTerm();
                }
              }}
              placeholder="Add a term — “spinal decompression”"
              className="field w-full max-w-sm"
            />
            <button
              type="button"
              onClick={addTerm}
              disabled={terms.length >= MAX_CLINIC_SEARCH_TERMS}
              className="btn disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setTerms(DEFAULT_CLINIC_SEARCH_TERMS)}
              className="btn-ghost"
            >
              Reset to the defaults
            </button>
          </div>
        </div>
      </section>

      {/* ─── Where, how big, how many ───────────────────────────────────── */}
      <section>
        <h2 className="display mb-1 text-xl font-semibold">Where and how much</h2>
        <p className="helper-text mb-4 text-sm text-muted">
          The location every term is searched in, and the ceiling on what one
          run brings back
        </p>
        <div className="card grid gap-5 p-6 sm:grid-cols-2 max-sm:grid-cols-1">
          <div>
            <label className="field-label" htmlFor="clinicLocation">
              Location
            </label>
            <input
              id="clinicLocation"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="clinicHeadcount">
              Headcount (optional)
            </label>
            <select
              id="clinicHeadcount"
              value={headcount}
              onChange={(e) =>
                setHeadcount(e.target.value as ClinicHeadcountRange | "")
              }
              className="field"
            >
              <option value="">Any size</option>
              {CLINIC_HEADCOUNT_RANGES.map((range) => (
                <option key={range} value={range}>
                  {range} staff
                </option>
              ))}
            </select>
            <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
              Only some actors can filter on this. Where one cannot, it is
              ignored — the headcount is still read during enrichment and still
              scored.
            </p>
          </div>
          <div>
            <label className="field-label" htmlFor="clinicPerTerm">
              Results per term
            </label>
            <input
              id="clinicPerTerm"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_RESULTS_PER_TERM}
              value={perTerm}
              onChange={(e) => setPerTerm(Number(e.target.value))}
              className="field num w-[120px]"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="clinicActor">
              Actor for this run (optional)
            </label>
            <input
              id="clinicActor"
              value={actorOverride}
              onChange={(e) => setActorOverride(e.target.value)}
              placeholder={actorId}
              className="field font-mono text-xs"
            />
            {/* The malformed-ID error stays on a phone; the hint does not. */}
            <p className={`${actorMalformed ? "" : "helper-text "}mt-1 text-xs leading-relaxed text-muted`}>
              {actorMalformed
                ? "That does not look like an actor ID. Use the 17-character ID or the username~name form."
                : `Leave blank to run ${actorId}, from Settings → Pipeline. Anything typed here is used for this run only and is not saved.`}
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={!enabled || running || terms.length === 0 || actorMalformed}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Searching…" : `Search ${terms.length} term${terms.length === 1 ? "" : "s"}`}
        </button>
        <p className="helper-text text-xs leading-relaxed text-muted">
          One actor run per term, on the server, while you wait. Nothing is
          written until the results below are imported.
        </p>
      </div>

      {error && (
        <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
          <p className="text-sm font-medium text-bad">The search stopped</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{error}</p>
        </div>
      )}

      {summary && <ImportSummaryCard summary={summary} />}

      {result?.ok && (
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="display text-xl font-semibold">
                {result.clinics.length} clinic
                {result.clinics.length === 1 ? "" : "s"} found
              </h2>
              <p className="helper-text mt-1 text-sm text-muted">
                Nothing is written yet. Clinics already in Discovery are merged
                into what is there rather than added again.
              </p>
            </div>
            <p className="num text-xs text-muted">
              {estimateSentence(result.clinics.length, settings)} to run the
              queue on these
            </p>
          </div>

          {/* What each term brought back, including the ones that brought back
              nothing or failed — a term that 404'd should say so rather than
              vanishing into the total. */}
          <ul className="card mb-4 divide-y divide-line/60 text-xs">
            {result.perTerm.map((t) => (
              <li key={t.term} className="flex flex-wrap gap-2 px-4 py-2">
                <span className="font-medium">{t.term}</span>
                <span className="num ml-auto text-muted">
                  {t.error ? t.error : `${t.found} found`}
                </span>
              </li>
            ))}
          </ul>

          {result.clinics.length > 0 && (
            <>
              <div className="card mb-4 overflow-x-auto">
                <table className="m-cards w-full">
                  <thead>
                    <tr>
                      <th className="th">Clinic</th>
                      <th className="th">Website</th>
                      <th className="th">Location</th>
                      <th className="th">Email</th>
                      <th className="th">Decision maker</th>
                      <th className="th">Term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.clinics.map((clinic, i) => (
                      <tr key={`${clinic.clinicName}-${i}`}>
                        <td data-m="primary" className="td font-medium">{clinic.clinicName}</td>
                        <td data-label="Website" className="td max-w-[220px] truncate text-muted">
                          {clinic.websiteUrl ?? (
                            <span className="text-muted/70">
                              Not found — enrichment will look
                            </span>
                          )}
                        </td>
                        <td data-label="Location" className="td text-muted">{clinic.location ?? "—"}</td>
                        <td data-label="Email" className="td max-w-[220px] truncate text-muted">
                          <EmailCell clinic={clinic} />
                        </td>
                        <td data-label="Decision maker" className="td text-muted">
                          {clinic.contactName ?? (
                            <span className="text-muted/70">Not found</span>
                          )}
                        </td>
                        <td data-label="Term" className="td text-xs text-muted">
                          {clinic.sourceQuery}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card flex flex-wrap items-end gap-4 p-6">
                <div className="min-w-0 flex-1">
                  <label className="field-label" htmlFor="clinicBatch">
                    Batch label
                  </label>
                  <input
                    id="clinicBatch"
                    value={batchLabel}
                    maxLength={MAX_BATCH_LABEL_LENGTH}
                    onChange={(e) => setBatch(e.target.value)}
                    className="field"
                  />
                </div>
                <button
                  type="button"
                  onClick={importFound}
                  disabled={importing}
                  className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing
                    ? "Importing…"
                    : `Import ${result.clinics.length} clinic${result.clinics.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// What the import actually did, stated in full: created, merged into a
// candidate that was already there, and skipped because that clinic is already
// a lead in the pipeline.
function ImportSummaryCard({ summary }: { summary: ClinicImportSummary }) {
  return (
    <div className="rounded-[10px] border border-ok/30 bg-ok-soft/60 px-4 py-3">
      <p className="num text-sm font-medium">
        {summary.created === 0
          ? "No new candidates created."
          : `Created ${summary.created} candidate${summary.created === 1 ? "" : "s"} — none of them scored yet.`}
      </p>
      <p className="num mt-0.5 text-xs leading-relaxed text-muted">
        {summary.merged} merged into a candidate already in Discovery ·{" "}
        {summary.skipped} skipped as already in the pipeline.
      </p>
      {summary.mergeNotes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
          {summary.mergeNotes.slice(0, 10).map((note, i) => (
            <li key={i}>{note}</li>
          ))}
          {summary.mergeNotes.length > 10 && (
            <li>…and {summary.mergeNotes.length - 10} more.</li>
          )}
        </ul>
      )}
    </div>
  );
}

// What the import will store as this clinic's email — the same pick the
// server makes, so a vendor address the search returned is not shown as if it
// were going to be kept.
function EmailCell({ clinic }: { clinic: ClinicCandidate }) {
  const { main, alternates } = pickMapsEmails(
    clinic.email ? [clinic.email, ...clinic.emails] : clinic.emails,
    clinic,
  );
  if (!main) return <span className="text-muted/70">None found</span>;
  return (
    <span title={[main, ...alternates].map((e) => e.address).join(", ")}>
      {main.address}{" "}
      <span className="text-muted/70">
        ({EMAIL_TYPE_LABELS[main.type].toLowerCase()}
        {alternates.length > 0 ? `, +${alternates.length}` : ""})
      </span>
    </span>
  );
}
