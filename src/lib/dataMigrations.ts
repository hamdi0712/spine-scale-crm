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
import { EmailSource, hasFrontDeskWord, parseAlternates } from "@/lib/emailFind";
import { canAutoAccept } from "@/lib/contactFinder";
import { autoAcceptWrite, revokedAddresses } from "@/lib/contactFinderRun";
import { riskyAccepted } from "@/lib/emailWorkflow";
import { syncLeadInbox } from "@/lib/emailInboxes";
import { rebuildDraft } from "@/lib/ownerFindRun";

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
  try {
    await migrateFrontDeskLabels({ log });
  } catch (e) {
    (log ?? console.error)(`[data migration] Front-desk labels failed: ${e instanceof Error ? e.message : String(e)} — nothing marked done.`);
  }
  try {
    await migrateStuckRiskyAccepts({ log });
  } catch (e) {
    (log ?? console.error)(`[data migration] Risky accepts failed: ${e instanceof Error ? e.message : String(e)} — nothing marked done.`);
  }
}

// ─── Front-desk labels ─────────────────────────────────────────────────────
//
// Addresses with a front-desk word (paportofrontdesk@, info.drlee@) were
// sometimes labelled the owner's because the doctor's name was in them. The
// rule is fixed for new addresses (hasFrontDeskWord in src/lib/emailFind.ts);
// this puts the stored ones right, once, on leads where nothing has been
// promised yet: nothing sent, not approved, the address not set by hand
// (typed in the lead form, or through the connector). A lead routed as Owner
// email on such an address becomes Front desk; its unapproved draft follows
// the new label (the opener is kept). Every lead it changes is logged.

export const FRONT_DESK_LABEL_MIGRATION = "2026-11-29-front-desk-labels";

export async function migrateFrontDeskLabels(opts: { log?: Log; now?: Date; dbFile?: string | null } = {}): Promise<MigrationResult & { changed: string[] }> {
  const log = opts.log ?? ((l: string) => console.log(`[data migration] ${l}`));
  const now = opts.now ?? new Date();
  if (await prisma.dataMigration.findUnique({ where: { id: FRONT_DESK_LABEL_MIGRATION } })) {
    return { ran: false, ok: true, summary: "already done", backup: null, mismatches: [], changed: [] };
  }
  const file = opts.dbFile === undefined ? sqliteFile() : opts.dbFile;
  let backup: string | null = null;
  if (file) {
    if (!fs.existsSync(file)) {
      log(`Front-desk labels: the database file ${file} was not found — nothing done, tried again at the next start.`);
      return { ran: true, ok: false, summary: "no database file", backup: null, mismatches: [], changed: [] };
    }
    backup = `${file}.backup-${stamp(now)}-labels`;
    fs.copyFileSync(file, backup);
    log(`Front-desk labels: backed up the database to ${backup}`);
  }

  const leads = await prisma.lead.findMany({
    where: { channel: "email", emailSends: { none: {} }, emailApprovedAt: null },
    select: { id: true, clinicName: true, email: true, emailType: true, emailSource: true, emailTypeByHand: true, emailAlternates: true, emailVersion: true, contactStatus: true },
  });
  const changed: string[] = [];
  const writes: { id: string; data: Record<string, unknown>; rebuild: boolean }[] = [];
  for (const l of leads) {
    const data: Record<string, unknown> = {};
    const notes: string[] = [];
    const main = (l.email ?? "").trim().toLowerCase();
    const mainByHand = l.emailTypeByHand || l.emailSource === "manual";
    if (main !== "" && l.emailType === "owner" && !mainByHand && hasFrontDeskWord(main)) {
      data.emailType = "generic";
      notes.push(`${main} owner → front desk`);
      if (l.contactStatus === "owner_email") {
        data.contactStatus = "front_desk";
        notes.push("Owner email → Front desk");
      }
    }
    const alternates = parseAlternates(l.emailAlternates);
    let altChanged = false;
    for (const a of alternates) {
      if (a.type === "owner" && a.source !== "manual" && hasFrontDeskWord(a.address)) {
        a.type = "generic";
        altChanged = true;
        notes.push(`${a.address} (alternate) owner → front desk`);
      }
    }
    if (altChanged) data.emailAlternates = JSON.stringify(alternates);
    if (notes.length === 0) continue;
    writes.push({ id: l.id, data, rebuild: data.emailType !== undefined && l.emailVersion === null });
    changed.push(`${l.clinicName} (${l.id}): ${notes.join("; ")}`);
  }

  await prisma.$transaction([
    ...writes.map((w) => prisma.lead.update({ where: { id: w.id }, data: w.data })),
    prisma.dataMigration.create({ data: { id: FRONT_DESK_LABEL_MIGRATION, ranAt: now, note: `${changed.length} lead(s) relabelled` } }),
  ]);
  for (const c of changed) log(`Front-desk labels: ${c}`);
  // The draft follows the label where the version was never chosen by hand.
  for (const w of writes) if (w.rebuild) await rebuildDraft(w.id);
  const summary = `${changed.length} lead${changed.length === 1 ? "" : "s"} relabelled`;
  log(`Front-desk labels: done — ${summary}.`);
  return { ran: true, ok: true, summary, backup, mismatches: [], changed };
}

