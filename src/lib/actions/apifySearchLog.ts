"use server";

// Search usage tracking — the reads and the writes.
//
// The recording half is called from the two places that actually spend an
// actor run on a search: the Apify import action and the Clinic-First run. It
// is deliberately unconditional and deliberately quiet — a search is logged
// because it was run, not because it worked, and a logging failure never
// fails a run that has already been paid for.
//
// The editing half belongs to the history view: setting a status by hand,
// clearing one, and adding a row for a search that was run long before any of
// this existed.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  ApifySearchLogRow,
  ApifySearchStatus,
  ApifySearchType,
  MAX_SEARCH_KEY_LENGTH,
  isApifySearchStatus,
  isApifySearchType,
  searchKey,
} from "@/lib/apifySearchLog";

const HISTORY_PATH = "/discovery/search-history";

// Counts one run of one search.
//
// Increment-or-create, and nothing else: manualStatusOverride is never
// touched here, so a status somebody set by hand survives every future run
// while the count underneath it stays honest.
//
// Takes the raw search — the input JSON, or the term — and normalises it here
// rather than trusting a caller to have done it, so there is exactly one
// definition of "the same search".
export async function recordApifySearchRun(args: {
  type: ApifySearchType;
  raw: string;
}): Promise<void> {
  if (!isApifySearchType(args?.type)) return;
  const key = searchKey(args.type, typeof args?.raw === "string" ? args.raw : "");
  if (key === "") return;
  const now = new Date();

  try {
    await prisma.apifySearchLog.upsert({
      where: { type_key: { type: args.type, key } },
      update: { runCount: { increment: 1 }, lastRunAt: now },
      create: {
        type: args.type,
        key,
        runCount: 1,
        firstRunAt: now,
        lastRunAt: now,
      },
    });
  } catch {
    // A run that already happened is not undone by failing to write it down,
    // and the caller is holding results that cost money. The count is the
    // thing lost, and the override exists to repair exactly that.
    return;
  }
  revalidatePath(HISTORY_PATH);
}

// ─── Reads ─────────────────────────────────────────────────────────────────

// Every logged search, most recently used first.
//
// A row added by hand has never been run and so has no lastRunAt. Those sort
// after everything that has, by when they were added — not before, because
// "most recently used" is what the list claims to be ordered by and a row that
// was never used has no claim on the top of it.
export async function listApifySearchLogs(): Promise<ApifySearchLogRow[]> {
  const rows = await prisma.apifySearchLog.findMany({
    orderBy: [{ lastRunAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toRow);
}

// The status of a set of clinic-first terms, keyed by the term as it was
// passed in, for the pills beside the search-term chips. Terms with no row
// are simply absent — the panel reads absence as New, which is what it means.
export async function clinicKeywordStatuses(
  terms: string[],
): Promise<Record<string, ApifySearchLogRow>> {
  const wanted = Array.isArray(terms)
    ? terms.filter((t): t is string => typeof t === "string")
    : [];
  if (wanted.length === 0) return {};

  const keys = Array.from(new Set(wanted.map((t) => searchKey("CLINIC_KEYWORD", t))));
  const rows = await prisma.apifySearchLog.findMany({
    where: { type: "CLINIC_KEYWORD", key: { in: keys } },
  });
  const byKey = new Map(rows.map((row) => [row.key, toRow(row)]));

  const out: Record<string, ApifySearchLogRow> = {};
  for (const term of wanted) {
    const row = byKey.get(searchKey("CLINIC_KEYWORD", term));
    if (row) out[term] = row;
  }
  return out;
}

// ─── Writes from the history view ──────────────────────────────────────────

// Sets a status by hand, or clears one back to the count.
//
// The count is never written here. That is the whole bargain of an override:
// it changes what is shown and nothing about what is true, so clearing it is
// a return to the count rather than a guess at what the count should have
// been.
export async function setApifySearchStatusOverride(args: {
  id: string;
  status: string | null;
}): Promise<void> {
  const id = typeof args?.id === "string" ? args.id : "";
  if (id === "") return;
  const status = isApifySearchStatus(args?.status) ? args.status : null;

  await prisma.apifySearchLog.update({
    where: { id },
    data: { manualStatusOverride: status },
  });
  revalidatePath(HISTORY_PATH);
}

// Logs a search nobody has run through tracking — the retroactive case this
// whole override mechanism exists for.
//
// It is created with no runs and no dates, because it has had none here. The
// status comes from the override, which is the only reason to add a row like
// this at all; a row added with no status would read as New, which is the
// thing being corrected.
//
// Adding a search that is already logged sets its status rather than
// complaining or creating a second row — the unique index would refuse the
// second row anyway, and setting the status is plainly what was meant.
export async function addApifySearchLogEntry(args: {
  type: string;
  raw: string;
  status: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const type: ApifySearchType = isApifySearchType(args?.type)
    ? args.type
    : "CLINIC_KEYWORD";
  const raw = typeof args?.raw === "string" ? args.raw : "";
  if (raw.trim() === "") {
    return { ok: false, error: "Enter the keyword or the search JSON to log." };
  }
  if (raw.length > MAX_SEARCH_KEY_LENGTH) {
    return {
      ok: false,
      error: `That search is longer than ${MAX_SEARCH_KEY_LENGTH} characters. Log the part that identifies it.`,
    };
  }
  const key = searchKey(type, raw);
  const status: ApifySearchStatus | null = isApifySearchStatus(args?.status)
    ? args.status
    : null;

  await prisma.apifySearchLog.upsert({
    where: { type_key: { type, key } },
    update: { manualStatusOverride: status },
    create: { type, key, runCount: 0, manualStatusOverride: status },
  });
  revalidatePath(HISTORY_PATH);
  return { ok: true };
}

// Removes a row outright. Only for something logged by mistake — a real
// search's count is a record, and the way to say it is stale is the override.
export async function deleteApifySearchLogEntry(id: string): Promise<void> {
  if (typeof id !== "string" || id === "") return;
  await prisma.apifySearchLog.delete({ where: { id } });
  revalidatePath(HISTORY_PATH);
}

function toRow(row: {
  id: string;
  type: string;
  key: string;
  runCount: number;
  manualStatusOverride: string | null;
  firstRunAt: Date | null;
  lastRunAt: Date | null;
}): ApifySearchLogRow {
  return {
    id: row.id,
    type: isApifySearchType(row.type) ? row.type : "CLINIC_KEYWORD",
    key: row.key,
    runCount: row.runCount,
    manualStatusOverride: isApifySearchStatus(row.manualStatusOverride)
      ? row.manualStatusOverride
      : null,
    firstRunAt: row.firstRunAt ? row.firstRunAt.toISOString() : null,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
  };
}
