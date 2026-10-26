// The one place a long-running job's loop lives: in the server process, not
// in a browser tab.
//
// Every bulk job in the app — re-crawl websites, Compare scoring, Process
// queue — is a list of items run one at a time, each through the same server
// function it always went through. Until now the loop calling that function
// lived in the page, so leaving the page or refreshing it stopped the run and
// lost its progress. Here the loop is started by a server action and carries
// on after the action has answered; each step is written to a JobRun row, and
// the page polls that row (src/app/api/jobs/route.ts). Navigating away and
// back, refreshing, or opening a second tab all read the same truth.
//
// What it does not change is any job: the item function, its order, Stop
// finishing what is in flight. Jobs run one at a time unless they ask for
// more (the re-crawls do, from Settings → Pipeline); a service limit on work
// at once backs a run off to fewer and retries the item.
//
// Server-only, and not a "use server" module: launchJob takes functions.
//
// A run lives exactly as long as this Node process. The live set below says
// which runs this process is driving; a row marked running that is not in it
// and whose heartbeat has gone quiet belonged to a server that stopped, and is
// closed as interrupted — never sooner, so a slow item is never mistaken for
// a dead run.

import { prisma } from "@/lib/prisma";
import {
  HEARTBEAT_MS,
  JobItemOutcome,
  JobKind,
  JobSnapshot,
  JobStatus,
  RECENT_ITEMS,
  STALE_AFTER_MS,
} from "@/lib/jobProgress";

export interface JobItem {
  id: string;
  name: string;
  // What this one item is estimated to cost, added to the run's spend once
  // it has run. Omitted for a job that spends nothing.
  estimateUsd?: number;
}

export interface JobItemResult {
  outcome: JobItemOutcome;
  // The one line the activity list shows: "6 pages · decompression page found".
  detail: string;
  // The job's full result for this item, for a view of its own (Process
  // queue's per-step list). Stored as JSON.
  result?: unknown;
  // Not this item's failure: the service is at its limit for work at once.
  // The runner takes one worker away, waits, and runs the item again rather
  // than recording it.
  backoff?: boolean;
  // What this item actually spent, where the job knows better than its
  // estimate (Find emails stops early on most leads). Omitted, the item's
  // estimate is counted.
  spentUsd?: number;
}

export interface JobSpec<T extends JobItem> {
  kind: JobKind;
  source: string;
  verb: string;
  href: string;
  items: T[];
  work: (item: T) => Promise<JobItemResult>;
  // How many items run at once. Omitted (or 1) runs them one at a time, in
  // order, exactly as before; the re-crawls pass the setting.
  concurrency?: number;
  // Asked after every item, with every result so far. A string stops the run
  // there, and becomes its note.
  halt?: (results: JobItemResult[]) => string | null;
  // Once the loop is over, however it ended. Its answer, if any, is the
  // run's closing note.
  finish?: (ended: { status: JobStatus; halted: string | null }) => Promise<string | null>;
}

// Shared across every module instance in the process — Next can load this
// file more than once (the action bundle and the route bundle), and both must
// see the same runs.
const g = globalThis as unknown as { __liveJobRuns?: Set<string> };
const live: Set<string> = (g.__liveJobRuns ??= new Set());

export type LaunchResult = { ok: true; id: string } | { ok: false; error: string };

export async function launchJob<T extends JobItem>(spec: JobSpec<T>): Promise<LaunchResult> {
  await closeDeadRuns();
  // One run per button at a time. Two re-crawls of the same list at once is
  // the same Apify bill twice.
  const already = await prisma.jobRun.findFirst({
    where: { source: spec.source, status: "running" },
    select: { id: true },
  });
  if (already) return { ok: false, error: "This is already running — it is shown below." };
  if (spec.items.length === 0) return { ok: false, error: "There is nothing to run." };

  const estimates = spec.items.map((i) => i.estimateUsd);
  const estimatedUsd = estimates.some((e) => e !== undefined)
    ? estimates.reduce<number>((sum, e) => sum + (e ?? 0), 0)
    : null;

  const run = await prisma.jobRun.create({
    data: {
      kind: spec.kind,
      source: spec.source,
      verb: spec.verb,
      href: spec.href,
      total: spec.items.length,
      estimatedUsd,
      current: spec.items[0].name,
    },
    select: { id: true },
  });

  live.add(run.id);
  // Not awaited: the action answers with the id now, and the loop carries on.
  void drive(run.id, spec).finally(() => live.delete(run.id));
  return { ok: true, id: run.id };
}

