"use client";

// The progress experience for every long-running job — a bulk re-crawl from
// Discovery or Pipeline, "Re-crawl all leads crawled before…", Compare
// scoring, Process queue. One panel, one header pill, one tab title, so a run
// looks the same wherever it was started.
//
// The truth lives on the server (src/lib/jobRunner.ts). JobsProvider, mounted
// once in the app shell, polls /api/jobs — every second while anything runs,
// every five otherwise — and everything below reads what it last heard. A
// page that is left and come back to, refreshed, or opened in a second tab
// asks the same server and so shows the same run. Nothing here guesses: a run
// is shown as "did not finish" only when the server has closed it as
// interrupted.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCoin,
  IconDeviceLaptop,
  IconHourglassHigh,
  IconPlayerStopFilled,
} from "@tabler/icons-react";
import Sheet from "@/components/Sheet";
import useMediaQuery, { useIsPhone } from "@/components/useMediaQuery";
import { dismissJobRun, stopJobRun } from "@/lib/actions/jobs";
import {
  etaMs,
  fmtDuration,
  fmtUsd,
  itemHref,
  JOB_TITLES,
  JobItemOutcome,
  JobItemView,
  JobSnapshot,
} from "@/lib/jobProgress";

const FAST_POLL_MS = 1_000;
const IDLE_POLL_MS = 5_000;
// A finished run keeps its pill this long, so a run that ended while you were
// on another page still tells you so.
const PILL_AFTER_FINISH_MS = 30 * 60 * 1000;

interface JobsContext {
  jobs: JobSnapshot[];
  // The server's clock minus this browser's, from the last poll.
  skew: number;
  track: (id: string) => void;
  stop: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  openPanel: (id: string, anchor: HTMLElement | null) => void;
}

const Ctx = createContext<JobsContext | null>(null);

function useJobs(): JobsContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useJobs needs JobsProvider (AppShell mounts it).");
  return ctx;
}

