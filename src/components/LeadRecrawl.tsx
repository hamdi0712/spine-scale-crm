"use client";

// Re-crawling Pipeline leads' websites, one at a time on the server, with the
// Apify estimate confirmed first. Used by the Pipeline table's selection bar
// and by the "Re-crawl all leads crawled before…" card, each with a panel of
// its own (source tells their runs apart).

import { useState } from "react";
import { fmtEstimate } from "@/lib/pipelineSettings";
import { CrawlTarget, leadsCrawledBefore } from "@/lib/actions/leadRecrawl";
import { startLeadRecrawl } from "@/lib/actions/jobs";
import { JobProgressFor, useJobRun } from "@/components/JobProgress";
import { confirmText } from "@/lib/displayMode";

type RecrawlSource = "pipeline-recrawl-selected" | "pipeline-recrawl-before";

export function useLeadRecrawl(costPerClinic: number, source: RecrawlSource = "pipeline-recrawl-selected") {
  const { running, track } = useJobRun(source);

  async function run(targets: CrawlTarget[], what: string) {
    if (targets.length === 0 || running) return;
    if (
      !confirm(
        confirmText(
          `Re-crawl the website of ${targets.length} ${what}? ${fmtEstimate(targets.length * costPerClinic)} in Apify usage (Website Content Crawler only).\n\nTheir stored website notes and links are replaced. Nothing is re-scored and no stage changes. Leads without a website URL are skipped.`,
          `Re-crawl ${targets.length} ${what}? · ${fmtEstimate(targets.length * costPerClinic)} · Replaces stored website notes.`,
        ),
      )
    ) {
      return;
    }
    const started = await startLeadRecrawl(
      targets.map((t) => t.id),
      source,
    ).catch(() => null);
    if (!started || !started.ok) {
      alert(started?.error ?? "The re-crawl could not be started. Check the server is still up.");
      return;
    }
    track(started.id);
  }

  const panel = <JobProgressFor source={source} className="mb-3" />;

  return { run, running, panel };
}

// "Re-crawl all leads crawled before [date]": for leads still on the old
// 3-page crawl.
export function RecrawlOldLeads({ costPerClinic }: { costPerClinic: number }) {
  const { run, running } = useLeadRecrawl(costPerClinic, "pipeline-recrawl-before");
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
      <JobProgressFor source="pipeline-recrawl-before" className="mt-2" />
    </div>
  );
}
