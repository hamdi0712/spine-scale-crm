// Where a candidate came from — the values actually stored, grouped.
//
// Source is a free-text column, and deliberately: the CSV import maps a column
// to it, so a candidate can arrive stamped with anything the sheet said. That
// rules out a fixed list of options — a filter offering "LinkedIn" and
// "Added by name" would silently hide every candidate whose sheet said
// "Apollo export".
//
// So the options are derived from the rows on screen, exactly as the batch
// filter derives its own (src/lib/discoveryBatch.ts). What the app writes
// itself is two values — IMPORT_DEFAULT_SOURCE for a bulk import that mapped
// no source column, and ADD_BY_NAME_SOURCE for the by-name form — and both
// simply appear in the list like any other.
//
// Pure, and grouped case-insensitively: "LinkedIn" and "linkedin" are one
// source with one count, listed under whichever spelling was seen first.

export const SOURCE_ALL = "ALL";

// Candidates carrying no source at all. A sentinel rather than "" so it is a
// real choice — a blank source column is a thing worth being able to look for
// — and one no stored value can collide with.
export const SOURCE_NONE = " none";
export const SOURCE_NONE_LABEL = "No source";

export interface SourceOption {
  value: string;
  label: string;
  count: number;
}

// Every source on a set of candidates, commonest first, with the count in
// each. Frequency rather than alphabetical because the useful thing about this
// list is which handful of sources the list is mostly made of; ties fall back
// to the label so the order is stable between renders.
export function sourceOptions(
  candidates: { source: string | null }[],
): SourceOption[] {
  const groups = new Map<string, { label: string; count: number }>();
  for (const candidate of candidates) {
    const value = sourceKey(candidate.source);
    const existing = groups.get(value);
    if (existing) {
      existing.count++;
    } else {
      groups.set(value, {
        label: candidate.source?.trim() || SOURCE_NONE_LABEL,
        count: 1,
      });
    }
  }
  return Array.from(groups, ([value, group]) => ({ value, ...group })).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

// The value a candidate is filed under, and the value the dropdown selects by.
// Lower-cased so two spellings of one source are one option, and one option
// matches both.
export function sourceKey(source: string | null | undefined): string {
  const trimmed = (source ?? "").trim();
  return trimmed === "" ? SOURCE_NONE : trimmed.toLowerCase();
}
