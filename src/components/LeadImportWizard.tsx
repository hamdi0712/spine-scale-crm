"use client";

// The lead import — pick a source, map its columns, preview, confirm.
//
// Two sources feed the same three steps. A CSV is parsed in the browser, so
// the file never leaves it until the last step; an Apify run happens on the
// server, because the API token lives there and nowhere else. Both arrive at
// step 2 as the same thing: a list of detected columns and the rows behind
// them, which is why there is one wizard rather than two.
//
// Nothing about the columns is ever guessed — every one starts unmapped,
// because the whole point is that two actors scraping the same thing return
// different fields under different names in a different order.
//
// Like the other wizards in the app, the visible controls are unnamed and
// bound to state; two hidden inputs carry the payload into the post.

import { useMemo, useState } from "react";
import { parseCsv } from "@/lib/csv";
import { fetchApifyDataset } from "@/lib/actions/apify";
import {
  APIFY_INPUT_PLACEHOLDER,
  ColumnMapping,
  IMPORT_DEFAULT_SOURCE,
  IMPORT_DEFAULT_STAGE,
  IMPORT_FIELDS,
  IMPORT_PREVIEW_ROWS,
  IMPORT_SOURCE_META,
  ImportFieldKey,
  ImportSource,
  ImportedLead,
  MAX_IMPORT_ROWS,
  JOINING_FIELD_LABELS,
  dedupeKey,
  fieldJoinsColumns,
  importWizardSteps,
  isImportFieldKey,
  isNestedFieldHeader,
  joinCells,
  mapRow,
  mappedColumn,
  mappedColumns,
} from "@/lib/leadImport";
import { LEAD_STAGE_LABELS } from "@/lib/constants";
import { zoneLabel } from "@/lib/timezones";
import { suggestedStaffSizeScore } from "@/lib/icp";
import { fmtMoney } from "@/lib/format";
import WizardProgress from "@/components/WizardProgress";

// What either source hands to step 2: what it was, what columns it found, and
// the rows behind them.
interface Loaded {
  label: string;
  headers: string[];
  rows: string[][];
}

