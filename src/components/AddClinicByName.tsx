"use client";

// Add clinic by name — one clinic, one search, one candidate.
//
// The two imports beside it are for lists. This is for the other way clinics
// arrive: somebody names one. The form asks for the name and, if it helps
// narrow the search, a town — and that is the whole input. The website comes
// from a Google Search run on the server, because the point of this button is
// that nobody should have to go and find the URL by hand first.
//
// What it makes is an ordinary Pending candidate. It says so, and the link at
// the end goes to the same candidate page a CSV row lands on: from here it is
// Process queue and the same chain as everything else in the list.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AddByNameResult,
  CLINIC_NAME_MAX_CHARS,
  LOCATION_MAX_CHARS,
} from "@/lib/discoveryAddByName";
import { DISCOVERY_STATUS_LABELS, isDiscoveryStatus } from "@/lib/discovery";

// Where the clinic that's already here got to — " (Rejected)", or nothing at
// all for a status this build doesn't know, which is a link that still works
// rather than a label that lies.
function statusWord(status: string | undefined): string {
  return isDiscoveryStatus(status)
    ? ` (${DISCOVERY_STATUS_LABELS[status]})`
    : "";
}

export default function AddClinicByName({
  add,
}: {
  add: (args: {
    clinicName: string;
    location?: string | null;
  }) => Promise<AddByNameResult>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn">
        Add clinic by name
      </button>
      {open && <AddDialog add={add} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddDialog({
  add,
  onClose,
}: {
  add: (args: {
    clinicName: string;
    location?: string | null;
  }) => Promise<AddByNameResult>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [clinicName, setClinicName] = useState("");
  const [location, setLocation] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AddByNameResult | null>(null);

  // Escape closes, like every other dialog in the app — but not while the
  // search is running. A stray keypress must not look like it stopped
  // something that is still running on the server.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  // The page behind a modal should not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (running || clinicName.trim() === "") return;
    setRunning(true);
    setResult(null);
    try {
      const next = await add({
        clinicName,
        location: location.trim() === "" ? null : location,
      });
      setResult(next);
      // The list behind the dialog is a candidate short of what it now holds.
      if (next.ok) router.refresh();
    } catch {
      setResult({
        ok: false,
        error:
          "The search could not be reached. Check the server is still up and try again.",
      });
    } finally {
      setRunning(false);
    }
  }

  // After a clinic is added the form empties, so the obvious next action —
  // adding another — needs no press to get back to.
  function addAnother() {
    setClinicName("");
    setLocation("");
    setResult(null);
  }

  const added = result?.ok === true ? result : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-clinic-title"
        className="card my-auto flex max-h-[88vh] w-full max-w-lg flex-col"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
          <div className="min-w-0">
            <h2 id="add-clinic-title" className="display text-lg font-semibold">
              Add clinic by name
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              One clinic, searched for by name — it lands in Discovery as
              Pending, like any import.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label="Close"
            className="btn-ghost h-[34px] shrink-0 px-3 text-base leading-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          <div>
            <label htmlFor="add-clinic-name" className="field-label">
              Clinic name
            </label>
            <input
              id="add-clinic-name"
              name="clinicName"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              maxLength={CLINIC_NAME_MAX_CHARS}
              disabled={running}
              autoFocus
              autoComplete="off"
              placeholder="Austin Spine & Injury"
              className="field disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor="add-clinic-location" className="field-label">
              City or state <span className="text-muted/70">— optional</span>
            </label>
            <input
              id="add-clinic-location"
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={LOCATION_MAX_CHARS}
              disabled={running}
              autoComplete="off"
              placeholder="Austin, TX"
              className="field disabled:opacity-60"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Narrows the search when two clinics share a name, and is left out
              of it when you leave it blank rather than guessed at.
            </p>
          </div>

          {running && (
            <p className="text-xs leading-relaxed text-muted">
              Searching Google for the clinic’s website — one actor run, so
              this takes a moment. Nothing is scored here; the candidate goes
              into the queue like any other.
            </p>
          )}

          {result?.ok === false && (
            <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
              <p className="text-sm font-medium text-ink">
                Nothing was added
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {result.error}
              </p>
              {result.duplicateId && (
                <Link
                  href={`/discovery/${result.duplicateId}`}
                  className="mt-1.5 inline-block text-xs text-accent hover:underline"
                >
                  Open it{statusWord(result.duplicateStatus)} →
                </Link>
              )}
            </div>
          )}

          {added && (
            <div className="rounded-[10px] border border-ok/30 bg-ok-soft/60 px-4 py-3">
              <p className="text-sm font-medium">
                {added.clinicName} added as Pending
              </p>
              <p className="num mt-0.5 text-xs leading-relaxed text-muted">
                {added.searchError
                  ? `The website search didn’t run — ${added.searchError} The candidate was created anyway: the Maps actor in the queue searches on the name alone.`
                  : added.websiteUrl
                    ? `Website found: ${added.websiteUrl}`
                    : `Searched for “${added.query}” and nothing in the results read as the clinic’s own site. The candidate was created anyway — add a website on it, or let the queue try Maps on the name.`}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                It is scored by Process queue, with the same chain every other
                candidate goes through.
              </p>
              <Link
                href={`/discovery/${added.id}`}
                className="mt-1.5 inline-block text-xs text-accent hover:underline"
              >
                Open the candidate →
              </Link>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/60 px-6 py-4">
          {added ? (
            <button type="button" onClick={addAnother} className="btn">
              Add another
            </button>
          ) : (
            <button
              type="submit"
              disabled={running || clinicName.trim() === ""}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Searching…" : "Search and add"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className={`${added ? "btn-primary" : "btn-ghost"} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {running ? "Working…" : "Done"}
          </button>
        </div>
      </form>
    </div>
  );
}
