// Apify — the live half of the discovery import, and every enrichment run.
//
// Server-only: the token is read here on every run — from the AppSecrets row if
// one is set, from APIFY_API_TOKEN if not (src/lib/appSecretsStore.ts) — sent
// as a bearer header, and never returned to the browser in any form. Nothing in
// this file may be imported from a client component; the wizard talks to it
// through the server action in src/lib/actions/apify.ts, which hands back
// mapped rows and plain error text and nothing else.
//
// One call does the whole job: run-sync-get-dataset-items starts the run,
// waits for it, and returns the dataset in the response. That is why the
// import can be a single button press rather than a polling loop — and why a
// long-running actor comes back as a timeout rather than a background job.

import {
  ApifyFetchResult,
  MAX_IMPORT_ROWS,
  NESTED_FIELD_SEPARATOR,
} from "@/lib/discoveryImport";
import { ApifySourceKind, normalizeApifyId } from "@/lib/apifyId";
import { getApifyApiToken } from "@/lib/appSecretsStore";

// Re-exported so every existing caller still imports these from here. Their
// definitions moved to src/lib/apifyId.ts, which is pure — the settings form
// validates an actor ID as it is typed, and must not pull this module (and the
// token it reads) toward the browser to do it.
export {
  APIFY_SOURCE_KINDS,
  isApifySourceKind,
  normalizeApifyId,
} from "@/lib/apifyId";
export type { ApifySourceKind } from "@/lib/apifyId";

// The smallest run cost Apify will accept a cap at. A pay-per-event actor is
// capped in money rather than in results, and asking for a ceiling below this
// is refused before the run starts — "Maximum cost per run is less than the
// allowed minimum of $0.50" — rather than run more cheaply.
//
// It is a ceiling and not a price. A search that costs a fraction of a cent
// still costs a fraction of a cent with this set; what the number buys is a
// run that starts, and a bound on what one runaway run can spend.
export const APIFY_MIN_CHARGE_USD = 0.5;

// How long the actor itself is allowed to run, and how long we wait on the
// socket. The client timeout sits above the run timeout so a run that hits its
// own limit reports the actor's failure rather than our abort.
export const APIFY_RUN_TIMEOUT_SECONDS = 120;
const APIFY_CLIENT_TIMEOUT_MS = (APIFY_RUN_TIMEOUT_SECONDS + 15) * 1000;

const API_BASE = "https://api.apify.com/v2";