// ─── Risky addresses the finder should have accepted ───────────────────────
//
// A "Re-run contact finder" that found the same as on file used to stop
// before the accept step, and Pipeline leads were never in the queue the
// backfill ran on. So some leads hold a risky address that was found on the
// clinic's own domain (or free mail), never revoked, and still not accepted —
// "the contact finder accepts it on its next run". Accepted here, once, by
// the same rule (canAutoAccept, revokedAddresses), on unsent leads; each one
// logged in the activity feed and in this log.

export const RISKY_ACCEPT_SWEEP = "2026-11-28-risky-accept-sweep";

export async function migrateStuckRiskyAccepts(opts: { log?: Log; now?: Date; dbFile?: string | null } = {}): Promise<MigrationResult & { changed: string[] }> {
  const log = opts.log ?? ((l: string) => console.log(`[data migration] ${l}`));
  const now = opts.now ?? new Date();
  if (await prisma.dataMigration.findUnique({ where: { id: RISKY_ACCEPT_SWEEP } })) {
    return { ran: false, ok: true, summary: "already done", backup: null, mismatches: [], changed: [] };
  }
  const file = opts.dbFile === undefined ? sqliteFile() : opts.dbFile;
  let backup: string | null = null;
  if (file) {
    if (!fs.existsSync(file)) {
      log(`Risky accepts: the database file ${file} was not found — nothing done, tried again at the next start.`);
      return { ran: true, ok: false, summary: "no database file", backup: null, mismatches: [], changed: [] };
    }
    backup = `${file}.backup-${stamp(now)}-risky`;
    fs.copyFileSync(file, backup);
    log(`Risky accepts: backed up the database to ${backup}`);
  }
  const leads = await prisma.lead.findMany({
    where: { channel: "email", emailStatus: "risky", emailSends: { none: {} }, suppressedAt: null, emailUnsubscribedAt: null, emailRepliedAt: null },
  });
  const changed: string[] = [];
  for (const l of leads) {
    const address = (l.email ?? "").trim().toLowerCase();
    if (address === "" || riskyAccepted(l)) continue;
    const source = (l.emailSource as EmailSource | null) ?? null;
    if (!canAutoAccept({ address, status: "risky", source }, l.websiteUrl)) continue;
    if ((await revokedAddresses(l.id)).has(address)) continue;
    const data = await autoAcceptWrite(l, { address, source }, now);
    await prisma.lead.update({ where: { id: l.id }, data });
    await syncLeadInbox(l.id);
    changed.push(`${l.clinicName} (${l.id}): ${address} accepted`);
  }
  await prisma.dataMigration.create({ data: { id: RISKY_ACCEPT_SWEEP, ranAt: now, note: `${changed.length} accepted` } });
  for (const c of changed) log(`Risky accepts: ${c}`);
  const summary = `${changed.length} lead${changed.length === 1 ? "" : "s"} accepted`;
  log(`Risky accepts: done — ${summary}.`);
  return { ran: true, ok: true, summary, backup, mismatches: [], changed };
}
