"use client";

// What this is about to cost, before it is pressed.
//
// Both the places that spend Apify credit in bulk show one of these, worded
// the same way, because they are answering the same question: is this queue
// pennies or dollars? Until now that was unanswerable without opening the
// Apify console and doing the arithmetic per actor.
//
// It is an estimate and says so in every part of its presentation — the tilde,
// the word "rough", and the note about where the numbers come from. The rates
// are approximate published ones (PIPELINE_STEP_RATES), and they move; the
// point is the order of magnitude and the fact that turning a step off shows
// up in it immediately.

import {
  PIPELINE_STEP_KEYS,
  PIPELINE_STEP_LABELS,
  PipelineSettings,
  costPerCandidate,
  estimateSentence,
  fmtEstimate,
} from "@/lib/pipelineSettings";

export default function CostEstimate({
  candidates,
  settings,
  // What the estimate is *for*, when that is not "running this now" — the
  // import wizard is quoting a bill that lands later, at the queue.
  note,
}: {
  candidates: number;
  settings: PipelineSettings;
  note?: string;
}) {
  const on = PIPELINE_STEP_KEYS.filter((k) => settings.steps[k].enabled);
  const perCandidate = costPerCandidate(settings);

  return (
    <div className="rounded-[10px] border border-line bg-wash/50 px-4 py-3">
      <p className="num text-sm font-medium">
        Rough cost: {estimateSentence(candidates, settings)}
      </p>
      <p className="num mt-0.5 text-xs leading-relaxed text-muted">
        {on.length === 0
          ? "Every enrichment step is turned off, so no actor runs and nothing is spent — and nothing is gathered to score on either."
          : `${on.length} of ${PIPELINE_STEP_KEYS.length} steps on (${on
              .map((k) => PIPELINE_STEP_LABELS[k])
              .join(", ")}), about ${fmtEstimate(perCandidate).replace("~", "")} each.`}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        Approximate published actor rates, not a quote — the real figure is
        Apify&rsquo;s, and a clinic running more ads than most costs more than
        this says. The model call per candidate is fractions of a cent and is
        not counted.
        {note ? ` ${note}` : ""}
      </p>
    </div>
  );
}