export async function runApifySync({
  kind,
  id,
  input,
  // How many dataset items to ask for and keep. The bulk import wants the
  // whole run; enriching one record wants the handful it takes to see what came
  // back. Never taken from the browser — each caller states its own ceiling.
  maxItems = MAX_IMPORT_ROWS,
  // What this run is allowed to cost, in US dollars, for an actor that bills
  // per event rather than per result. See the note above APIFY_MIN_CHARGE_USD:
  // an actor billed that way has to be capped in money, and capping it in
  // items — which is what maxItems does — is what Apify refuses outright.
  //
  // Left unset for every actor that bills per result, which is all four of the
  // enrichment ones and both bulk imports: for those, maxItems is both the
  // ceiling worth having and the one Apify wants.
  maxTotalChargeUsd,
}: {
  kind: ApifySourceKind;
  id: string;
  input: string;
  maxItems?: number;
  maxTotalChargeUsd?: number;
}): Promise<ApifyFetchResult> {
  // Database first, .env second — see src/lib/appSecretsStore.ts. Read per run
  // rather than once at import, so a token changed on the Settings page applies
  // to the very next actor call without a restart.
  const token = await getApifyApiToken();
  if (!token) {
    return {
      ok: false,
      error:
        "No Apify API token is set. Add one under Settings → API Keys, or set APIFY_API_TOKEN in the .env file.",
    };
  }

  const actorId = normalizeApifyId(id);
  if (!actorId) {
    return {
      ok: false,
      error: `That does not look like an ${kind} ID. Use the 17-character ID or the username~name form shown in the Apify console.`,
    };
  }

  let parsedInput: unknown;
  try {
    parsedInput = input.trim() === "" ? {} : JSON.parse(input);
  } catch {
    return {
      ok: false,
      error: "The input parameters are not valid JSON. Check for a trailing comma or an unquoted key.",
    };
  }
  if (
    parsedInput === null ||
    typeof parsedInput !== "object" ||
    Array.isArray(parsedInput)
  ) {
    return {
      ok: false,
      error: "The input parameters must be a JSON object, e.g. {\"searchQuery\": \"chiropractor\"}.",
    };
  }

  // How the run is capped, and it is one or the other rather than both.
  //
  // maxItems is a cap in *results*, and on a pay-per-result actor Apify reads
  // it as the cost ceiling too — the two are the same number there. On a
  // pay-per-event actor there is no per-result price for it to multiply, so
  // sending it caps a run at a cost Apify computes as far below its own
  // minimum and the run is refused before it starts. Those actors are capped
  // in money instead, and how many results come back is settled by the input
  // and by limit.
  //
  // limit is on both paths regardless: it is the dataset read, not the run,
  // and it is what stops a chatty actor's whole output being parsed to answer
  // a question the first few items answer.
  const cap =
    maxTotalChargeUsd === undefined
      ? `maxItems=${maxItems}`
      : `maxTotalChargeUsd=${chargeCap(maxTotalChargeUsd)}`;
  const path = kind === "task" ? "actor-tasks" : "acts";
  const url =
    `${API_BASE}/${path}/${encodeURIComponent(actorId)}/run-sync-get-dataset-items` +
    `?timeout=${APIFY_RUN_TIMEOUT_SECONDS}&${cap}&limit=${maxItems}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        // Bearer rather than ?token= so the credential never lands in a URL,
        // where proxies and server logs would keep a copy of it.
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsedInput),
      signal: AbortSignal.timeout(APIFY_CLIENT_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { ok: false, error: timeoutMessage() };
    }
    return {
      ok: false,
      error:
        "Could not reach Apify. Check the server's network connection and try again.",
    };
  }

  if (!response.ok) {
    return { ok: false, error: await errorMessage(response, kind) };
  }

  let items: unknown;
  try {
    items = await response.json();
  } catch {
    return {
      ok: false,
      error: "Apify returned something that is not JSON. Try the run again.",
    };
  }
  if (!Array.isArray(items)) {
    return {
      ok: false,
      error: "Apify returned no dataset for that run.",
    };
  }
  if (items.length === 0) {
    return {
      ok: false,
      error:
        "The run finished but its dataset is empty. Check the input parameters — a search that matches nothing returns no items.",
    };
  }

  const table = itemsToTable(items, maxItems);
  if (table.headers.length === 0) {
    return {
      ok: false,
      error:
        "The run returned items with no fields to map. Check that this actor outputs one object per record.",
    };
  }
  return {
    ok: true,
    label: `${table.rows.length} item${table.rows.length === 1 ? "" : "s"} from ${actorId}`,
    headers: table.headers,
    rows: table.rows,
  };
}

// The cost ceiling as Apify will take it: never below the platform minimum,
// because a cap under it is a run that does not start, and rounded to cents
// because that is the unit the ceiling is expressed in. Held here rather than
// at the call sites so no caller can set one Apify refuses.
function chargeCap(usd: number): string {
  const wanted = Number.isFinite(usd) ? usd : APIFY_MIN_CHARGE_USD;
  return Math.max(APIFY_MIN_CHARGE_USD, Math.round(wanted * 100) / 100).toFixed(2);
}

function timeoutMessage(): string {
  return `The run did not finish within ${APIFY_RUN_TIMEOUT_SECONDS} seconds and was given up on. Narrow the input — a smaller result count, fewer pages — or run it in the Apify console and import the CSV export instead.`;
}

// Apify reports failures as { error: { type, message } }. The message is the
// actor's or the platform's own text and carries no credential, so it is worth
// passing through under a heading that says what to do about it.
async function errorMessage(
  response: Response,
  kind: ApifySourceKind,
): Promise<string> {
  let type = "";
  let detail = "";
  try {
    const body = (await response.json()) as {
      error?: { type?: string; message?: string };
    };
    type = body?.error?.type ?? "";
    detail = body?.error?.message ?? "";
  } catch {
    // A non-JSON body tells us nothing beyond the status code.
  }
  const suffix = detail ? ` Apify said: ${detail}` : "";

  if (response.status === 401 || type.includes("token")) {
    return `Apify rejected the API token. Check it under Settings → API Keys — it may be mistyped, revoked, or from another account.${suffix}`;
  }
  if (
    response.status === 402 ||
    response.status === 403 ||
    type.includes("limit") ||
    type.includes("usage")
  ) {
    return `This account is out of Apify credits, so the run was refused. Wait for the free tier to reset, upgrade the plan, or import a CSV export instead.${suffix}`;
  }
  if (response.status === 404) {
    return `No ${kind} with that ID exists on this account. Check the ID, and that the ${kind} is shared with the token's account.${suffix}`;
  }
  if (response.status === 408) {
    return timeoutMessage();
  }
  if (response.status === 400) {
    return `The run failed to start — Apify would not accept that input. Check the parameters against the ${kind}'s input schema.${suffix}`;
  }
  return `The ${kind} run failed (HTTP ${response.status}).${suffix}`;
}

