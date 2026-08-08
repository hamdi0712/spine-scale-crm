"use client";

// AI notes — one paragraph on what most needs attention today.
//
// The card is rendered from the cached note (src/lib/digestStore.ts), so the
// dashboard paints immediately and never waits on a model call to become
// interactive. When what it was handed has gone stale it asks for a new one on
// mount, which is what makes this "on page load" without putting a sixty-second
// request in front of the page.
//
// Three states, and the middle one is the point: a note, a note being written,
// and no key configured at all. The third is deliberately quiet rather than an
// error — an install with no DEEPSEEK_API_KEY is a supported install, every
// other card on this dashboard works, and a red box on the front page every
// morning would be shouting about a feature nobody turned on.
//
// The counts under the note are the app's own, not the model's. They are the
// same numbers it was given, printed in the app's words, so a paragraph that
// misread one is caught by the person reading it.

import { useEffect, useRef, useState } from "react";
import {
  DigestResult,
  DigestSnapshot,
  digestBasedOn,
} from "@/lib/dailyDigest";
import AiButton from "@/components/AiButton";

interface Note {
  body: string;
  snapshot: DigestSnapshot;
  // How old the note is, in words. Computed on the server for the note the page
  // arrived with, and replaced with "just now" by a note written here — so
  // there is no clock in this component and no hydration mismatch to manage.
  age: string;
}

export default function AiNotes({
  generate,
  initial,
  // Whether what `initial` carries has passed DIGEST_MAX_AGE_MS. Decided on the
  // server, where the cache and the clock both are.
  stale,
  // Whether DEEPSEEK_API_KEY is set. A boolean, worked out on the server — the
  // key itself never comes near this component.
  configured,
}: {
  generate: (force?: boolean) => Promise<DigestResult>;
  initial: Note | null;
  stale: boolean;
  configured: boolean;
}) {
  const [note, setNote] = useState<Note | null>(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // React runs mount effects twice in development's strict mode, and this one
  // spends money. The ref is the guard, and it is set before the await rather
  // than after it so the second run never gets past the check.
  const asked = useRef(false);

  async function run(force: boolean) {
    setRunning(true);
    setError(null);
    try {
      const result = await generate(force);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNote({
        body: result.body,
        snapshot: result.snapshot,
        age: "just now",
      });
    } catch {
      setError(
        "The note could not be written — the request did not come back. Check the server is still up and try again.",
      );
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (!configured || asked.current) return;
    // Nothing stored, or what is stored has aged out. A fresh note on screen is
    // left alone — that is the cache doing its job.
    if (note !== null && !stale) return;
    asked.current = true;
    void run(false);
    // Mount only. A note is written for the day, not for a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="display flex items-center gap-2.5 text-xl font-semibold">
          AI notes
          {note && (
            <span className="text-xs font-normal text-muted">{note.age}</span>
          )}
        </h2>
        {configured && (
          <AiButton
            onClick={() => void run(true)}
            disabled={running}
            title="Reads today's counts again and writes a new note. Costs one model call."
            className="h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Writing…" : note ? "Refresh note" : "Write the note"}
          </AiButton>
        )}
      </div>

      {/* A run that failed says so above whatever is already on screen. The
          note under it, where there is one, is explicitly the old one — a
          failed refresh must never read as the note it failed to write. */}
      {error && (
        <div className="mt-4 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-3.5 py-2.5">
          <p className="text-sm font-medium text-bad">No note was written</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{error}</p>
          {note && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              The note below is the last one that was written, {note.age}.
            </p>
          )}
        </div>
      )}

      {note ? (
        <>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed">{note.body}</p>
          {/* The counts it was handed, in the app's own words. Kept small and
              muted: it is the receipt for the paragraph, not a second KPI row. */}
          <p className="num mt-2.5 text-xs leading-relaxed text-muted">
            Read from {digestBasedOn(note.snapshot).join(" · ")}
          </p>
          {/* A stored note outlives the key that wrote it. Saying so beats
              both alternatives: hiding a good note, and showing it beside a
              notice claiming the feature is off. */}
          {!configured && (
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">
              This is the last note that was written.{" "}
              <span className="num">DEEPSEEK_API_KEY</span> is not set any more,
              so it will not be rewritten.
            </p>
          )}
        </>
      ) : !configured ? (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
          AI notes are off — <span className="num">DEEPSEEK_API_KEY</span> is not
          set. Add it to the <span className="num">.env</span> file and restart
          the server, and this card writes one short paragraph a day on what
          most needs attention. Everything else on this dashboard is counted
          from your own records and works either way.
        </p>
      ) : (
        !error && (
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
            {running
              ? "Reading today's numbers…"
              : "No note yet. Press “Write the note” and one is written from today's counts."}
          </p>
        )
      )}
    </section>
  );
}
