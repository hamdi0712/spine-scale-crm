"use client";

// Re-crawling Pipeline leads' websites, one at a time, with the Apify estimate
// confirmed first. Used by the Pipeline table's selection bar and by the
// "Re-crawl all leads crawled before…" card.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtEstimate } from "@/lib/pipelineSettings";
import { CrawlTarget, leadsCrawledBefore, recrawlLeadWebsite } from "@/lib/actions/leadRecrawl";

interface Progress {
  done: number;
  total: number;
  current: string | null;
  failed: string[];
  summary: string | null;
}

export function useLeadRecrawl(costPerClinic: number) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const running = progress !== null && progress.summary === null;

  async function run(targets: CrawlTarget[], what: string) {
    if (targets.length === 0 || running) return;
    if (
      !confirm(
        `Re-crawl the website of ${targets.length} ${what}? ${fmtEstimate(targets.length * costPerClinic)} in Apify usage (Website Content Crawler only).\n\nTheir stored website notes and links are replaced. Nothing is re-scored and no stage changes. Leads without a website URL are skipped.`,
      )
    ) {
      return;
    }
    const failed: string[] = [];
    let wrote = 0;
    for (let i = 0; i < targets.length; i++) {
      setProgress({ done: i, total: targets.length, current: targets[i].clinicName, failed, summary: null });
      try {
        const r = await recrawlLeadWebsite(targets[i].id);
        if (r.ok) wrote++;
        else failed.push(`${r.clinicName}: ${r.error}`);
      } catch {
        failed.push(`${targets[i].clinicName}: the server could not be reached`);
      }
    }
    setProgress({
      done: targets.length,
      total: targets.length,
      current: null,
      failed,
      summary: `Re-crawled ${wrote} of ${targets.length}.${failed.length > 0 ? ` ${failed.length} failed.` : ""}`,
    });
    router.refresh();
  }

  const panel = progress ? (
    <div className="card mb-3 px-4 py-3 text-xs leading-relaxed max-md:px-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-ink-soft">
          {progress.summary ??
            `Re-crawling ${progress.done + 1} of ${progress.total}${progress.current ? ` — ${progress.current}` : ""}…`}
        </p>
        {progress.summary !== null && (
          <button type="button" className="btn-ghost shrink-0 px-2 py-0.5 text-xs" onClick={() => setProgress(null)}>
            Dismiss
          </button>
        )}
      </div>
      {progress.failed.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-bad">
          {progress.failed.map((f, i) => (
            <li key={i} className="break-words">{f}</li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  return { run, running, panel };
}

// "Re-crawl all leads crawled before [date]": for leads still on the old
// 3-page crawl.
export function RecrawlOldLeads({ costPerClinic }: { costPerClinic: number }) {
  const { run, running, panel } = useLeadRecrawl(costPerClinic);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [found, setFound] = useState<CrawlTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  async function find() {
    setError(null);
    setLooking(true);
    const r = await leadsCrawledBefore(`${date}T00:00:00`);
    setLooking(false);
    if (r.ok) setFound(r.leads);
    else setError(r.error);
  }

  return (
    <div className="mb-4">
      <div className="card flex flex-wrap items-center gap-2 px-4 py-3 text-sm max-md:px-3">
        <label htmlFor="recrawl-before" className="text-ink-soft">
          Re-crawl all leads crawled before
        </label>
        <input
          id="recrawl-before"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setFound(null);
          }}
          className="field w-auto"
        />
        <button type="button" className="btn" disabled={looking || running} onClick={() => void find()}>
          {looking ? "Finding…" : "Find leads"}
        </button>
        {found !== null && (
          <>
            <span className="num text-xs text-muted">
              {found.length} lead{found.length === 1 ? "" : "s"} with a website, last crawled before {date} ·{" "}
              {fmtEstimate(found.length * costPerClinic)}
            </span>
            {found.length > 0 && (
              <button
                type="button"
                className="btn-primary"
                disabled={running}
                onClick={() => void run(found, `lead${found.length === 1 ? "" : "s"} crawled before ${date}`)}
              >
                Re-crawl {found.length}
              </button>
            )}
          </>
        )}
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
      {panel && <div className="mt-2">{panel}</div>}
    </div>
  );
}