// How many times one item is put back for the service's limit before it is
// recorded as failed, and how long to wait before each try.
const MAX_BACKOFFS = 4;
// JOB_BACKOFF_MS in the environment is for tools/verify-recrawl.ts.
const BACKOFF_MS = Number(process.env.JOB_BACKOFF_MS) || 15_000;

async function drive<T extends JobItem>(id: string, spec: JobSpec<T>): Promise<void> {
  const beat = setInterval(() => {
    void prisma.jobRun
      .updateMany({ where: { id, status: "running" }, data: { heartbeatAt: new Date() } })
      .catch(() => {});
  }, HEARTBEAT_MS);
  beat.unref?.();

  const results: JobItemResult[] = [];
  let status: JobStatus = "finished";
  let halted: string | null = null;
  let gone = false;

  // The items still to take, in order. One taken by a worker is in flight
  // until its result is recorded; Stop and a halt only keep workers from
  // taking more, so whatever is in flight finishes.
  const queue = spec.items.map((item) => ({ item, backoffs: 0 }));
  const inFlight: string[] = [];
  let limit = Math.max(1, Math.floor(spec.concurrency ?? 1));
  let seq = 0;
  let ending = false;

  const currentLine = () =>
    inFlight.length === 0 ? null : inFlight.length === 1 ? inFlight[0] : `${inFlight[0]} +${inFlight.length - 1} more`;

  async function worker(slot: number): Promise<void> {
    while (!ending) {
      // A worker above the current limit stops taking work: that is how a
      // backoff runs fewer at once.
      if (slot >= limit) return;
      const next = queue.shift();
      if (!next) return;
      const row = await prisma.jobRun.findUnique({ where: { id }, select: { stopRequested: true } });
      if (!row) {
        gone = true;
        ending = true;
        return;
      }
      if (row.stopRequested) {
        queue.unshift(next);
        status = "stopped";
        ending = true;
        return;
      }
      inFlight.push(next.item.name);
      await prisma.jobRun.update({ where: { id }, data: { current: currentLine(), heartbeatAt: new Date() } });

      let result: JobItemResult;
      try {
        result = await spec.work(next.item);
      } catch {
        result = { outcome: "error", detail: "The server hit an error on this one." };
      }
      inFlight.splice(inFlight.indexOf(next.item.name), 1);

      if (result.backoff && next.backoffs < MAX_BACKOFFS) {
        next.backoffs++;
        limit = Math.max(1, Math.min(limit, inFlight.length + 1) - 1);
        queue.unshift(next);
        await prisma.jobRun
          .update({ where: { id }, data: { current: currentLine() ?? `Waiting to retry ${next.item.name}`, heartbeatAt: new Date() } })
          .catch(() => {});
        await new Promise((res) => setTimeout(res, BACKOFF_MS * next.backoffs));
        continue;
      }
      if (result.backoff) {
        result = { ...result, outcome: "error", detail: `${result.detail} (still at the limit after ${MAX_BACKOFFS} tries)` };
      }
      results.push(result);

      await prisma.$transaction([
        prisma.jobRunItem.create({
          data: {
            runId: id,
            seq: seq++,
            subjectId: next.item.id,
            name: next.item.name,
            outcome: result.outcome,
            detail: result.detail,
            result: result.result === undefined ? null : JSON.stringify(result.result),
          },
        }),
        prisma.jobRun.update({
          where: { id },
          data: {
            done: { increment: 1 },
            succeeded: { increment: result.outcome === "error" ? 0 : 1 },
            failed: { increment: result.outcome === "error" ? 1 : 0 },
            spentUsd: { increment: result.spentUsd ?? next.item.estimateUsd ?? 0 },
            current: currentLine(),
            heartbeatAt: new Date(),
          },
        }),
      ]);

      const halt = spec.halt?.(results) ?? null;
      if (halt && !halted) {
        halted = halt;
        status = "stopped";
        ending = true;
      }
    }
  }

  try {
    const workers = Math.min(limit, Math.max(1, spec.items.length));
    await Promise.all(Array.from({ length: workers }, (_, slot) => worker(slot)));
    // A worker that backed off above the new limit leaves its item queued;
    // if every other worker had already run out, finish the list one at a time.
    while (queue.length > 0 && !ending) await worker(0);
    if (gone) return; // deleted underneath us

    let note: string | null = halted;
    if (spec.finish) {
      try {
        note = (await spec.finish({ status, halted })) ?? note;
      } catch {
        // The run's own numbers are still true; only the closing line is lost.
      }
    }
    await prisma.jobRun.update({
      where: { id },
      data: { status, current: null, note, finishedAt: new Date() },
    });
  } catch {
    // The database itself failed under the loop. Say the run did not finish
    // rather than leave it looking alive.
    await prisma.jobRun
      .update({ where: { id }, data: { status: "interrupted", current: null, finishedAt: new Date() } })
      .catch(() => {});
  } finally {
    clearInterval(beat);
  }
}

