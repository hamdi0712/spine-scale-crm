"use client";

// Find Decision Maker — the one control for the stage that runs after a clinic
// has qualified.
//
// It shows three things and refuses to blur them together: who was found, what
// says so, and how much that is worth. A name with no evidence behind it is
// shown as exactly that, and a clinic where nobody was found says "Not found"
// in those words — never a blank row where a person would be, which reads as a
// name somebody forgot to type rather than a person nobody has found.
//
// The step list after a run is the procedure itself, in order: the name read
// off the clinic's website, the search run for that exact name, the profile it
// returned and what the verification made of it. It is written that way on
// purpose — a stage that spends money is one somebody should be able to follow
// press by press, and "found nobody" is only a useful answer next to which of
// those steps came up empty.
//
// The other findings stay on screen after a run. A search that turns up four
// people at a clinic has made a choice, and the choice is only defensible if
// the alternatives are visible and one press away.

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_MEANINGS,
  DECISION_MAKER_STATUS_LABELS,
  DECISION_MAKER_STATUS_MEANINGS,
  DecisionMakerAttempt,
  DecisionMakerCandidate,
  DecisionMakerConfidence,
  DecisionMakerStatus,
  EVIDENCE_SOURCE_LABELS,
} from "@/lib/decisionMaker";
import {
  FindDecisionMakerResult,
  findDecisionMaker,
  setDecisionMaker,
} from "@/lib/actions/decisionMaker";

