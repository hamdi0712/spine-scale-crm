// What an Apify actor or task is called, and what counts as one.
//
// Split out of src/lib/apify.ts, which is server-only because it reads the API
// token: this half is pure and is needed in two places that must never pull
// that module in — the Pipeline Settings form, where somebody types an actor ID
// and should be told it is malformed before pressing Save, and the settings
// reader that holds a stored ID to the same standard on the way back out.

export const APIFY_SOURCE_KINDS = ["actor", "task"] as const;

export type ApifySourceKind = (typeof APIFY_SOURCE_KINDS)[number];

// Actor and task ids are either the 17-character id or `username~name`. The
// console shows the latter with a slash, so a pasted `username/name` is
// accepted and normalised. Anything outside this shape is refused rather than
// pasted into the URL — the id is a path segment, and a path segment is not
// somewhere to put unvalidated input.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9~._-]{0,127}$/;

export function normalizeApifyId(raw: string): string | null {
  const id = raw.trim().replace(/^\/+|\/+$/g, "").replace(/\//g, "~");
  return ID_PATTERN.test(id) ? id : null;
}

export function isApifySourceKind(v: unknown): v is ApifySourceKind {
  return (
    typeof v === "string" && APIFY_SOURCE_KINDS.includes(v as ApifySourceKind)
  );
}
