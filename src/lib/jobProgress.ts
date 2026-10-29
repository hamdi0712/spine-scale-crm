// The shape of a long-running job's progress, as the server stores it and
// every page polls it. Shared by the runner (src/lib/jobRunner.ts), the poll
// route (src/app/api/jobs/route.ts) and the panel (src/components/JobProgress.tsx),
// so all three agree on what "23 of 210" means.
//
// Plain types and pure helpers only: imported by client components.

export type JobKind =
  | "recrawl-candidates"
  | "recrawl-leads"
  | "compare-scoring"
  | "process-queue"
  | "clinic-search"
  | "email-check"
  | "demo";

// running     the loop is alive on the server
// finished    it reached the end
// stopped     somebody pressed Stop, or the job stopped itself (Compare
//             scoring's three-errors-in-a-row rule); the note says which
// interrupted the server stopped mid-run — a restart, or a Mac that slept.
//             The only state shown as "did not finish".
export type JobStatus = "running" | "finished" | "stopped" | "interrupted";

export type JobItemOutcome = "ok" | "warn" | "error";

export interface JobItemView {
  seq: number;
  subjectId: string;
  name: string;
  outcome: JobItemOutcome;
  detail: string;
}

export interface JobSnapshot {
  id: string;
  kind: JobKind;
  source: string;
  verb: string;
  href: string;
  status: JobStatus;
  stopRequested: boolean;
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  current: string | null;
  estimatedUsd: number | null;
  spentUsd: number;
  note: string | null;
  startedAt: string;
  finishedAt: string | null;
  // The server's clock at the moment of the read, so elapsed time is counted
  // against the server rather than a browser clock that may disagree with it.
  now: string;
  // The last few items to finish, newest first.
  recent: JobItemView[];
  // Every item that ended in an error, oldest first.
  failures: JobItemView[];
}

// How long the heartbeat may go quiet before a running row is read as a run
// the server dropped. The runner beats every few seconds whatever the item in
// flight is doing, so this is many missed beats, not one slow clinic.
export const HEARTBEAT_MS = 5_000;
export const STALE_AFTER_MS = 45_000;

export const RECENT_ITEMS = 6;

export function isLive(job: Pick<JobSnapshot, "status">): boolean {
  return job.status === "running";
}

// Seconds as "4m 12s", "1h 03m", "38s".
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

// Time left from the average pace so far. Nothing until two items have
// landed: one item is a sample of one, and the first is often the slowest.
export function etaMs(job: Pick<JobSnapshot, "done" | "total">, elapsedMs: number): number | null {
  if (job.done < 2 || job.done >= job.total) return null;
  return (elapsedMs / job.done) * (job.total - job.done);
}

export function fmtUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

// What each job is called in the panel's finish line and the header pill.
export const JOB_TITLES: Record<JobKind, string> = {
  "recrawl-candidates": "Re-crawl",
  "recrawl-leads": "Re-crawl",
  "compare-scoring": "Compare scoring",
  "process-queue": "Process queue",
  "clinic-search": "Clinic-first search",
  "email-check": "Email check",
  demo: "Demo re-crawl",
};

// Where one item of a run lives, for the failures list. Compare scoring mixes
// candidates and leads under one id space, so it links nowhere.
export function itemHref(kind: JobKind, subjectId: string): string | null {
  switch (kind) {
    case "recrawl-candidates":
    case "process-queue":
      return `/discovery/${subjectId}`;
    case "recrawl-leads":
      return `/pipeline/${subjectId}`;
    default:
      return null;
  }
}
