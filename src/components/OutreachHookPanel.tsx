"use client";

// "Generate outreach hook" — a first line, and the note it goes in.
//
// It sits in the outreach row beside the LinkedIn link, with the other things
// on this page that help send a connection request by hand. Like all of them,
// it sends nothing: the note is drafted here, edited here if it needs it, and
// copied out to be pasted into LinkedIn by the person whose account it is.
//
// Three states worth designing for, and the third is the interesting one.
// A line came back and the note is ready to copy. The run failed and says why.
// Or the evidence was not specific enough to say anything credible, which is a
// real answer rather than an error — so it is reported as one, in place of the
// generic opener that would otherwise be sitting there tempting somebody to
// send it.
//
// Everything is type="button" and the textarea is unnamed: this renders inside
// the lead's details form, so a stray submit or a stray field would save the
// lead as a side effect of drafting a note.

import { useState } from "react";
import {
  CONTACT_NAME_PLACEHOLDER,
  HOOK_MAX_CHARS,
  OutreachHookResult,
  connectionNote,
} from "@/lib/outreachHook";

type Panel =
  | { kind: "note"; evidence: string | null; basedOn: string[] }
  | { kind: "none"; basedOn: string[] }
  | { kind: "error"; message: string };

export default function OutreachHookPanel({
  generate,
  clinicName,
  contactName,
  // The hook stored on the lead, where a previous run wrote one. It opens the
  // panel already filled in, so a note drafted yesterday is here today without
  // paying for the same line twice.
  storedHook,
  // Whether there is any enrichment evidence to write from. False disables the
  // button, and the title says what to do about it.
  enriched,
}: {
  generate: () => Promise<OutreachHookResult>;
  clinicName: string;
  contactName: string | null;
  storedHook: string | null;
  enriched: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(
    storedHook ? { kind: "note", evidence: null, basedOn: [] } : null,
  );
  // The note as it stands in the box, which is the thing that actually gets
  // copied. Seeded from the hook and then owned by whoever is typing in it —
  // an edit is not saved anywhere, because this is a draft on its way to
  // another application.
  const [note, setNote] = useState(() =>
    storedHook
      ? connectionNote({ contactName, clinicName, hook: storedHook })
      : "",
  );
  const [copied, setCopied] = useState(false);

  async function run() {
    setRunning(true);
    setCopied(false);
    try {
      const result = await generate();
      if (!result.ok) {
        setPanel({ kind: "error", message: result.error });
        return;
      }
      if (result.hook === null) {
        setPanel({ kind: "none", basedOn: result.basedOn });
        setNote("");
        return;
      }
      setPanel({
        kind: "note",
        evidence: result.evidence,
        basedOn: result.basedOn,
      });
      setNote(connectionNote({ contactName, clinicName, hook: result.hook }));
    } catch {
      setPanel({
        kind: "error",
        message:
          "The request could not be reached. Check the server is still up and try again.",
      });
    } finally {
      setRunning(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(note);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused — an insecure origin, a browser
      // setting. The text is on screen and selectable either way, so this says
      // so rather than failing silently.
      setCopied(false);
      setPanel({
        kind: "error",
        message:
          "This browser would not let the page write to the clipboard. Select the note and copy it by hand.",
      });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={running || !enriched}
        title={
          enriched
            ? "Writes one line about this clinic from its enrichment evidence. Nothing is sent."
            : "Run “Enrich this lead” first — there is no evidence to write a hook from yet."
        }
        className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running
          ? "Writing…"
          : panel?.kind === "note"
            ? "Regenerate hook"
            : "Generate outreach hook"}
      </button>

      {/* w-full inside the wrapping flex row, so the draft takes a line of its
          own under the buttons rather than squeezing in beside them. */}
      {panel && (
        <div className="w-full">
          {panel.kind === "error" ? (
            <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
              <p className="text-sm font-medium text-bad">
                No hook was written
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {panel.message}
              </p>
            </div>
          ) : panel.kind === "none" ? (
            <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
              <p className="text-sm font-medium text-ink">
                Nothing specific enough to open with
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                The evidence gathered for this clinic
                {panel.basedOn.length > 0 && (
                  <> — {panel.basedOn.join(", ").toLowerCase()} — </>
                )}
                carries nothing concrete enough to be worth remarking on, so
                nothing was written rather than an opener that would read as a
                template. Crawling more of the site, or a look at it by hand,
                is what would change that.
              </p>
            </div>
          ) : (
            <div className="rounded-[10px] border border-line bg-wash/50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-medium">Connection note</p>
                <p className="num text-xs text-muted">
                  {note.length} characters
                </p>
              </div>
              <textarea
                // Unnamed on purpose — see the note at the top of this file.
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setCopied(false);
                }}
                rows={3}
                aria-label="Connection note to copy"
                className="field mt-2 text-sm"
              />
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copy()}
                  disabled={note.trim() === ""}
                  className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? "Copied ✓" : "Copy note"}
                </button>
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
                  {note.includes(CONTACT_NAME_PLACEHOLDER)
                    ? `Fill in ${CONTACT_NAME_PLACEHOLDER} — this lead has no contact name on it. `
                    : ""}
                  Read it before you send it: the line is written from scraped
                  copy, and nothing here sends anything.
                </p>
              </div>
              {panel.evidence && (
                <p className="mt-2 border-t border-line/60 pt-2 text-xs leading-relaxed text-muted">
                  Read off: “{panel.evidence}”
                </p>
              )}
              {panel.basedOn.length > 0 && (
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Written from {panel.basedOn.join(", ").toLowerCase()}. Up to{" "}
                  <span className="num">{HOOK_MAX_CHARS}</span> characters, so
                  it stays a clause.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