// Dataset items are JSON objects whose shape is the actor's business, not
// ours — so they are flattened to a table of dotted paths and the user maps
// whichever of them mean something, exactly as with CSV headers. Every item
// contributes its keys, because actors routinely omit a field on the records
// that have nothing for it.
export function itemsToTable(
  items: unknown[],
  limit: number,
): { headers: string[]; rows: string[][] } {
  const headers: string[] = [];
  const seen = new Set<string>();
  const flattened: Record<string, string>[] = [];

  for (const item of items.slice(0, limit)) {
    const flat = withNestedFields(flatten(item));
    flattened.push(flat);
    for (const key of Object.keys(flat)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  return {
    headers,
    rows: flattened.map((flat) => headers.map((h) => flat[h] ?? "")),
  };
}

// Lists of objects that a mapping cannot use as they stand, and the property
// inside them that it can. flatten() leaves such a list as one cell of JSON —
// honest, but unmappable: nobody can point Clinic name at
// [{"companyName":"Austin Spine",…}]. Each rule here says which property to
// lift out of the list, and the lifted value is offered as a column of its own
// beside the raw one.
//
// This is a short list on purpose. It exists because the LinkedIn profile
// actors put the employer in currentPositions rather than in a field of its
// own, not as a general query language — an actor nesting something else is a
// new entry here, and everything else stays a mapping rather than a code
// change.
const NESTED_FIELD_RULES: { list: string; property: string; label: string }[] = [
  { list: "currentPositions", property: "companyName", label: "company name" },
];

// Adds the derived columns to one flattened item, each immediately after the
// list it was pulled out of, so the mapping step shows the two next to each
// other. A rule that finds nothing adds no column at all: headers are the
// union of the keys the items actually produced, so a dataset without
// currentPositions never grows a currentPositions column.
function withNestedFields(flat: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(flat)) {
    out[key] = value;
    // Matched on the last path segment, so a list nested under an object —
    // profile.currentPositions — is picked up the same as a top-level one.
    const leaf = key.slice(key.lastIndexOf(".") + 1);
    for (const rule of NESTED_FIELD_RULES) {
      if (leaf !== rule.list) continue;
      const extracted = firstEntryValue(value, rule.property);
      if (extracted !== null) {
        out[`${key}${NESTED_FIELD_SEPARATOR}${rule.label}`] = extracted;
      }
    }
  }
  return out;
}

// The property as it reads on the first entry of the JSON list — the current
// employer, the current company, whichever the actor listed first. Entries
// that carry nothing for it are stepped over rather than ending the search: a
// profile whose first position predates the company name being recorded still
// has one further down, and a blank column would look like a candidate with no
// clinic rather than a scrape that needed one more line read.
//
// Returns null — no column — rather than "" when the list holds nothing
// usable, so a dataset where this never lands doesn't gain an empty column.
function firstEntryValue(json: string, property: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Not a list at all: some other field happens to share the name.
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const value = (entry as Record<string, unknown>)[property];
    if (typeof value === "string") {
      if (value.trim() !== "") return value.trim();
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return null;
}

const MAX_DEPTH = 3;

function flatten(value: unknown, prefix = "", depth = 0): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object") {
    return prefix === "" ? {} : { [prefix]: String(value) };
  }
  if (Array.isArray(value)) {
    // A list of plain values reads fine as a joined cell; a list of objects
    // does not, and is left as JSON for whoever wants to look at it.
    const primitives = value.every((v) => v === null || typeof v !== "object");
    if (prefix === "") return {};
    return {
      [prefix]: primitives
        ? value.filter((v) => v !== null && v !== undefined).join(", ")
        : JSON.stringify(value),
    };
  }
  if (depth >= MAX_DEPTH) {
    return prefix === "" ? {} : { [prefix]: JSON.stringify(value) };
  }

  const out: Record<string, string> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flatten(nested, prefix === "" ? key : `${prefix}.${key}`, depth + 1));
  }
  return out;
}
