// Single-lead enrichment — everything the enrich panel and its server action
// agree on.
//
// The bulk import (src/lib/leadImport.ts) turns an Apify run into new leads.
// This turns one into detail on a lead that already exists: the same run, the
// same flattened fields, the same hand-made mapping — pointed at one record
// instead of creating any. That difference is the whole module. Nothing here
// can create a lead, and the fields below are the only ones it can write.
//
// Both sides share these helpers, so what the panel previews is produced by
// exactly the code that writes it.

import { parseCount } from "@/lib/leadImport";

// A single-lead lookup should return a single record, but actors are not
// obliged to agree — a search actor asked for one clinic may still hand back a
// page of them. A handful are fetched so the panel can say how many came back
// and which one it is reading; a thousand would just be a bill.
export const MAX_ENRICH_ITEMS = 10;

// The mapping targets, and the Lead fields behind them. Deliberately short:
// enrichment adds evidence about a lead, and anything that would change who
// the lead *is* — the clinic name, the contact, the stage — is not on this
// list and cannot be reached from this flow.
export const ENRICH_FIELD_KEYS = [
  "staffCountRaw",
  "metaAdsSignal",
  "reviewCount",
  "websiteNotes",
] as const;

export type EnrichFieldKey = (typeof ENRICH_FIELD_KEYS)[number];

export interface EnrichField {
  key: EnrichFieldKey;
  label: string;
  hint: string;
}

export const ENRICH_FIELDS: EnrichField[] = [
  {
    key: "staffCountRaw",
    label: "Staff count",
    hint: "Read as a whole number — a range like “11-50” takes the lower end.",
  },
  {
    key: "metaAdsSignal",
    label: "Meta ads signal",
    hint: "Free text, stored as it reads — “3 active ads, running 4mo”.",
  },
  {
    key: "reviewCount",
    label: "Review count",
    hint: "Read as a whole number, and stamped with the time it was written so it can be seen going stale.",
  },
  {
    key: "websiteNotes",
    label: "Website notes",
    hint: "Long text is kept whole — crawled page copy belongs here rather than in the activity log.",
  },
];

export const ENRICH_FIELD_LABELS: Record<EnrichFieldKey, string> =
  Object.fromEntries(ENRICH_FIELDS.map((f) => [f.key, f.label])) as Record<
    EnrichFieldKey,
    string
  >;

export function enrichWizardSteps() {
  return [
    {
      n: 1,
      title: "Run the actor",
      blurb:
        "The run happens on the server, with the API token that never leaves it. Its results come back here to be mapped.",
    },
    {
      n: 2,
      title: "Map & confirm",
      blurb:
        "Point each detected field at what it fills on this lead. Anything left unmapped is ignored, and nothing is written until you confirm.",
    },
  ];
}

// One entry per detected field, in field order: what it fills on this lead, or
// null for "don't import". The same shape as the import's ColumnMapping and
// for the same reason — it is the shape the mapping step edits — but each
// target takes exactly one field here. Two source fields joined into one value
// is a bulk-import affordance for split names, and nothing on this list is a
// name.
export type EnrichMapping = (EnrichFieldKey | null)[];

export function isEnrichFieldKey(v: unknown): v is EnrichFieldKey {
  return (
    typeof v === "string" && ENRICH_FIELD_KEYS.includes(v as EnrichFieldKey)
  );
}

// Parses whatever came back over the wire into a mapping of the given width.
// Anything unrecognised becomes "don't import" rather than throwing — a field
// the user never touched and a field carrying junk are the same thing here.
export function readEnrichMapping(raw: unknown, width: number): EnrichMapping {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: width }, (_, i) =>
    isEnrichFieldKey(list[i]) ? list[i] : null,
  );
}

// What one run, read through one mapping, would write. A key missing from this
// object is a field the update will not touch at all — which is the difference
// between "the actor had nothing to say about the staff count" and "the staff
// count is nothing", and the reason enrichment can never blank a field that
// somebody filled in by hand.
export type EnrichUpdate = Partial<{
  staffCountRaw: number;
  metaAdsSignal: string;
  reviewCount: number;
  websiteNotes: string;
}>;

export function mapEnrichRow(row: string[], mapping: EnrichMapping): EnrichUpdate {
  const cell = (key: EnrichFieldKey): string => {
    const i = mapping.indexOf(key);
    return i === -1 ? "" : (row[i] ?? "").trim();
  };

  const update: EnrichUpdate = {};

  const staff = parseCount(cell("staffCountRaw"));
  if (staff !== null) update.staffCountRaw = staff;

  const ads = cell("metaAdsSignal");
  if (ads !== "") update.metaAdsSignal = ads;

  const reviews = parseCount(cell("reviewCount"));
  if (reviews !== null) update.reviewCount = reviews;

  const notes = cell("websiteNotes");
  if (notes !== "") update.websiteNotes = notes;

  return update;
}

export function enrichFieldsWritten(update: EnrichUpdate): EnrichFieldKey[] {
  return ENRICH_FIELD_KEYS.filter((key) => update[key] !== undefined);
}

// ─── Reading it back ───────────────────────────────────────────────────────

// How long a review count stands before the lead page starts saying so. Not a
// deletion and not a validity limit — the number is whatever it was on the day
// it was read, and this is only the point at which quoting it in a call
// deserves a second look first.
export const REVIEWS_STALE_AFTER_DAYS = 30;

export function reviewsAreStale(
  checkedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!checkedAt) return false;
  const days = (now.getTime() - checkedAt.getTime()) / (24 * 60 * 60 * 1000);
  return days >= REVIEWS_STALE_AFTER_DAYS;
}