export default function DecisionMakerPanel({
  candidateId,
  clinicName,
  // Where the stage stands, and what it found, as stored.
  status,
  contactName,
  contactTitle,
  contactLinkedinUrl,
  confidence,
  evidence,
  attempts,
  // Whether the candidate is one this stage may run on at all: qualified, not
  // promoted, nobody named. The button says why when it is not.
  runnable,
  enabled,
  actorId,
}: {
  candidateId: string;
  clinicName: string;
  status: DecisionMakerStatus;
  contactName: string | null;
  contactTitle: string | null;
  contactLinkedinUrl: string | null;
  confidence: DecisionMakerConfidence | null;
  evidence: string | null;
  attempts: DecisionMakerAttempt[];
  runnable: boolean;
  enabled: boolean;
  actorId: string;
}) {
  const [result, setResult] = useState<FindDecisionMakerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, startSave] = useTransition();
  const [showLog, setShowLog] = useState(false);

  const searched = status !== "not_started";
  const lastAttempt = attempts[0] ?? null;

  async function run() {
    setError(null);
    setRunning(true);
    try {
      const res = await findDecisionMaker(candidateId);
      setResult(res);
      if (!res.ok) setError(res.error);
    } catch {
      setResult(null);
      setError(
        "The search could not be run. Check the server's network connection and try again.",
      );
    } finally {
      setRunning(false);
    }
  }

  function choose(candidate: DecisionMakerCandidate) {
    startSave(async () => {
      const res = await setDecisionMaker({
        id: candidateId,
        name: candidate.name,
        title: candidate.title,
        linkedinUrl: candidate.linkedinUrl,
        email: candidate.email,
        phone: candidate.phone,
        socialUrls: candidate.socialUrls,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
      });
      if (!res.ok) setError(res.error);
      else setResult(null);
    });
  }

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="display text-xl font-semibold">Decision maker</h2>
          <p
            className="mt-1 text-xs leading-relaxed text-muted"
            title={DECISION_MAKER_STATUS_MEANINGS[status]}
          >
            {DECISION_MAKER_STATUS_LABELS[status]}
            {lastAttempt?.at ? ` · last looked ${new Date(lastAttempt.at).toLocaleDateString()}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!runnable || !enabled || running || saving}
          title={
            !enabled
              ? "Turned off under Settings → Pipeline"
              : !runnable
                ? "This stage runs on a clinic with nobody named at it — clear the contact first if the search should look again"
                : `Reads the crawled copy for a name, then searches ${actorId} for “[that name]” “${clinicName}” LinkedIn`
          }
          className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running
            ? "Searching…"
            : searched
              ? "Retry decision maker search"
              : "Find decision maker"}
        </button>
      </div>

      {!enabled && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Decision-maker enrichment is off.{" "}
          <Link href="/settings/pipeline" className="text-accent hover:underline">
            Turn it on under Settings → Pipeline
          </Link>
          , where its actor is set too.
        </p>
      )}

      {/* What is on the record right now. The stored answer, not the last
          run's — a page refreshed tomorrow shows the same thing. */}
      <div className="mt-5 border-t border-line/60 pt-5">
        {contactName ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{contactName}</p>
            <p className="text-xs text-muted">
              {contactTitle ?? (
                <span className="text-muted/70">No title established</span>
              )}
            </p>
            {contactLinkedinUrl && (
              <a
                href={contactLinkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-xs text-accent hover:underline"
              >
                {contactLinkedinUrl}
              </a>
            )}
            {confidence && <ConfidenceBadge confidence={confidence} />}
            {evidence && (
              <p className="pt-1 text-xs leading-relaxed text-muted">{evidence}</p>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-muted">Decision maker: Not found</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {searched
                ? "The website named nobody the search could place at this clinic, and the clinic-anchored fallback found nothing either. Nothing has been guessed at — run it again, or type a name into the Contact fields."
                : "Nobody has looked yet. The search reads the name off this clinic's own website, then looks that person up on LinkedIn."}
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted">{error}</p>
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 space-y-3">
          {/* What each source did, whether or not it produced anybody. A step
              that quietly found nothing is a step nobody can fix. */}
          <ul className="space-y-1">
            {result.steps.map((step) => (
              <li key={step.label} className="text-xs leading-relaxed text-muted">
                <span className="font-medium text-ink">{step.label}:</span> {step.detail}
              </li>
            ))}
          </ul>

          {result.status === "failed" && (
            <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
              <p className="text-xs leading-relaxed text-muted">
                Every step failed outright, so nothing was concluded — the
                candidate is untouched. The errors are in the log below; fix
                what they name and run it again.
              </p>
            </div>
          )}

          {result.status === "found" && result.promotedLeadId && (
            <div className="rounded-[10px] border border-ok/30 bg-ok-soft/60 px-4 py-3">
              <p className="text-sm font-medium">
                Promoted — this clinic went to the pipeline on the score it
                already had, with the decision maker on it.
              </p>
              <Link
                href={`/pipeline/${result.promotedLeadId}`}
                className="mt-1 inline-block text-xs text-accent hover:underline"
              >
                View the lead →
              </Link>
            </div>
          )}

          {result.alternates.length > 0 && (
            <div>
              <p className="text-xs font-medium">
                Others found at this clinic
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                The strongest was taken. If it picked the wrong person, one of
                these can replace it — a lower confidence means the
                verification could not tie them to this clinic outright, not
                that they are the wrong person.
              </p>
              <ul className="mt-2 space-y-2">
                {result.alternates.map((candidate) => (
                  <li
                    key={`${candidate.name}-${candidate.source}`}
                    className="flex flex-wrap items-start gap-3 rounded-[10px] border border-line/60 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{candidate.name}</p>
                      <p className="text-xs text-muted">
                        {candidate.title ?? "No title stated"} ·{" "}
                        {EVIDENCE_SOURCE_LABELS[candidate.source]}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        {candidate.evidence}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ConfidenceBadge confidence={candidate.confidence} />
                      <button
                        type="button"
                        onClick={() => choose(candidate)}
                        disabled={saving}
                        className="btn disabled:opacity-50"
                      >
                        Use this one
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* The log. Folded away, because it is for the run that went wrong and
          not for the ordinary case — but never absent, because a stage that
          found nobody and said nothing about why is one nobody can debug. */}
      {attempts.length > 0 && (
        <div className="mt-5 border-t border-line/60 pt-4">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {showLog ? "Hide" : "Show"} search log ({attempts.length} attempt
            {attempts.length === 1 ? "" : "s"})
          </button>
          {showLog && (
            <ul className="mt-3 space-y-3">
              {attempts.map((attempt, i) => (
                <li key={`${attempt.at}-${i}`} className="text-xs leading-relaxed">
                  <p className="num font-medium">
                    {attempt.at ? new Date(attempt.at).toLocaleString() : "Undated attempt"}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-muted">
                    {attempt.steps.map((step, j) => (
                      <li key={j}>
                        <span className="font-medium text-ink">
                          {EVIDENCE_SOURCE_LABELS[step.source]}
                        </span>{" "}
                        — {step.query}
                        {step.actorId ? ` · ${step.actorId}` : ""} ·{" "}
                        {step.error ? step.error : `${step.results} result${step.results === 1 ? "" : "s"}`}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted">
                    {attempt.selected
                      ? `Selected ${attempt.selected.name}${attempt.selected.title ? `, ${attempt.selected.title}` : ""} — ${CONFIDENCE_LABELS[attempt.selected.confidence]} confidence, from ${EVIDENCE_SOURCE_LABELS[attempt.selected.source]}.`
                      : "Nothing verifiable was found."}
                    {attempt.alternates.length > 0 &&
                      ` Also found: ${attempt.alternates.join(", ")}.`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// The confidence, coloured by what it is claiming. Green only for High, where
// the clinic named the person and the profile names the clinic back — an amber
// Medium and a grey Low are the honest colours for "it agrees on the town" and
// "nothing contradicts it". Low is deliberately not red: an unconfirmed match
// is a lead to check, not a mistake.
const CONFIDENCE_CLASSES: Record<DecisionMakerConfidence, string> = {
  HIGH: "border-ok/30 bg-ok-soft/60 text-ink",
  MEDIUM: "border-warn/30 bg-warn-soft/60 text-ink",
  LOW: "border-line/70 bg-wash/60 text-muted",
  UNKNOWN: "border-line/70 bg-wash/60 text-muted",
};

export function ConfidenceBadge({
  confidence,
}: {
  confidence: DecisionMakerConfidence;
}) {
  return (
    <span
      title={CONFIDENCE_MEANINGS[confidence]}
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${CONFIDENCE_CLASSES[confidence]}`}
    >
      {CONFIDENCE_LABELS[confidence]} confidence
    </span>
  );
}