export default function LeadImportWizard({
  action,
  source,
}: {
  action: (formData: FormData) => Promise<void>;
  source: ImportSource;
}) {
  const steps = importWizardSteps(source);
  const sourceMeta = IMPORT_SOURCE_META[source];

  const [step, setStep] = useState(1);
  const [parsed, setParsed] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Apify step 1 only. Unnamed like every other control here, so none of it
  // posts with the import.
  const [apifyKind, setApifyKind] = useState("actor");
  const [apifyId, setApifyId] = useState("");
  const [apifyInput, setApifyInput] = useState("");
  const [running, setRunning] = useState(false);

  const meta = steps[step - 1];
  const clinicMapped = mappedColumn(mapping, "clinicName") !== -1;
  const canRun = !running && apifyId.trim() !== "";
  // What the thing being mapped is called, so the copy fits the source it
  // came from: a CSV has columns, a dataset item has fields.
  const noun = source === "csv" ? "column" : "field";

  // Every row the mapping can actually turn into a lead, and what happened to
  // the rest, so the confirm step states all of it before anything is written.
  //
  // Repeats inside the file are counted here because they can be. Leads
  // already in the pipeline are not — that check belongs to the import itself,
  // and is described rather than counted on this step.
  const { leads, unusable, repeated } = useMemo(() => {
    if (!parsed || !clinicMapped) return { leads: [], unusable: 0, repeated: 0 };
    const capped = parsed.rows.slice(0, MAX_IMPORT_ROWS);
    const out: ImportedLead[] = [];
    const seen = new Set<string>();
    let unusable = 0;
    let repeated = 0;
    for (const row of capped) {
      const lead = mapRow(row, mapping);
      if (!lead) {
        unusable++;
        continue;
      }
      const key = dedupeKey(lead.clinicName, lead.contactName);
      if (seen.has(key)) {
        repeated++;
        continue;
      }
      seen.add(key);
      out.push(lead);
    }
    return { leads: out, unusable, repeated };
  }, [parsed, mapping, clinicMapped]);

  const overCap = parsed ? parsed.rows.length - Math.min(parsed.rows.length, MAX_IMPORT_ROWS) : 0;

  // The columns the preview shows: whatever was mapped, in field order rather
  // than column order, so the table reads like the lead record it becomes.
  const previewFields = IMPORT_FIELDS.filter((f) => mapping.includes(f.key));

  async function readFile(file: File) {
    setError(null);
    try {
      const table = parseCsv(await file.text());
      if (table.headers.length === 0 || table.rows.length === 0) {
        setParsed(null);
        setMapping([]);
        setError(
          "No rows found in that file. A CSV needs a header row and at least one row of data.",
        );
        return;
      }
      setParsed({ label: file.name, headers: table.headers, rows: table.rows });
      // A new file means new columns — start every one of them unmapped.
      setMapping(table.headers.map(() => null));
    } catch {
      setParsed(null);
      setMapping([]);
      setError("That file could not be read as CSV.");
    }
  }

  // Runs the actor and waits for it. Everything that can go wrong — a missing
  // token, a bad ID, spent credits, a run that overruns — comes back as a
  // sentence in result.error rather than an exception, and is shown as-is.
  async function runApify() {
    setError(null);
    setRunning(true);
    try {
      const result = await fetchApifyDataset({
        kind: apifyKind,
        id: apifyId,
        input: apifyInput,
      });
      if (!result.ok) {
        setParsed(null);
        setMapping([]);
        setError(result.error);
        return;
      }
      setParsed({
        label: result.label,
        headers: result.headers,
        rows: result.rows,
      });
      setMapping(result.headers.map(() => null));
    } catch {
      setError(
        "The run could not be reached. Check the server is still up and try again.",
      );
    } finally {
      setRunning(false);
    }
  }

  function setColumn(index: number, value: string) {
    const key = isImportFieldKey(value) ? value : null;
    // The name-style fields take several columns and join them — first and
    // last name onto Contact name — so pointing another column at one of those
    // adds to it. Every other field fills from exactly one column, and
    // pointing a second at it releases the first rather than silently
    // importing one of the two.
    const adds = key !== null && fieldJoinsColumns(key);
    setMapping((prev) =>
      prev.map((current, i) => {
        if (i === index) return key;
        return !adds && key !== null && current === key ? null : current;
      }),
    );
  }

  return (
    <form
      action={action}
      // Enter inside a field would otherwise submit the import from whichever
      // step is on screen. On the Apify step it runs the actor instead, which
      // is what pressing Enter in that form plainly means.
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "TEXTAREA") return;
        e.preventDefault();
        if (step === 1 && source === "apify" && canRun) void runApify();
      }}
    >
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
      <input
        type="hidden"
        name="rows"
        value={JSON.stringify(parsed ? parsed.rows.slice(0, MAX_IMPORT_ROWS) : [])}
      />

      <WizardProgress
        steps={steps}
        current={step}
        note="Nothing is created until you confirm."
      />

      <div className="card mt-6">
        <div className="border-b border-line/60 px-6 py-4">
          <h2 className="text-sm font-medium">
            <span className="num">{step}.</span> {meta.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{meta.blurb}</p>
        </div>

        <div className="space-y-6 p-6">
          {/* ─── Step 1a — upload a CSV ─────────────────────────────────── */}
          {step === 1 && source === "csv" && (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void readFile(file);
              }}
              className={`flex cursor-pointer flex-col items-center gap-3 rounded-[10px] border border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? "border-accent bg-accent/5" : "border-line hover:bg-wash/70"
              }`}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                  // Clear the input so re-picking the same file re-reads it.
                  e.target.value = "";
                }}
              />
              <span className="btn pointer-events-none">Choose a CSV file</span>
              <span className="text-xs leading-relaxed text-muted">
                or drop it here — Apify exports, spreadsheet exports, anything
                with a header row
              </span>
            </label>
          )}

          {/* ─── Step 1b — run an Apify actor or task ────────────────────── */}
          {step === 1 && source === "apify" && (
            <>
              <div className="grid grid-cols-[150px_1fr] gap-4">
                <div>
                  <label className="field-label" htmlFor="apify-kind">
                    Run a
                  </label>
                  <select
                    id="apify-kind"
                    value={apifyKind}
                    onChange={(e) => setApifyKind(e.target.value)}
                    className="field"
                  >
                    <option value="actor">Actor</option>
                    <option value="task">Task</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="apify-id">
                    {apifyKind === "task" ? "Task ID" : "Actor ID"}
                  </label>
                  <input
                    id="apify-id"
                    value={apifyId}
                    onChange={(e) => setApifyId(e.target.value)}
                    placeholder="apimaestro~linkedin-profile-search or the 17-character ID"
                    className="field"
                  />
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="apify-input">
                  Input parameters (JSON)
                </label>
                <textarea
                  id="apify-input"
                  value={apifyInput}
                  onChange={(e) => setApifyInput(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  placeholder={APIFY_INPUT_PLACEHOLDER}
                  className="field font-mono text-xs"
                />
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Paste it from the {apifyKind}’s own input tab in the Apify
                  console. Leave it empty to run with the {apifyKind}’s
                  defaults.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {/* Primary until there are results to move on with — after
                    that Continue is the step's real action and this drops back
                    to a secondary re-run. */}
                <button
                  type="button"
                  onClick={() => void runApify()}
                  disabled={!canRun}
                  className={`${parsed ? "btn" : "btn-primary"} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {running ? "Running…" : parsed ? "Run again" : "Run and fetch results"}
                </button>
                <span className="text-xs leading-relaxed text-muted">
                  {running
                    ? "Waiting for the run to finish — this can take a couple of minutes."
                    : `The run is charged to the account the token belongs to.`}
                </span>
              </div>
            </>
          )}

          {/* Both sources report the same two ways: what went wrong, or what
              came back. */}
          {step === 1 && error && (
            <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
              <p className="text-sm font-medium text-bad">
                {source === "csv" ? "Couldn’t read that file" : "The run didn’t return anything to import"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {error}
              </p>
            </div>
          )}

          {step === 1 && parsed && (
            <div className="rounded-[10px] border border-line bg-wash/50 px-4 py-3">
              <p className="text-sm font-medium">{parsed.label}</p>
              <p className="num mt-0.5 text-xs leading-relaxed text-muted">
                {parsed.rows.length} row
                {parsed.rows.length === 1 ? "" : "s"} ·{" "}
                {parsed.headers.length} {noun}
                {parsed.headers.length === 1 ? "" : "s"} detected
              </p>
              {overCap > 0 && (
                <p className="num mt-1 text-xs leading-relaxed text-warn">
                  Only the first {MAX_IMPORT_ROWS} rows will be imported —{" "}
                  {overCap} beyond that are ignored. Narrow the run, or split
                  the file, to bring in the rest.
                </p>
              )}
            </div>
          )}

          {/* ─── Step 2 — map columns ───────────────────────────────────── */}
          {step === 2 && parsed && (
            <>
              <div className="overflow-x-auto rounded-[10px] border border-line">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th">{sourceMeta.columnHeading}</th>
                      <th className="th">First value</th>
                      <th className="th">Imports as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.headers.map((header, i) => (
                      <tr key={`${header}-${i}`} className="hover:bg-wash/70">
                        <td className="td font-medium">{header}</td>
                        <td className="td max-w-[240px] truncate text-muted">
                          {parsed.rows[0]?.[i] || "—"}
                        </td>
                        <td className="td">
                          <select
                            aria-label={`Import “${header}” as`}
                            value={mapping[i] ?? ""}
                            onChange={(e) => setColumn(i, e.target.value)}
                            className="field w-auto min-w-[200px]"
                          >
                            <option value="">Don’t import</option>
                            {IMPORT_FIELDS.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                          {/* Where a field is filled from more than one
                              column, each of them says which part of the
                              result it is, and what the two make together. */}
                          <JoinNote
                            mapping={mapping}
                            index={i}
                            row={parsed.rows[0]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-1.5">
                {IMPORT_FIELDS.filter((f) => f.hint).map((f) => (
                  <li key={f.key} className="text-xs leading-relaxed text-muted">
                    <span className="font-medium text-ink">{f.label}</span> —{" "}
                    {f.hint}
                  </li>
                ))}
                <li className="text-xs leading-relaxed text-muted">
                  <span className="font-medium text-ink">
                    {JOINING_FIELD_LABELS.join(" and ")}
                  </span>{" "}
                  — take more than one {noun}. Point both a first-name and a
                  last-name {noun} at Contact name and they are joined with a
                  space, in the order they are listed above.
                </li>
                {/* Only when the run actually produced one, so the note is
                    never an explanation of something not on screen. */}
                {parsed.headers.some(isNestedFieldHeader) && (
                  <li className="text-xs leading-relaxed text-muted">
                    <span className="font-medium text-ink">
                      A {noun} written “something → something”
                    </span>{" "}
                    — read out of the JSON list above it, from the first entry
                    carrying a value. The list itself is left in place to check
                    it against.
                  </li>
                )}
              </ul>

              {!clinicMapped && (
                <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
                  <p className="text-sm font-medium text-ink">
                    Map a {noun} to Clinic name to continue
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    It is the one field a lead cannot be created without.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ─── Step 3 — preview & confirm ─────────────────────────────── */}
          {step === 3 && parsed && (
            <>
              <div className="overflow-x-auto rounded-[10px] border border-line">
                <table className="w-full">
                  <thead>
                    <tr>
                      {previewFields.map((f) => (
                        <th key={f.key} className="th whitespace-nowrap">
                          {f.label}
                        </th>
                      ))}
                      <th className="th">Stage</th>
                      {!mapping.includes("leadSource") && (
                        <th className="th">Source</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.slice(0, IMPORT_PREVIEW_ROWS).map((lead, i) => (
                      <tr key={i}>
                        {previewFields.map((f) => (
                          <td key={f.key} className="td whitespace-nowrap">
                            <PreviewCell field={f.key} lead={lead} />
                          </td>
                        ))}
                        <td className="td whitespace-nowrap text-muted">
                          {LEAD_STAGE_LABELS[IMPORT_DEFAULT_STAGE]}
                        </td>
                        {!mapping.includes("leadSource") && (
                          <td className="td text-muted">
                            {IMPORT_DEFAULT_SOURCE}
                          </td>
                        )}
                      </tr>
                    ))}
                    {leads.length === 0 && (
                      <tr>
                        <td
                          className="td text-muted"
                          colSpan={previewFields.length + 2}
                        >
                          No rows in this file carry a clinic name.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
                <li className="num">
                  <span className="font-medium text-ink">
                    {leads.length} lead{leads.length === 1 ? "" : "s"}
                  </span>{" "}
                  ready to import — showing the first{" "}
                  {Math.min(leads.length, IMPORT_PREVIEW_ROWS)}.
                </li>
                <li>
                  A lead with the same clinic name and contact name as an
                  existing one is skipped, so re-importing the same export
                  creates nothing.
                </li>
                {repeated > 0 && (
                  <li className="num">
                    {repeated} row{repeated === 1 ? " repeats" : "s repeat"} a
                    clinic and contact already in this file — each one is
                    imported once.
                  </li>
                )}
                {unusable > 0 && (
                  <li className="num">
                    {unusable} row{unusable === 1 ? "" : "s"} will be skipped —
                    no clinic name.
                  </li>
                )}
                {overCap > 0 && (
                  <li className="num text-warn">
                    {overCap} row{overCap === 1 ? "" : "s"} past the{" "}
                    {MAX_IMPORT_ROWS}-row limit are not included.
                  </li>
                )}
                {mapping.includes("timeZone") && (
                  <li className="num">
                    {leads.filter((l) => l.timeZone === null).length} of{" "}
                    {leads.length} will import with no time zone — their
                    location carries no US state the lookup recognises. Set
                    those by hand on the lead.
                  </li>
                )}
                {mapping.includes("staffCountRaw") && (
                  <li>
                    Staff counts are stored as scraped. They suggest an ICP
                    Staff Size Fit score on the lead’s scorecard, but nothing is
                    scored until you open it and save.
                  </li>
                )}
              </ul>
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
            <span />
          )}
          {/* Two separate slots rather than one ternary, so React never reuses
              the same DOM node for both. Advancing to the last step inside the
              click handler would otherwise flip that node to type="submit"
              before the browser runs the click's default action — and the
              Continue press onto the confirm step would import the file
              without it ever being looked at. */}
          {step < 3 && (
            <button
              type="button"
              onClick={() => setStep((n) => n + 1)}
              disabled={step === 1 ? parsed === null : !clinicMapped}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {step === 3 && (
            <button
              type="submit"
              disabled={leads.length === 0}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Import {leads.length} lead{leads.length === 1 ? "" : "s"} →
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

// Says nothing at all unless this column is one of several filling the same
// field — the ordinary one-column mapping needs no explaining.
function JoinNote({
  mapping,
  index,
  row,
}: {
  mapping: ColumnMapping;
  index: number;
  row: string[] | undefined;
}) {
  const key = mapping[index];
  if (!key || !fieldJoinsColumns(key)) return null;
  const columns = mappedColumns(mapping, key);
  if (columns.length < 2) return null;

  // Built by the same helper the import uses, so this is the value that will
  // be written rather than a description of it.
  const joined = joinCells(row ?? [], columns);
  return (
    <p className="mt-1.5 text-xs leading-relaxed text-muted">
      <span className="num">
        {ordinal(columns.indexOf(index) + 1)} of {columns.length}
      </span>{" "}
      joined
      {joined !== "" && <> — “{joined}”</>}
    </p>
  );
}

function ordinal(n: number): string {
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
        ? "nd"
        : n % 10 === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

function PreviewCell({
  field,
  lead,
}: {
  field: ImportFieldKey;
  lead: ImportedLead;
}) {
  if (field === "estValue") {
    return (
      <span className="num">
        {lead.estValue != null ? fmtMoney(lead.estValue) : "—"}
      </span>
    );
  }
  if (field === "staffCountRaw") {
    // The suggested band is shown here and nowhere near the database — it is
    // what the scorecard will offer, not what the import will store.
    const suggested = suggestedStaffSizeScore(lead.staffCountRaw);
    return lead.staffCountRaw == null ? (
      <span className="text-muted">—</span>
    ) : (
      <span className="num">
        {lead.staffCountRaw}
        {suggested != null && (
          <span className="ml-1.5 text-xs text-muted">
            suggests {suggested} pt
          </span>
        )}
      </span>
    );
  }
  // The reading, not the cell: what the state came out as, over the text it
  // was read from. A location the parser couldn't place shows the text with no
  // zone against it, which is the row to look at before confirming.
  if (field === "timeZone") {
    return (
      <span className="block max-w-[220px]">
        {lead.timeZone ? (
          zoneLabel(lead.timeZone)
        ) : (
          <span className="text-muted">no zone read</span>
        )}
        {lead.location && (
          <span className="block truncate text-xs text-muted">
            {lead.location}
          </span>
        )}
      </span>
    );
  }
  if (field === "linkedinUrl" || field === "companyLinkedinUrl") {
    const value = lead[field];
    return value ? (
      <span className="block max-w-[220px] truncate text-muted">{value}</span>
    ) : (
      <span className="text-muted">—</span>
    );
  }
  const value = lead[field];
  return typeof value === "string" && value !== "" ? (
    <span className={field === "clinicName" ? "font-medium" : "text-muted"}>
      {value}
    </span>
  ) : (
    <span className="text-muted">—</span>
  );
}
