"use client";

// "Check for second looks" — the sweep, and what it found.
//
// It sits at the top of the rejected list because that is the only place the
// flags it writes can be read. Pressing it re-reads every rejection on the
// record, and the markers in the list below are the whole of its output — this
// panel reports how many, not which, since the which is the list.
//
// The wording is careful in one specific way, and it is not decoration: this
// never promotes anything. A flag says a person might want to re-read a
// decision. Promoting is still the "Promote anyway" button on the row, still
// confirmed, still a thing somebody does on purpose.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SECOND_LOOK_MAX_REVIEWED,
  SecondLookResult,
  SecondLookRunSummary,
  summariseRun,
} from "@/lib/secondLook";
import AiButton from "@/components/AiButton";

export default function SecondLookPanel({
  check,
  // How many rejections are on the record, for the description. Zero disables
  // the button — there is nothing to sweep and a call would be paid for a
  // sentence saying so.
  rejected,
  // When the last sweep ran, in words, or null if none ever has. Computed on
  // the server so this component carries no clock.
  lastRunAge,
}: {
  check: () => Promise<SecondLookResult>;
  rejected: number;
  lastRunAge: string | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<SecondLookRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const result = await check();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      // The flags are written; this is what puts them on screen. The action
      // has already revalidated the path, so this is a re-read and not a
      // second sweep.
      router.refresh();
    } catch {
      setError(
        "The sweep did not come back. Check the server is still up and try again — nothing has been flagged.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-8 rounded-[10px] border border-line bg-wash/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Second looks</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {rejected === 0
              ? "Nothing has been rejected yet, so there is nothing to re-read."
              : "Re-reads every rejection above against the promotion bar and the reasoning that ended each run, and marks the ones worth a second human look — a score that landed just under the bar, or a disqualifier whose stated reason does not really establish it. It flags; it never promotes."}
          </p>
        </div>
        <AiButton
          onClick={() => void run()}
          disabled={running || rejected === 0}
          title={
            rejected === 0
              ? "There are no rejected candidates to look through."
              : "Re-reads the stored reasoning on every rejection. Costs one model call and changes no candidate's status."
          }
          className="h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Reading…" : "Check for second looks"}
        </AiButton>
      </div>

      {error && (
        <div className="mt-3 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-3.5 py-2.5">
          <p className="text-sm font-medium text-bad">Nothing was checked</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{error}</p>
        </div>
      )}

      {summary && !error && (
        <div className="mt-3 rounded-[10px] border border-ai/30 bg-ai/[0.06] px-3.5 py-2.5">
          <p className="text-xs font-medium">{summariseRun(summary)}</p>
          {summary.flagged > 0 && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Flagged rows are marked below. A flag is a suggestion to re-read
              the decision, nothing more — every one of these is still rejected,
              and promoting one is still the button on its row.
            </p>
          )}
          {summary.notReached > 0 && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              <span className="num">{summary.notReached}</span> disqualified
              rejection{summary.notReached === 1 ? " was" : "s were"} not sent to
              the model — one sweep reads at most{" "}
              <span className="num">{SECOND_LOOK_MAX_REVIEWED}</span>, highest
              score first. Whatever those rows were marked with last time is
              untouched.
            </p>
          )}
        </div>
      )}

      {!summary && !error && lastRunAge && (
        <p className="mt-2.5 text-xs leading-relaxed text-muted">
          Last swept {lastRunAge}. Marks below are from that run.
        </p>
      )}
    </div>
  );
}
