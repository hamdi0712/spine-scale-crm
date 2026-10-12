"use client";

// "Apply new scoring" — the one switch that moves Process Queue onto the ICP
// model, and the way back. It is offered only once a comparison has run to the
// end; the server checks the same thing again (setScoringModel in
// src/lib/actions/pipelineSettings.ts), because a hidden button is a courtesy.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function ApplyScoringModel({
  model,
  canApply,
  lockedReason,
  setModel,
}: {
  model: "v1" | "v2";
  canApply: boolean;
  lockedReason: string | null;
  setModel: (model: "v1" | "v2") => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function flip(next: "v1" | "v2") {
    const message =
      next === "v2"
        ? "Apply the new scoring model? From the next Process queue run, candidates are scored against the active ICP out of 100 — chiro-first clinics are held, fits under 40 are rejected. Nothing already scored changes."
        : "Switch Process queue back to the old A–D scorecard? Nothing already scored changes.";
    if (!confirm(message)) return;
    setError(null);
    startTransition(async () => {
      const result = await setModel(next);
      if (!result.ok) setError(result.error ?? "That did not save.");
      router.refresh();
    });
  }

  return (
    <div className="card p-6 max-md:p-4">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Process queue scores with:{" "}
            <span className={model === "v2" ? "text-ok" : "text-ink-soft"}>
              {model === "v2" ? "the new ICP model" : "the old A–D scorecard"}
            </span>
          </p>
          <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
            {model === "v2"
              ? "Applied. Every candidate processed from now on is judged fit-first against the active ICP. Switching back affects new runs only."
              : "The new model is not applied yet. Review a finished comparison below, then apply it — only candidates processed after that are scored the new way."}
          </p>
          {model === "v1" && !canApply && lockedReason && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{lockedReason}</p>
          )}
          {error && <p className="mt-1.5 text-xs leading-relaxed text-bad">{error}</p>}
        </div>
        {model === "v2" ? (
          <button type="button" className="btn shrink-0" disabled={pending} onClick={() => flip("v1")}>
            {pending ? "Saving…" : "Switch back to the old model"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canApply || pending}
            onClick={() => flip("v2")}
          >
            {pending ? "Applying…" : "Apply new scoring"}
          </button>
        )}
      </div>
    </div>
  );
}
