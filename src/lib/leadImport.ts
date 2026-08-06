// Bulk lead import — everything the CSV wizard and its server action agree on.
//
// The import is deliberately source-agnostic. It was built for Apify LinkedIn
// scrapes, but different actors export different headers in a different order,
// so nothing here matches on column names: the user maps each detected column
// onto a Lead field by hand, and this module only knows how to read a row once
// that mapping exists. Adding another source is a mapping, not a code change.
//
// Both sides of the import share these helpers, so the preview the user
// confirms is produced by exactly the code that writes the rows.

// Where every imported lead starts. Stage is always New — an import is the top
// of the funnel by definition — and the source is LinkedIn unless the CSV
// carries its own source column with something in it.
export const IMPORT_DEFAULT_STAGE = "NEW";
export const IMPORT_DEFAULT_SOURCE = "LinkedIn";

export interface ImportField {
  key: ImportFieldKey;
  label: string;
  hint?: string;
}

export const IMPORT_FIELD_KEYS = [
  "clinicName",
  "contactName",
  "phone",
  "email",
  "leadSource",
  "linkedinUrl",
  "companyLinkedinUrl",
  "staffCountRaw",
  "estValue",
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELD_KEYS)[number];

export const IMPORT_FIELDS: ImportField[] = [
  {
    key: "clinicName",
    label: "Clinic name",
    hint: "Required — a row with no clinic name is skipped.",
  },
  { key: "contactName", label: "Contact name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  {
    key: "leadSource",
    label: "Lead source",
    hint: `Leave unmapped to stamp every row “${IMPORT_DEFAULT_SOURCE}”.`,
  },
  { key: "linkedinUrl", label: "LinkedIn URL" },
  { key: "companyLinkedinUrl", label: "Company LinkedIn URL" },
  {
    key: "staffCountRaw",
    label: "Staff count",
    hint: "Read as a whole number — a range like “11-50” takes the lower end.",
  },
  { key: "estValue", label: "Est. deal value ($/mo)" },
];

export const IMPORT_FIELD_LABELS: Record<ImportFieldKey, string> =
  Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, f.label])) as Record<
    ImportFieldKey,
    string
  >;

// Rows shown in the confirm step. The rest are still imported.
export const IMPORT_PREVIEW_ROWS = 5;

// A guard rail rather than a real limit — the whole payload travels through
// one form post, and an accidental 50k-row export should be caught here rather
// than half way through writing it.
export const MAX_IMPORT_ROWS = 1000;

// The two ways rows get into the wizard. Everything after step 1 is identical
// between them, so the source only changes that step and the noun the mapping
// step uses for the things it is mapping.
export const IMPORT_SOURCES = ["csv", "apify"] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number];

interface ImportSourceMeta {
  step1Title: string;
  step1Blurb: string;
  mapTitle: string;
  columnHeading: string;
}

export const IMPORT_SOURCE_META: Record<ImportSource, ImportSourceMeta> = {
  csv: {
    step1Title: "Upload CSV",
    step1Blurb:
      "Any CSV export — the columns are read off the file itself, in whatever order they came in.",
    mapTitle: "Map columns",
    columnHeading: "CSV column",
  },
  apify: {
    step1Title: "Run the actor",
    step1Blurb:
      "The run happens on the server, with the API token that never leaves it. Its results come back here to be mapped.",
    mapTitle: "Map fields",
    columnHeading: "Dataset field",
  },
};

export function importWizardSteps(source: ImportSource) {
  const meta = IMPORT_SOURCE_META[source];
  return [
    { n: 1, title: meta.step1Title, blurb: meta.step1Blurb },
    {
      n: 2,
      title: meta.mapTitle,
      blurb:
        "Point each one at the field it fills. Anything left unmapped is ignored.",
    },
    {
      n: 3,
      title: "Preview & confirm",
      blurb:
        "The first rows exactly as they will be created. Nothing is saved until you confirm.",
    },
  ];
}

