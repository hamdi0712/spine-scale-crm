"use client";

// Enrich this lead — one Apify run, mapped onto the record already open.
//
// The bulk import wizard (src/components/LeadImportWizard.tsx) turns a run into
// new leads. This is its single-record counterpart and shares everything that
// makes that work: the same server-side run, the same flattened fields, the
// same nothing-is-guessed mapping step. What it does not share is the ending —
// there is no row count, no duplicate check and no create here, because the
// lead this writes to is the one whose page the panel is open on.
//
// Like the wizards, the visible controls are unnamed and bound to state; two
// hidden inputs carry the payload — the one row being read, and the mapping —
// into the post.

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { fetchApifyEnrichment } from "@/lib/actions/apify";
import {
  ENRICH_FIELDS,
  ENRICH_FIELD_LABELS,
  EnrichFieldKey,
  EnrichMapping,
  enrichFieldsWritten,
  enrichWizardSteps,
  isEnrichFieldKey,
  mapEnrichRow,
} from "@/lib/leadEnrich";
import {
  APIFY_INPUT_PLACEHOLDER,
  isNestedFieldHeader,
} from "@/lib/leadImport";
import WizardProgress from "@/components/WizardProgress";

// What the run handed back: what it was, the fields it found, and the items
// behind them.
interface Loaded {
  label: string;
  headers: string[];
  rows: string[][];
}

