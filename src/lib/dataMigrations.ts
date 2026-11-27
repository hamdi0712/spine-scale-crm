// One-time data migrations that need code, not SQL — run once at server start
// (src/instrumentation.ts), Node.js runtime only, never during a build.
// Server-only.
//
// The contact status migration: every existing email lead gets the
// contactStatus that keeps it exactly where the old rule put it
// (legacyEmailBucket in src/lib/emailBuckets.ts):
//
//   Email pipeline        → owner_email (an owner address) or front_desk
//   Contact form / sent   → contact_form
//   Call list             → call
//   Email queue           → needs_you, "Not run yet" — the contact finder's
//                           job now; Settings → Email's backfill moves them
//
// Safety, in order: the SQLite file is copied to a timestamped backup first;
// every lead's place is worked out before and after; if any lead outside the
// queue would move, nothing is written, the mismatches are logged and no
// marker row is left — so it is tried again, and refused again, until the
// cause is fixed. The marker (DataMigration) is written only after a clean
// run, in the same transaction as the statuses.

import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { EmailBucket, emailBucket, legacyEmailBucket } from "@/lib/emailBuckets";
import { bucketExtras } from "@/lib/emailBucketsRead";
import { ContactStatus, NOT_RUN_YET } from "@/lib/contactFinder";

export const CONTACT_STATUS_MIGRATION = "2026-11-28-contact-status";

type Log = (line: string) => void;

// The SQLite file DATABASE_URL points at, as Prisma resolves it: a relative
// path is relative to the schema's folder (prisma/).
export function sqliteFile(url = process.env.DATABASE_URL ?? ""): string | null {
  if (!url.startsWith("file:")) return null;
  const raw = url.slice("file:".length).split("?")[0];
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), "prisma", raw);
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// The status that keeps a lead where the old rule put it.
function statusFor(bucket: EmailBucket, emailType: string | null): { status: ContactStatus; reason: string | null } {
  switch (bucket) {
    case "pipeline":
      return { status: emailType === "owner" ? "owner_email" : "front_desk", reason: null };
    case "contact_form":
    case "form_sent":
      return { status: "contact_form", reason: null };
    case "call":
      return { status: "call", reason: null };
    default:
      return { status: "needs_you", reason: NOT_RUN_YET };
  }
}

export interface MigrationResult {
  ran: boolean;
  ok: boolean;
  summary: string;
  backup: string | null;
  mismatches: string[];
}

export async function migrateContactStatus(
  opts: {
    log?: Log;
    now?: Date;
    dbFile?: string | null;
    // Tests only: a deliberately wrong mapping, to prove a mismatch writes nothing.
    remap?: (s: { status: ContactStatus; reason: string | null }, leadId: string) => { status: ContactStatus; reason: string | null };
  } = {},
): Promise<MigrationResult> {
  const log = opts.log ?? ((l: string) => console.log(`[data migration] ${l}`));
  const now = opts.now ?? new Date();
  if (await prisma.dataMigration.findUnique({ where: { id: CONTACT_STATUS_MIGRATION } })) {
    return { ran: false, ok: true, summary: "already done", backup: null, mismatches: [] };
  }

  // 1. A backup of the database file, before anything is read for writing.
  const file = opts.dbFile === undefined ? sqliteFile() : opts.dbFile;
  let backup: string | null = null;
  if (file) {
    if (!fs.existsSync(file)) {
      log(`Contact status: the database file ${file} was not found — nothing done, tried again at the next start.`);
      return { ran: true, ok: false, summary: "no database file", backup: null, mismatches: [] };
    }
    backup = `${file}.backup-${stamp(now)}`;
    fs.copyFileSync(file, backup);
    log(`Contact status: backed up the database to ${backup}`);
  }

  // 2. Every email lead's place before and after.
  const leads = await prisma.lead.findMany({
    where: { channel: "email" },
    include: { _count: { select: { emailSends: true } } },
  });
  const extras = await bucketExtras(leads);
  const writes: { id: string; status: ContactStatus; reason: string | null }[] = [];
  const mismatches: string[] = [];
  const counts: Record<string, number> = {};
  for (const l of leads) {
    if (l.contactStatus !== null) continue;
    const x = extras.get(l.id)!;
    const before = legacyEmailBucket(l, x);
    // A Lost lead is hidden either way; its status is the one it would have.
    const placed = before === "hidden" ? legacyEmailBucket({ ...l, stage: "NEW" }, x) : before;
    const mapped = statusFor(placed, l.emailType);
    const { status, reason } = opts.remap ? opts.remap(mapped, l.id) : mapped;
    const after = emailBucket({ ...l, contactStatus: status, contactStatusReason: reason }, x);
    if (before !== "queue" && after !== before) mismatches.push(`${l.clinicName} (${l.id}): ${before} → ${after} as ${status}`);
    writes.push({ id: l.id, status, reason });
    const key = `${before}${before === "queue" ? " → needs_you" : ""}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const summary = `${writes.length} email lead${writes.length === 1 ? "" : "s"}: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`;

  // 3. Any lead outside the queue that would move: nothing written.
  if (mismatches.length > 0) {
    log(`Contact status: ABORTED — ${mismatches.length} lead${mismatches.length === 1 ? "" : "s"} would change place. Nothing was written.`);
    for (const m of mismatches) log(`  ${m}`);
    return { ran: true, ok: false, summary, backup, mismatches };
  }

  // 4. The statuses and the marker, together.
  await prisma.$transaction([
    ...writes.map((w) => prisma.lead.update({ where: { id: w.id }, data: { contactStatus: w.status, contactStatusReason: w.reason } })),
    prisma.dataMigration.create({ data: { id: CONTACT_STATUS_MIGRATION, ranAt: now, note: summary } }),
  ]);
  log(`Contact status: done — ${summary}.`);
  return { ran: true, ok: true, summary, backup, mismatches: [] };
}

// Everything pending, in order. A failure is logged and left for the next
// start; it never stops the server.
export async function runDataMigrations(log?: Log): Promise<void> {
  try {
    await migrateContactStatus({ log });
  } catch (e) {
    (log ?? console.error)(`[data migration] Contact status failed: ${e instanceof Error ? e.message : String(e)} — nothing marked done.`);
  }
}