// ─── Provider ──────────────────────────────────────────────────────────────

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [skew, setSkew] = useState(0);
  const [panel, setPanel] = useState<{ id: string; anchor: DOMRect | null } | null>(null);
  // A run started from this tab is polled fast straight away, before the
  // first answer has said it is running.
  const eagerUntil = useRef(0);
  const statuses = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => void>(() => {});

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    let next: JobSnapshot[] | null = null;
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        next = ((await res.json()) as { jobs: JobSnapshot[] }).jobs;
      }
    } catch {
      // A missed poll changes nothing on screen — the last answer stands
      // until the server gives a new one. Never a guess in between.
    }
    if (next) {
      setJobs(next);
      if (next[0]) setSkew(Date.parse(next[0].now) - Date.now());
      // A run that has just ended changed records the page behind it is
      // showing — the way each page's own loop used to refresh at its end.
      let ended = false;
      for (const j of next) {
        if (statuses.current.get(j.id) === "running" && j.status !== "running") ended = true;
        statuses.current.set(j.id, j.status);
      }
      if (ended) router.refresh();
    }
    const fast = (next ?? []).some((j) => j.status === "running") || Date.now() < eagerUntil.current;
    timer.current = setTimeout(() => pollRef.current(), fast ? FAST_POLL_MS : IDLE_POLL_MS);
  }, [router]);
  pollRef.current = () => void poll();

  useEffect(() => {
    void poll();
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  useTabTitle(jobs);

  const value = useMemo<JobsContext>(
    () => ({
      jobs,
      skew,
      track: () => {
        eagerUntil.current = Date.now() + 10_000;
        void poll();
      },
      stop: async (id) => {
        await stopJobRun(id);
        void poll();
      },
      dismiss: async (id) => {
        setJobs((prev) => prev.filter((j) => j.id !== id));
        setPanel((p) => (p?.id === id ? null : p));
        await dismissJobRun(id);
      },
      openPanel: (id, anchor) => setPanel({ id, anchor: anchor?.getBoundingClientRect() ?? null }),
    }),
    [jobs, skew, poll],
  );

  const panelJob = panel ? jobs.find((j) => j.id === panel.id) ?? null : null;

  return (
    <Ctx.Provider value={value}>
      {children}
      {panel && panelJob && (
        <JobPopover job={panelJob} anchor={panel.anchor} onClose={() => setPanel(null)} />
      )}
    </Ctx.Provider>
  );
}

// "(23/210) Re-crawling…" in the browser tab while a run is live, so it can
// be watched from another tab. Next rewrites the title on every navigation;
// the observer puts the progress straight back.
function useTabTitle(jobs: JobSnapshot[]) {
  const base = useRef<string | null>(null);
  const running = jobs.find((j) => j.status === "running");
  const wanted = running ? `(${running.done}/${running.total}) ${running.verb}…` : null;

  useEffect(() => {
    const apply = () => {
      const current = document.title;
      if (!/^\(\d+\/\d+\) /.test(current)) base.current = current;
      const target = wanted ?? base.current;
      if (target !== null && current !== target) document.title = target;
    };
    apply();
    if (!wanted) return;
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [wanted]);
}

// ─── Hooks for pages ───────────────────────────────────────────────────────

// The latest run a given button started, live or finished-and-not-dismissed.
export function useJobRun(source: string) {
  const { jobs, track, stop, dismiss } = useJobs();
  const job = jobs.find((j) => j.source === source) ?? null;
  return { job, running: job?.status === "running", track, stop, dismiss };
}

// The panel for one button's runs, wherever that button's page wants it.
export function JobProgressFor({ source, className = "" }: { source: string; className?: string }) {
  const { job } = useJobRun(source);
  if (!job) return null;
  return <JobProgressPanel job={job} className={className} />;
}

// ─── The panel ─────────────────────────────────────────────────────────────

const REDUCED = "(prefers-reduced-motion: reduce)";

export function JobProgressPanel({
  job,
  className = "",
  showPageLink = false,
}: {
  job: JobSnapshot;
  className?: string;
  // In the header pill's popover, a way to the page the run belongs to.
  showPageLink?: boolean;
}) {
  const { skew, stop, dismiss } = useJobs();
  const reduced = useMediaQuery(REDUCED);
  const live = job.status === "running";
  const [stopping, setStopping] = useState(false);
  const [showFailures, setShowFailures] = useState(false);

  const now = useTicker(live) + skew;
  const elapsed = (job.finishedAt ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt);
  const eta = live ? etaMs(job, elapsed) : null;
  const pct = job.total > 0 ? Math.floor((job.done / job.total) * 100) : 0;
  const shownDone = useCountUp(job.done, reduced);
  const title = JOB_TITLES[job.kind];
  const left = job.total - job.done;

  return (
    <section
      className={`card px-5 py-4 max-md:px-4 ${className}`}
      aria-label={`${title} progress`}
    >
      {/* Headline: what it is doing now, or how it ended. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {live ? (
            <p
              key={job.current ?? "between"}
              className="job-fade-in truncate text-sm text-ink-soft"
              aria-live="polite"
            >
              {job.stopRequested ? "Stopping after " : `${job.verb} `}
              <span className="font-medium text-ink">{job.current ?? "the next one"}</span>…
            </p>
          ) : (
            <EndLine job={job} title={title} left={left} />
          )}
        </div>
        {live ? (
          <button
            type="button"
            className="btn shrink-0 gap-1.5 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            disabled={stopping || job.stopRequested}
            onClick={async () => {
              setStopping(true);
              await stop(job.id).catch(() => {});
            }}
            title="The item in flight finishes; nothing after it starts"
          >
            <IconPlayerStopFilled size={12} aria-hidden />
            {job.stopRequested || stopping ? (
              "Stopping…"
            ) : (
              <>
                <span className="max-md:hidden">Stop after this one</span>
                <span className="md:hidden">Stop</span>
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost shrink-0 px-2 py-0.5 text-xs"
            onClick={() => void dismiss(job.id)}
          >
            Dismiss
          </button>
        )}
      </div>

      {/* The counter and the bar. */}
      <div className="mt-3 flex items-baseline gap-2">
        <span className="num text-2xl font-semibold tabular-nums text-ink" aria-hidden>
          {shownDone}
          <span className="font-normal text-muted"> of {job.total}</span>
        </span>
        <span className="num text-sm tabular-nums text-muted" aria-hidden>
          {pct}%
        </span>
        <span className="sr-only">
          {job.done} of {job.total} done
        </span>
      </div>
      <div
        className={`job-bar mt-2 ${live ? "job-bar-live" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.total}
        aria-valuenow={job.done}
        aria-label={`${title}: ${job.done} of ${job.total}`}
      >
        <div className="job-bar-fill" style={{ width: `${job.total > 0 ? (job.done / job.total) * 100 : 0}%` }} />
      </div>

      {/* Stats. */}
      <ul className="num mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs tabular-nums text-muted">
        <Stat icon={<IconCircleCheck size={14} className="text-ok" aria-hidden />}>
          {job.succeeded} succeeded
        </Stat>
        <Stat icon={<IconCircleX size={14} className={job.failed > 0 ? "text-bad" : ""} aria-hidden />}>
          {job.failed} failed
        </Stat>
        <Stat icon={<IconClock size={14} aria-hidden />}>{fmtDuration(elapsed)} elapsed</Stat>
        {live && (
          <Stat icon={<IconHourglassHigh size={14} aria-hidden />}>
            {eta === null ? "estimating time left" : `~${fmtDuration(eta)} left`}
          </Stat>
        )}
        {job.estimatedUsd !== null && (
          <Stat icon={<IconCoin size={14} aria-hidden />}>
            {fmtUsd(job.spentUsd)} of ~{fmtUsd(job.estimatedUsd)} est.
          </Stat>
        )}
      </ul>

      {/* The last few items, newest first. */}
      {job.recent.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line/60 pt-3" aria-label="Recent items">
          {job.recent.map((item) => (
            <ActivityRow key={item.seq} item={item} />
          ))}
        </ul>
      )}

      {job.note && <p className="mt-3 text-xs leading-relaxed text-ink-soft">{job.note}</p>}

      {/* Failures, in full, on request. */}
      {job.failures.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            aria-expanded={showFailures}
            onClick={() => setShowFailures((s) => !s)}
          >
            {showFailures ? "Hide failures" : `See ${job.failures.length} failure${job.failures.length === 1 ? "" : "s"} →`}
          </button>
          {showFailures && (
            <ul className="mt-2 space-y-1.5 rounded-[10px] border border-bad/25 bg-bad-soft/40 px-3 py-2.5">
              {job.failures.map((f) => {
                const href = itemHref(job.kind, f.subjectId);
                return (
                  <li key={f.seq} className="text-xs leading-relaxed">
                    {href ? (
                      <Link href={href} className="font-medium text-ink hover:underline">
                        {f.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{f.name}</span>
                    )}
                    <span className="text-muted"> — {f.detail}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {live && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <IconDeviceLaptop size={14} aria-hidden className="shrink-0" />
          Keep your Mac awake until this finishes.<span className="guided-only"> Leaving this page won&rsquo;t stop it.</span>
        </p>
      )}

      {showPageLink && (
        <Link href={job.href} className="mt-3 inline-block text-xs text-accent hover:underline">
          Go to the page →
        </Link>
      )}
    </section>
  );
}

function EndLine({ job, title, left }: { job: JobSnapshot; title: string; left: number }) {
  // An estimate, counted up item by item — marked as one.
  const cost = job.estimatedUsd !== null ? ` · ~${fmtUsd(job.spentUsd)}` : "";
  const failed = job.failed > 0 ? ` · ${job.failed} failed` : "";
  if (job.status === "finished" && job.succeeded === 0 && job.failed > 0) {
    // Reached the end, but nothing in it worked — not a green check.
    return (
      <div className="flex items-center gap-2.5">
        <IconCircleX size={24} className="shrink-0 text-bad" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title} finished — every item failed</p>
          <p className="num text-xs tabular-nums text-muted">
            {job.failed} failed{cost}
          </p>
        </div>
      </div>
    );
  }
  if (job.status === "finished") {
    return (
      <div className="flex items-center gap-2.5">
        <DrawnCheck />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title} finished</p>
          <p className="num text-xs tabular-nums text-muted">
            {job.succeeded} done{failed}
            {cost}
          </p>
        </div>
      </div>
    );
  }
  if (job.status === "interrupted") {
    return (
      <div className="flex items-start gap-2.5">
        <IconAlertTriangle size={22} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title} did not finish</p>
          <p className="num text-xs leading-relaxed tabular-nums text-muted">
            The server stopped at {job.done} of {job.total}
            {left > 0 && ` — the ${left} it never reached are unchanged`}. Run it again to pick them up.
          </p>
        </div>
      </div>
    );
  }
  // stopped
  return (
    <div className="flex items-center gap-2.5">
      <IconPlayerStopFilled size={18} className="shrink-0 text-muted" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {title} stopped at {job.done} of {job.total}
        </p>
        <p className="num text-xs tabular-nums text-muted">
          {job.succeeded} done{failed}
          {cost}
          {left > 0 && ` · ${left} not reached, unchanged`}
        </p>
      </div>
    </div>
  );
}

function DrawnCheck() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0 text-ok" aria-hidden>
      <circle
        className="job-check-ring"
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        transform="rotate(-90 12 12)"
      />
      <path
        className="job-check-tick"
        d="M7.5 12.5l3 3 6-6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Stat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1">
      {icon}
      {children}
    </li>
  );
}

const OUTCOME_ICON: Record<JobItemOutcome, React.ReactNode> = {
  ok: <IconCircleCheck size={15} className="text-ok" aria-label="Done" />,
  warn: <IconAlertTriangle size={15} className="text-warn" aria-label="Done, with a warning" />,
  error: <IconCircleX size={15} className="text-bad" aria-label="Failed" />,
};

function ActivityRow({ item }: { item: JobItemView }) {
  return (
    <li className="job-item-in flex min-w-0 items-center gap-2 text-xs leading-relaxed">
      <span className="shrink-0">{OUTCOME_ICON[item.outcome]}</span>
      <span className="max-w-[45%] shrink-0 truncate font-medium text-ink">{item.name}</span>
      <span className={`min-w-0 flex-1 truncate ${item.outcome === "error" ? "text-bad" : "text-muted"}`} title={item.detail}>
        {item.detail}
      </span>
    </li>
  );
}

// The browser's clock, ticking once a second while a run is live, for the
// elapsed time between polls.
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// A number that counts up to its new value rather than jumping. It starts at
// whatever it is first given — coming back to a run mid-way shows where it is,
// not a count from zero.
function useCountUp(value: number, reduced: boolean): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    if (reduced || shownRef.current === value) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    const start = performance.now();
    const duration = 600;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (value - from) * eased);
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return shown;
}

// ─── The header pill ───────────────────────────────────────────────────────

function pillJob(jobs: JobSnapshot[], now: number): JobSnapshot | null {
  return (
    jobs.find((j) => j.status === "running") ??
    jobs.find((j) => j.finishedAt && now - Date.parse(j.finishedAt) < PILL_AFTER_FINISH_MS) ??
    null
  );
}

// "Re-crawling · 23/210", in the sidebar on a desktop and the top bar on a
// phone, on every page while a run is live. Pressed, it opens the panel over
// whatever page you are on.
export function JobPill({ variant }: { variant: "sidebar" | "rail" | "topbar" }) {
  const { jobs, openPanel } = useJobs();
  const ref = useRef<HTMLButtonElement>(null);
  const job = pillJob(jobs, Date.now());
  if (!job) return null;
  const live = job.status === "running";
  const pct = job.total > 0 ? job.done / job.total : 0;
  const label = live
    ? `${job.verb} · ${job.done}/${job.total}`
    : job.status === "finished"
      ? `${JOB_TITLES[job.kind]} done · ${job.done}/${job.total}`
      : job.status === "stopped"
        ? `${JOB_TITLES[job.kind]} stopped · ${job.done}/${job.total}`
        : `${JOB_TITLES[job.kind]} did not finish`;

  const mark = live ? (
    <span className="job-pulse h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
  ) : job.status === "interrupted" ? (
    <IconAlertTriangle size={14} className="shrink-0 text-warn" aria-hidden />
  ) : job.status === "finished" ? (
    <IconCircleCheck size={14} className="shrink-0 text-ok" aria-hidden />
  ) : (
    <IconPlayerStopFilled size={12} className="shrink-0 text-muted" aria-hidden />
  );

  if (variant === "rail") {
    // The icon rail has 64px: a ring that fills as the run does.
    const r = 13;
    const c = 2 * Math.PI * r;
    return (
      <button
        ref={ref}
        type="button"
        onClick={() => openPanel(job.id, ref.current)}
        title={label}
        aria-label={label}
        className="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-wash"
      >
        <svg width="32" height="32" viewBox="0 0 32 32" className="absolute inset-0.5" aria-hidden>
          <circle cx="16" cy="16" r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth="3" />
          <circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            stroke="rgb(var(--c-accent))"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform="rotate(-90 16 16)"
            style={{ transition: "stroke-dashoffset var(--motion-progress) var(--motion-ease)" }}
          />
        </svg>
        {mark}
      </button>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => openPanel(job.id, ref.current)}
      aria-label={`${label} — open progress`}
      className={`num relative flex min-w-0 items-center gap-2 overflow-hidden rounded-full border border-line bg-surface text-xs font-medium tabular-nums text-ink shadow-card hover:bg-wash ${
        variant === "topbar" ? "h-8 max-w-[150px] px-2.5" : "h-8 w-full px-3"
      }`}
    >
      {mark}
      <span className="min-w-0 truncate">{variant === "topbar" && live ? `${job.done}/${job.total}` : label}</span>
      {live && (
        <span
          className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent"
          style={{
            transform: `scaleX(${pct})`,
            transition: "transform var(--motion-progress) var(--motion-ease)",
          }}
          aria-hidden
        />
      )}
    </button>
  );
}

// The panel, over whatever page the pill was pressed on: a bottom sheet on a
// phone, a card beside the pill on a desktop.
function JobPopover({
  job,
  anchor,
  onClose,
}: {
  job: JobSnapshot;
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const phone = useIsPhone();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phone) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [phone, onClose]);

  if (phone) {
    return (
      <Sheet open onClose={onClose} title={JOB_TITLES[job.kind]}>
        <div className="px-4 pb-4">
          <JobProgressPanel job={job} showPageLink className="!border-0 !px-0 !shadow-none" />
        </div>
      </Sheet>
    );
  }

  const style: React.CSSProperties = anchor
    ? { top: Math.max(12, anchor.top - 4), left: anchor.right + 12 }
    : { top: 16, right: 16 };

  return createPortal(
    <div
      ref={ref}
      className="motion-dialog-in fixed z-[60] w-[420px] max-w-[calc(100vw-2rem)]"
      style={style}
      role="dialog"
      aria-label={`${JOB_TITLES[job.kind]} progress`}
    >
      <JobProgressPanel job={job} showPageLink className="shadow-card-hover" />
    </div>,
    document.body,
  );
}