// What a source hands the wizard: the columns it detected and the rows behind
// them, whatever the source was. A CSV produces this from its header row; an
// Apify run produces it from the keys of the dataset items. Everything past
// step 1 — mapping, preview, confirm — only ever sees this shape, which is why
// there is one wizard and not two.
//
// Declared here rather than beside the Apify client because a "use server"
// module can export nothing but async functions, and the browser needs the
// type. Nothing in this file touches the network or the token.
export type ApifyFetchResult =
  | { ok: true; label: string; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

// Some actors keep the thing worth mapping inside a nested list rather than in
// a field of its own — a LinkedIn profile scrape returns the employer as
// currentPositions[0].companyName, and flattening leaves that column holding a
// JSON blob nobody can map onto Clinic name. So the Apify side pulls those
// values out into columns of their own, named "<source> → <what was pulled
// out>". The separator is a character that cannot appear in a dotted path, so
// a derived column is never confused with one the actor really returned.
//
// Declared here rather than beside the Apify client because the mapping step
// runs in the browser and explains these columns, and nothing client-side may
// import the server-only module.
export const NESTED_FIELD_SEPARATOR = " → ";

export function isNestedFieldHeader(header: string): boolean {
  return header.includes(NESTED_FIELD_SEPARATOR);
}

// The two things an Apify import needs from the user, and the placeholder that
// shows what the second one looks like.
export const APIFY_INPUT_PLACEHOLDER = `{
  "searchQuery": "chiropractor",
  "location": "Austin, TX",
  "maxResults": 100
}`;

// One entry per detected column, in header order: the Lead field that column
// fills, or null for "don't import". Column-indexed rather than field-indexed
// because that is the shape the mapping step edits.
export type ColumnMapping = (ImportFieldKey | null)[];

export interface ImportedLead {
  clinicName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  leadSource: string;
  linkedinUrl: string | null;
  companyLinkedinUrl: string | null;
  staffCountRaw: number | null;
  estValue: number | null;
}

export function isImportFieldKey(v: unknown): v is ImportFieldKey {
  return (
    typeof v === "string" && IMPORT_FIELD_KEYS.includes(v as ImportFieldKey)
  );
}

// Parses whatever came back over the wire into a mapping of the given width.
// Anything unrecognised becomes "don't import" rather than throwing — a column
// the user never touched and a column carrying junk are the same thing here.
export function readMapping(raw: unknown, width: number): ColumnMapping {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: width }, (_, i) =>
    isImportFieldKey(list[i]) ? list[i] : null,
  );
}

export function mappedColumn(
  mapping: ColumnMapping,
  key: ImportFieldKey,
): number {
  return mapping.indexOf(key);
}

// Reads one CSV row through the mapping. Returns null for a row with no clinic
// name — there is no lead to create without one.
export function mapRow(
  row: string[],
  mapping: ColumnMapping,
): ImportedLead | null {
  const cell = (key: ImportFieldKey): string => {
    const i = mappedColumn(mapping, key);
    return i === -1 ? "" : (row[i] ?? "").trim();
  };

  const clinicName = cell("clinicName");
  if (clinicName === "") return null;

  return {
    clinicName,
    contactName: blankToNull(cell("contactName")),
    phone: blankToNull(cell("phone")),
    email: blankToNull(cell("email")),
    leadSource: cell("leadSource") || IMPORT_DEFAULT_SOURCE,
    linkedinUrl: blankToNull(cell("linkedinUrl")),
    companyLinkedinUrl: blankToNull(cell("companyLinkedinUrl")),
    staffCountRaw: parseCount(cell("staffCountRaw")),
    estValue: parseAmount(cell("estValue")),
  };
}

function blankToNull(v: string): string | null {
  return v === "" ? null : v;
}

// Headcount as scraped, which is rarely a bare integer: "51", "1,200
// employees", "11-50". The first number wins, so a banded range reports its
// lower end — the conservative read, and the one the preview shows before
// anything is created.
export function parseCount(v: string): number | null {
  const match = v.replace(/,/g, "").match(/\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

// Money as typed by whoever built the sheet — "$1,500", "1500.00", "1 500".
export function parseAmount(v: string): number | null {
  const cleaned = v.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// The duplicate test: same clinic and same contact. Case- and
// whitespace-insensitive so a re-export of the same list matches its own
// earlier import, and used both against existing leads and within the batch.
export function dedupeKey(
  clinicName: string,
  contactName: string | null | undefined,
): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  // Joined on a character that cannot appear in either half, so the two
  // never run together into a match neither of them makes on its own.
  return `${norm(clinicName)}\u0000${norm(contactName ?? "")}`;
}

export interface ImportSummary {
  created: number;
  duplicates: number;
  skipped: number;
}