// Running rows this process is not driving and whose heartbeat stopped long
// ago: their server went away mid-run. Closed as interrupted, which is the
// only path to "did not finish".
export async function closeDeadRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await prisma.jobRun.findMany({
    where: { status: "running", heartbeatAt: { lt: cutoff } },
    select: { id: true },
  });
  const dead = stale.map((r) => r.id).filter((runId) => !live.has(runId));
  if (dead.length === 0) return;
  await prisma.jobRun.updateMany({
    where: { id: { in: dead }, status: "running" },
    data: { status: "interrupted", current: null, finishedAt: new Date() },
  });
}

export async function requestJobStop(id: string): Promise<void> {
  await prisma.jobRun.updateMany({ where: { id, status: "running" }, data: { stopRequested: true } });
}

export async function dismissJob(id: string): Promise<void> {
  await prisma.jobRun.updateMany({ where: { id, status: { not: "running" } }, data: { dismissedAt: new Date() } });
}

// How long a finished run stays on its page and in the header until it is
// dismissed: long enough to come back to after lunch, not forever.
const KEEP_FINISHED_MS = 12 * 60 * 60 * 1000;

// Every run worth showing: the live ones, and finished ones nobody has
// dismissed yet.
export async function readJobs(): Promise<JobSnapshot[]> {
  await closeDeadRuns();
  const runs = await prisma.jobRun.findMany({
    where: {
      OR: [
        { status: "running" },
        { dismissedAt: null, finishedAt: { gt: new Date(Date.now() - KEEP_FINISHED_MS) } },
      ],
    },
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  return Promise.all(runs.map((r) => snapshot(r)));
}

export async function readJob(id: string): Promise<JobSnapshot | null> {
  await closeDeadRuns();
  const run = await prisma.jobRun.findUnique({ where: { id } });
  return run ? snapshot(run) : null;
}

type JobRunRow = NonNullable<Awaited<ReturnType<typeof prisma.jobRun.findUnique>>>;

async function snapshot(r: JobRunRow): Promise<JobSnapshot> {
  const [recent, failures] = await Promise.all([
    prisma.jobRunItem.findMany({
      where: { runId: r.id },
      orderBy: { seq: "desc" },
      take: RECENT_ITEMS,
    }),
    prisma.jobRunItem.findMany({
      where: { runId: r.id, outcome: "error" },
      orderBy: { seq: "asc" },
      take: 500,
    }),
  ]);
  const view = (i: (typeof recent)[number]) => ({
    seq: i.seq,
    subjectId: i.subjectId,
    name: i.name,
    outcome: i.outcome as JobItemOutcome,
    detail: i.detail,
  });
  return {
    id: r.id,
    kind: r.kind as JobKind,
    source: r.source,
    verb: r.verb,
    href: r.href,
    status: r.status as JobStatus,
    stopRequested: r.stopRequested,
    total: r.total,
    done: r.done,
    succeeded: r.succeeded,
    failed: r.failed,
    current: r.current,
    estimatedUsd: r.estimatedUsd,
    spentUsd: r.spentUsd,
    note: r.note,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    now: new Date().toISOString(),
    recent: recent.map(view),
    failures: failures.map(view),
  };
}

// Every stored result of a run, in order — for a job with a view of its own
// over the whole list once it is done.
export async function readJobResults(id: string): Promise<{ subjectId: string; name: string; result: unknown }[]> {
  const items = await prisma.jobRunItem.findMany({ where: { runId: id }, orderBy: { seq: "asc" } });
  return items.map((i) => ({
    subjectId: i.subjectId,
    name: i.name,
    result: i.result ? (JSON.parse(i.result) as unknown) : null,
  }));
}
