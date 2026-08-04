"use client";

// The CSV lead import — upload, map, preview, confirm.
//
// The file never leaves the browser until the last step: it is parsed here so
// the real headers can be shown and mapped, and only the rows plus the
// confirmed mapping are posted. Nothing about the columns is guessed — every
// column starts unmapped, because the whole point is that two Apify actors
// scraping the same thing export different headers in a different order.
//
// Like the other wizards in the app, the visible controls are unnamed and
// bound to state; two hidden inputs carry the payload into the post.

import { useMemo, useState } from "react";
import { parseCsv } from "@/lib/csv";
import {
  ColumnMapping,
  IMPORT_DEFAULT_SOURCE,
  IMPORT_DEFAULT_STAGE,
  IMPORT_FIELDS,
  IMPORT_PREVIEW_ROWS,
  IMPORT_WIZARD_STEPS,
  ImportFieldKey,
  ImportedLead,
  MAX_IMPORT_ROWS,
  dedupeKey,
  isImportFieldKey,
  mapRow,
  mappedColumn,
} from "@/lib/leadImport";
import { LEAD_STAGE_LABELS } from "@/lib/constants";
import { suggestedStaffSizeScore } from "@/lib/icp";
import { fmtMoney } from "@/lib/format";
import WizardProgress from "@/components/WizardProgress";

interface Parsed {
  fileName: string;
  headers: string[];
  rows: string[][];
}

export default function LeadImportWizard({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const meta = IMPORT_WIZARD_STEPS[step - 1];
  const clinicMapped = mappedColumn(mapping, "clinicName") !== -1;

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
      setParsed({ fileName: file.name, headers: table.headers, rows: table.rows });
      // A new file means new columns — start every one of them unmapped.
      setMapping(table.headers.map(() => null));
    } catch {
      setParsed(null);
      setMapping([]);
      setError("That file could not be read as CSV.");
    }
  }

  function setColumn(index: number, value: string) {
    const key = isImportFieldKey(value) ? value : null;
    setMapping((prev) =>
      prev.map((current, i) => {
        if (i === index) return key;
        // A field fills exactly one column — pointing a second column at it
        // releases the first rather than silently importing one of the two.
        return key !== null && current === key ? null : current;
      }),
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
      <input
        type="hidden"
        name="rows"
        value={JSON.stringify(parsed ? parsed.rows.slice(0, MAX_IMPORT_ROWS) : [])}
      />

      <WizardProgress
        steps={IMPORT_WIZARD_STEPS}
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
          {/* ─── Step 1 — upload ────────────────────────────────────────── */}
          {step === 1 && (
            <>
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

              {error && (
                <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
                  <p className="text-sm font-medium text-bad">
                    Couldn’t read that file
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {error}
                  </p>
                </div>
              )}

              {parsed && (
                <div className="rounded-[10px] border border-line bg-wash/50 px-4 py-3">
                  <p className="text-sm font-medium">{parsed.fileName}</p>
                  <p className="num mt-0.5 text-xs leading-relaxed text-muted">
                    {parsed.rows.length} row
                    {parsed.rows.length === 1 ? "" : "s"} ·{" "}
                    {parsed.headers.length} column
                    {parsed.headers.length === 1 ? "" : "s"} detected
                  </p>
                  {overCap > 0 && (
                    <p className="num mt-1 text-xs leading-relaxed text-warn">
                      Only the first {MAX_IMPORT_ROWS} rows will be imported —{" "}
                      {overCap} beyond that are ignored. Split the file to bring
                      in the rest.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* ─── Step 2 — map columns ───────────────────────────────────── */}
          {step === 2 && parsed && (
            <>
              <div className="overflow-x-auto rounded-[10px] border border-line">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th">CSV column</th>
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
              </ul>

              {!clinicMapped && (
                <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
                  <p className="text-sm font-medium text-ink">
                    Map a column to Clinic name to continue
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
