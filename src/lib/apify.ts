// Apify — the live half of the lead import.
//
// Server-only: the token lives in APIFY_API_TOKEN and is read here, sent as a
// bearer header, and never returned to the browser in any form. Nothing in
// this file may be imported from a client component; the wizard talks to it
// through the server action in src/lib/actions/apify.ts, which hands back
// mapped rows and plain error text and nothing else.
//
// One call does the whole job: run-sync-get-dataset-items starts the run,
// waits for it, and returns the dataset in the response. That is why the
// import can be a single button press rather than a polling loop — and why a
// long-running actor comes back as a timeout rather than a background job.

import { ApifyFetchResult, MAX_IMPORT_ROWS } from "@/lib/leadImport";

export const APIFY_SOURCE_KINDS = ["actor", "task"] as const;

export type ApifySourceKind = (typeof APIFY_SOURCE_KINDS)[number];

// How long the actor itself is allowed to run, and how long we wait on the
// socket. The client timeout sits above the run timeout so a run that hits its
// own limit reports the actor's failure rather than our abort.
export const APIFY_RUN_TIMEOUT_SECONDS = 120;
const APIFY_CLIENT_TIMEOUT_MS = (APIFY_RUN_TIMEOUT_SECONDS + 15) * 1000;

const API_BASE = "https://api.apify.com/v2";

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

export async function runApifySync({
  kind,
  id,
  input,
}: {
  kind: ApifySourceKind;
  id: string;
  input: string;
}): Promise<ApifyFetchResult> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return {
      ok: false,
      error:
        "APIFY_API_TOKEN is not set. Add it to the .env file and restart the server.",
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

  const path = kind === "task" ? "actor-tasks" : "acts";
  const url =
    `${API_BASE}/${path}/${encodeURIComponent(actorId)}/run-sync-get-dataset-items` +
    `?timeout=${APIFY_RUN_TIMEOUT_SECONDS}&maxItems=${MAX_IMPORT_ROWS}&limit=${MAX_IMPORT_ROWS}`;

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

  const table = itemsToTable(items, MAX_IMPORT_ROWS);
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
    return `Apify rejected the API token. Check APIFY_API_TOKEN in the .env file — it may be mistyped, revoked, or from another account.${suffix}`;
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
    const flat = flatten(item);
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