export default function LeadEnrichPanel({
  action,
  clinicName,
}: {
  action: (formData: FormData) => Promise<void>;
  clinicName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn">
        Enrich this lead
      </button>
      {open && (
        <EnrichDialog
          action={action}
          clinicName={clinicName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Mounted only while open, so every close starts the next run from a clean
// step 1 rather than from whatever the last one left behind.
function EnrichDialog({
  action,
  clinicName,
  onClose,
}: {
  action: (formData: FormData) => Promise<void>;
  clinicName: string;
  onClose: () => void;
}) {
  const steps = enrichWizardSteps();

  const [step, setStep] = useState(1);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  const [mapping, setMapping] = useState<EnrichMapping>([]);
  const [error, setError] = useState<string | null>(null);

  const [apifyKind, setApifyKind] = useState("actor");
  const [apifyId, setApifyId] = useState("");
  const [apifyInput, setApifyInput] = useState("");
  const [running, setRunning] = useState(false);

  const idRef = useRef<HTMLInputElement>(null);

  const meta = steps[step - 1];
  const canRun = !running && apifyId.trim() !== "";
  const row = loaded?.rows[itemIndex] ?? [];
  // Read by the same helper the update uses, so this is what will be written
  // rather than a description of it.
  const update = mapEnrichRow(row, mapping);
  const written = enrichFieldsWritten(update);

  // Escape closes, like the dialog it looks like. The run is server-side and
  // its result is simply dropped — nothing has been written at any point
  // before the confirm.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The page behind a modal should not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    idRef.current?.focus();
  }, []);

  // Runs the actor and waits for it. Everything that can go wrong — a missing
  // token, a bad ID, spent credits, a run that overruns — comes back as a
  // sentence in result.error rather than an exception, and is shown as-is.
  async function runApify() {
    setError(null);
    setRunning(true);
    try {
      const result = await fetchApifyEnrichment({
        kind: apifyKind,
        id: apifyId,
        input: apifyInput,
      });
      if (!result.ok) {
        setLoaded(null);
        setMapping([]);
        setError(result.error);
        return;
      }
      setLoaded({
        label: result.label,
        headers: result.headers,
        rows: result.rows,
      });
      setItemIndex(0);
      // A new run means new fields — start every one of them unmapped.
      setMapping(result.headers.map(() => null));
    } catch {
      setError(
        "The run could not be reached. Check the server is still up and try again.",
      );
    } finally {
      setRunning(false);
    }
  }

  // Each target is filled by exactly one detected field, so pointing a second
  // one at it releases the first rather than silently writing one of the two.
  function setField(index: number, value: string) {
    const key = isEnrichFieldKey(value) ? value : null;
    setMapping((prev) =>
      prev.map((current, i) => {
        if (i === index) return key;
        return key !== null && current === key ? null : current;
      }),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 sm:p-8"
      onMouseDown={(e) => {
        // Only a press that both starts and ends on the backdrop closes, so a
        // drag that finishes outside the panel — selecting the last of a JSON
        // blob, say — doesn't throw the run away.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        action={async (formData) => {
          await action(formData);
          onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrich-title"
        className="card my-auto flex max-h-[88vh] w-full max-w-3xl flex-col"
        // Enter inside a field would otherwise submit from whichever step is on
        // screen. On the run step it runs the actor instead, which is what
        // pressing Enter in that form plainly means.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "TEXTAREA") return;
          e.preventDefault();
          if (step === 1 && canRun) void runApify();
        }}
      >
        <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
        <input type="hidden" name="row" value={JSON.stringify(row)} />

        <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
          <div className="min-w-0">
            <h2 id="enrich-title" className="display text-lg font-semibold">
              Enrich this lead
            </h2>
            <p className="mt-0.5 truncate text-xs leading-relaxed text-muted">
              {clinicName} — an actor run, mapped onto this record. No new lead
              is created.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost h-[34px] shrink-0 px-3 text-base leading-none"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-line/60 px-6 py-4">
          <WizardProgress
            steps={steps}
            current={step}
            note="Nothing is written until you confirm."
          />
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          <div>
            <h3 className="text-sm font-medium">
              <span className="num">{step}.</span> {meta.title}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {meta.blurb}
            </p>
          </div>

          {/* ─── Step 1 — run an Apify actor or task ─────────────────────── */}
          {step === 1 && (
            <>
              <div className="grid grid-cols-[150px_1fr] gap-4">
                <div>
                  <label className="field-label" htmlFor="enrich-apify-kind">
                    Run a
                  </label>
                  <select
                    id="enrich-apify-kind"
                    value={apifyKind}
                    onChange={(e) => setApifyKind(e.target.value)}
                    className="field"
                  >
                    <option value="actor">Actor</option>
                    <option value="task">Task</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="enrich-apify-id">
                    {apifyKind === "task" ? "Task ID" : "Actor ID"}
                  </label>
                  <input
                    id="enrich-apify-id"
                    ref={idRef}
                    value={apifyId}
                    onChange={(e) => setApifyId(e.target.value)}
                    placeholder="apimaestro~linkedin-profile-search or the 17-character ID"
                    className="field"
                  />
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="enrich-apify-input">
                  Input parameters (JSON)
                </label>
                <textarea
                  id="enrich-apify-input"
                  value={apifyInput}
                  onChange={(e) => setApifyInput(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  placeholder={APIFY_INPUT_PLACEHOLDER}
                  className="field font-mono text-xs"
                />
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Paste it from the {apifyKind}’s own input tab in the Apify
                  console, narrowed to this clinic — a run for one lead should
                  return one record.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {/* Primary until there are results to move on with — after that
                    Continue is the step's real action and this drops back to a
                    secondary re-run. */}
                <button
                  type="button"
                  onClick={() => void runApify()}
                  disabled={!canRun}
                  className={`${loaded ? "btn" : "btn-primary"} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {running
                    ? "Running…"
                    : loaded
                      ? "Run again"
                      : "Run and fetch results"}
                </button>
                <span className="text-xs leading-relaxed text-muted">
                  {running
                    ? "Waiting for the run to finish — this can take a couple of minutes."
                    : "The run is charged to the account the token belongs to."}
                </span>
              </div>

              {error && (
                <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
                  <p className="text-sm font-medium text-bad">
                    The run didn’t return anything to map
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {error}
                  </p>
                </div>
              )}

              {loaded && (
                <div className="rounded-[10px] border border-line bg-wash/50 px-4 py-3">
                  <p className="text-sm font-medium">{loaded.label}</p>
                  <p className="num mt-0.5 text-xs leading-relaxed text-muted">
                    {loaded.rows.length} item
                    {loaded.rows.length === 1 ? "" : "s"} ·{" "}
                    {loaded.headers.length} field
                    {loaded.headers.length === 1 ? "" : "s"} detected
                  </p>
                  {loaded.rows.length > 1 && (
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Only one item is read onto this lead — pick which on the
                      next step, or narrow the input and run again.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* ─── Step 2 — map the result onto this lead ──────────────────── */}
          {step === 2 && loaded && (
            <>
              {/* A search actor asked about one clinic can still answer with
                  several. Rather than assume the first is the right one, the
                  item being read is stated and can be changed — the mapping
                  and the values below follow it. */}
              {loaded.rows.length > 1 && (
                <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-wash/50 px-4 py-3">
                  <label className="field-label mb-0" htmlFor="enrich-item">
                    Reading item
                  </label>
                  <select
                    id="enrich-item"
                    value={itemIndex}
                    onChange={(e) => setItemIndex(Number(e.target.value))}
                    className="field num w-auto min-w-[90px]"
                  >
                    {loaded.rows.map((_, i) => (
                      <option key={i} value={i}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                  <span className="num text-xs leading-relaxed text-muted">
                    of {loaded.rows.length} returned — the others are ignored.
                  </span>
                </div>
              )}

              <div className="overflow-x-auto rounded-[10px] border border-line">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th">Dataset field</th>
                      <th className="th">Value</th>
                      <th className="th">Fills</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.headers.map((header, i) => (
                      <tr key={`${header}-${i}`} className="hover:bg-wash/70">
                        <td className="td font-medium">{header}</td>
                        <td
                          className="td max-w-[240px] truncate text-muted"
                          title={row[i] || undefined}
                        >
                          {row[i] || "—"}
                        </td>
                        <td className="td">
                          <select
                            aria-label={`Fill this lead’s field from “${header}”`}
                            value={mapping[i] ?? ""}
                            onChange={(e) => setField(i, e.target.value)}
                            className="field w-auto min-w-[200px]"
                          >
                            <option value="">Don’t import</option>
                            {ENRICH_FIELDS.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-1.5">
                {ENRICH_FIELDS.map((f) => (
                  <li key={f.key} className="text-xs leading-relaxed text-muted">
                    <span className="font-medium text-ink">{f.label}</span> —{" "}
                    {f.hint}
                  </li>
                ))}
                {/* Only when the run actually produced one, so the note is
                    never an explanation of something not on screen. */}
                {loaded.headers.some(isNestedFieldHeader) && (
                  <li className="text-xs leading-relaxed text-muted">
                    <span className="font-medium text-ink">
                      A field written “something → something”
                    </span>{" "}
                    — read out of the JSON list above it, from the first entry
                    carrying a value. The list itself is left in place to check
                    it against.
                  </li>
                )}
              </ul>

              {/* What the confirm will do, field by field, before it does it. */}
              <div className="rounded-[10px] border border-line bg-wash/50 px-4 py-3">
                <p className="text-sm font-medium">
                  {written.length === 0
                    ? "Nothing mapped yet"
                    : `Writes onto ${clinicName}`}
                </p>
                {written.length === 0 ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    Point at least one field at something above. A field mapped
                    to a blank value counts as nothing to write.
                  </p>
                ) : (
                  <>
                    <dl className="mt-2 space-y-1.5">
                      {written.map((key) => (
                        <div key={key} className="flex gap-2 text-xs">
                          <dt className="w-[110px] shrink-0 text-muted">
                            {ENRICH_FIELD_LABELS[key]}
                          </dt>
                          <dd className="min-w-0 flex-1 break-words leading-relaxed">
                            <WrittenValue field={key} value={update[key]} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-2.5 text-xs leading-relaxed text-muted">
                      Overwrites whatever those fields hold now. Everything else
                      on the lead — including the fields left unmapped — is left
                      exactly as it is.
                      {update.reviewCount !== undefined && (
                        <> The review count is stamped with today’s date.</>
                      )}
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/60 px-6 py-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((n) => n - 1)}
              className="btn"
            >
              ← Back
            </button>
          ) : (
            <button type="button" onClick={onClose} className="btn">
              Cancel
            </button>
          )}
          {/* Two separate slots rather than one ternary, so React never reuses
              the same DOM node for both — advancing the step inside a click
              handler would otherwise flip that node to type="submit" before the
              browser runs the click's default action, and the press onto the
              mapping step would write the lead unlooked-at. */}
          {step === 1 && (
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={loaded === null}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {step === 2 && <SubmitButton disabled={written.length === 0} />}
        </div>
      </form>
    </div>
  );
}

// Separate so useFormStatus can see the form it sits in: the update is a
// server round-trip, and a second press would run it twice.
function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Updating…" : "Update this lead →"}
    </button>
  );
}

function WrittenValue({
  field,
  value,
}: {
  field: EnrichFieldKey;
  value: string | number | undefined;
}) {
  if (value === undefined) return null;
  if (typeof value === "number") {
    return <span className="num font-medium">{value}</span>;
  }
  // Website notes can be a page of copy. It is stored whole; the preview shows
  // enough to recognise it by, and says how much more there is.
  if (field === "websiteNotes" && value.length > 220) {
    return (
      <span>
        <span className="font-medium">{value.slice(0, 220)}…</span>{" "}
        <span className="num text-muted">
          ({value.length} characters, stored in full)
        </span>
      </span>
    );
  }
  return <span className="font-medium">{value}</span>;
}
