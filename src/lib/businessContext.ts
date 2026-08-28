// Business context — the standing description of this agency that the copilot
// is given before anything else.
//
// Everything the copilot knows about the *records* it looks up (see
// src/lib/copilotLookups.ts). This is the other half: what it should know about
// the business those records belong to — how the agency makes money, who it is
// for, how it talks, and the rules it must never break. None of that is in the
// database as data, and none of it is worth re-typing into every question.
//
// Prose rather than fields, on purpose. A form with "positioning" and "tone" as
// inputs would be a guess at what matters; a page somebody writes on is not.
// The template below is scaffolding for that page and nothing more — it is
// offered as the starting text, never stored on anybody's behalf, and a body
// that is still nothing but headings counts as empty (see hasBusinessContext).
//
// Pure, and safe to import from a client component: no database, no clock, no
// network. The row lives in src/lib/businessContextStore.ts and the prompt is
// composed in src/lib/copilot.ts.

// One business, one row — the id PipelineSettings and AppSecrets already use.
export const BUSINESS_CONTEXT_ID = "singleton";

// A ceiling on what goes into every conversation. Generous for a page of
// standing context — comfortably more than anybody writes by hand — and low
// enough that this cannot quietly become a document that costs a fortune to
// carry on every question. Enforced on save, so the limit is visible at the
// place it applies rather than silently truncating a model call later.
export const BUSINESS_CONTEXT_MAX_CHARS = 16000;

// What an empty page opens on. Comment lines, because they are headings rather
// than content: whatever survives is prose under a heading, and a section
// nobody filled in reads as an empty heading rather than as a claim about the
// business.
//
// Deliberately short. Five prompts somebody can answer in ten minutes beats a
// questionnaire nobody finishes, and anything else worth telling the model can
// simply be typed underneath.
export const BUSINESS_CONTEXT_TEMPLATE = [
  "# Business model",
  "",
  "# ICP summary",
  "",
  "# Positioning",
  "",
  "# Tone / voice",
  "",
  "# Compliance rules to always follow",
  "",
].join("\n");

// Whether there is anything here worth sending.
//
// A body of nothing but blank lines and headings is the template as it was
// handed over, which says nothing about this business — so it counts as empty
// and the prompt is built without it. That is what makes "save the template
// untouched" harmless rather than a page of filler on every question.
export function hasBusinessContext(body: string | null | undefined): boolean {
  if (!body) return false;
  return body
    .split("\n")
    .some((line) => line.trim() !== "" && !line.trim().startsWith("#"));
}

// One newline. A textarea posts CRLF — the HTML form specification says so —
// while the same text in the browser's own state is LF, so a body stored as it
// arrived would never again equal the box it came from, and the page would
// claim unsaved changes forever. It also spares the model a page of stray
// carriage returns. Applied on the way in and on both sides of the comparison,
// so a row written before this existed reads back the same way.
export function normaliseBody(body: string): string {
  return body.replace(/\r\n/g, "\n");
}

// What the browser posted, held to what it is allowed to be. Newlines
// normalised, trimmed at both ends and capped; the text between is stored
// exactly as it was typed, headings and all, because the model reads its
// structure.
export function readBusinessContext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return normaliseBody(value).trim().slice(0, BUSINESS_CONTEXT_MAX_CHARS);
}

// What the Settings page is served. The body itself — unlike a credential,
// this is text the operator wrote and is meant to edit — plus when it was last
// written, which is the only way to tell a saved page from an unsaved one.
export interface BusinessContextState {
  body: string;
  updatedAt: Date | null;
}
