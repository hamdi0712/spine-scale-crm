"use client";

// Search history — every search that has been run, how worn it is, and the
// one place a person can overrule the count.
//
// The list is the point and the editing is the exception, so the table reads
// as a table: what was searched for, its status, how many runs are behind that
// status, and when it was last used. The status pill is the only thing on the
// row that does anything — clicking it opens the four tiers and a way back to
// the count.
//
// Rows arrive already sorted (most recently used first) and already normalised
// from the server. Everything here is presentation and one server call per
// edit; the router refresh is what brings the new state back, rather than this
// keeping a second copy of the list in sync by hand.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  APIFY_SEARCH_STATUSES,
  APIFY_SEARCH_STATUS_LABELS,
  APIFY_SEARCH_TYPES,
  APIFY_SEARCH_TYPE_LABELS,
  APIFY_SEARCH_TYPE_MEANINGS,
  ApifySearchLogRow,
  ApifySearchStatus,
  ApifySearchType,
  describeSearchKey,
  searchStatus,
} from "@/lib/apifySearchLog";
import {
  addApifySearchLogEntry,
  deleteApifySearchLogEntry,
  setApifySearchStatusOverride,
} from "@/lib/actions/apifySearchLog";
import { SearchUsageBadge } from "@/components/Badge";
import { fmtDateTime } from "@/lib/format";

export default function SearchHistoryPanel({
  rows,
}: {
  rows: ApifySearchLogRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  // Which kind of search the list is showing. "All" is the default because
  // two pathways' searches are two halves of the same question — what have we
  // already ground through — and splitting them by default would answer it
  // twice.
  const [filter, setFilter] = useState<ApifySearchType | "">("");
  const shown = filter === "" ? rows : rows.filter((row) => row.type === filter);

  function setStatus(id: string, status: ApifySearchStatus | null) {
    startTransition(async () => {
      await setApifySearchStatusOverride({ id, status });
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteApifySearchLogEntry(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={filter === ""}
            label={`All (${rows.length})`}
            onClick={() => setFilter("")}
          />
          {APIFY_SEARCH_TYPES.map((type) => (
            <FilterChip
              key={type}
              active={filter === type}
              label={`${APIFY_SEARCH_TYPE_LABELS[type]} (${rows.filter((r) => r.type === type).length})`}
              title={APIFY_SEARCH_TYPE_MEANINGS[type]}
              onClick={() => setFilter(type)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAdding((prev) => !prev)}
          className="btn ml-auto"
        >
          {adding ? "Cancel" : "Log a search by hand"}
        </button>
      </div>

      {adding && (
        <ManualAddForm
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}

      {shown.length === 0 ? (
        <div className="card px-6 py-10 text-center">
          <p className="text-sm font-medium">Nothing logged yet</p>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted">
            Every Apify import and every Clinic-First term is counted here from
            the moment it is run. Searches run before this existed are not —
            log them by hand and set the status they have really earned.
          </p>
        </div>
      ) : (
        // Everything .card is except its overflow-hidden, which would clip the
        // status menu off the bottom of the last row.
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Search</th>
                <th className="th">Kind</th>
                <th className="th">Status</th>
                <th className="th">Runs</th>
                <th className="th">Last used</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const { status, manual } = searchStatus(row);
                return (
                  <tr key={row.id}>
                    <td className="td max-w-[420px]">
                      <p className="truncate font-medium" title={row.key}>
                        {describeSearchKey(row.type, row.key)}
                      </p>
                    </td>
                    <td className="td text-xs text-muted">
                      {APIFY_SEARCH_TYPE_LABELS[row.type]}
                    </td>
                    <td className="td">
                      <StatusPicker
                        status={status}
                        manual={manual}
                        runCount={row.runCount}
                        disabled={pending}
                        onPick={(next) => setStatus(row.id, next)}
                      />
                    </td>
                    <td className="num td">{row.runCount}</td>
                    <td className="num td text-muted">
                      {row.lastRunAt ? (
                        fmtDateTime(row.lastRunAt)
                      ) : (
                        <span className="text-muted/70">Never run here</span>
                      )}
                    </td>
                    <td className="td text-right">
                      <button
                        type="button"
                        onClick={() => remove(row.id)}
                        disabled={pending}
                        className="btn-ghost text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`num rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-line/70 bg-wash/60 text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

// The pill, and the four tiers behind it.
//
// It is a button wearing a badge rather than a select, because the pill is
// what the rest of the app draws for a status and swapping it for a dropdown
// on this one screen would make the same state look like a different thing.
function StatusPicker({
  status,
  manual,
  runCount,
  disabled,
  onPick,
}: {
  status: ApifySearchStatus;
  manual: boolean;
  runCount: number;
  disabled: boolean;
  onPick: (status: ApifySearchStatus | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Clicking anywhere else closes it, the same way any other menu on a page
  // like this behaves.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={box} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        <SearchUsageBadge status={status} manual={manual} runCount={runCount} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 w-[210px] rounded-[10px] border border-line bg-surface p-1 shadow-card"
        >
          {APIFY_SEARCH_STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(option);
                setOpen(false);
              }}
              className={`block w-full rounded-[7px] px-3 py-1.5 text-left text-xs hover:bg-wash ${
                option === status ? "font-medium" : "text-muted"
              }`}
            >
              {APIFY_SEARCH_STATUS_LABELS[option]}
            </button>
          ))}
          {/* Only offered when there is an override to clear — on a row whose
              status is the count's own reading there is nothing to undo. */}
          {manual && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
              className="mt-1 block w-full rounded-[7px] border-t border-line/60 px-3 py-1.5 text-left text-xs text-muted hover:bg-wash"
            >
              Clear — read it off the {runCount} run
              {runCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Logging a search that was never run through tracking. Its status is the
// whole reason the row exists, so the form asks for one and defaults to the
// tier somebody reaching for this form most likely means.
function ManualAddForm({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<ApifySearchType>("CLINIC_KEYWORD");
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<ApifySearchStatus>("WELL_USED");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function submit() {
    setError(null);
    startSave(async () => {
      const result = await addApifySearchLogEntry({ type, raw, status });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRaw("");
      onDone();
    });
  }

  return (
    <div className="card space-y-4 p-6">
      <div>
        <p className="text-sm font-medium">Log a search by hand</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          For a keyword or a search that was being run long before any of this
          was counted. It is logged with no runs behind it — the status is
          yours, and stays yours until you change it.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div>
          <label className="field-label" htmlFor="logType">
            Kind
          </label>
          <select
            id="logType"
            value={type}
            onChange={(e) => setType(e.target.value as ApifySearchType)}
            className="field"
          >
            {APIFY_SEARCH_TYPES.map((option) => (
              <option key={option} value={option}>
                {APIFY_SEARCH_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="logKey">
            {type === "LINKEDIN_SEARCH" ? "Search input (JSON)" : "Keyword"}
          </label>
          {type === "LINKEDIN_SEARCH" ? (
            <textarea
              id="logKey"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder='{"keywords": "chiropractor", "location": "United States"}'
              className="field font-mono text-xs"
            />
          ) : (
            <input
              id="logKey"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="spinal decompression"
              className="field"
            />
          )}
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {type === "LINKEDIN_SEARCH"
              ? "Pasted as it goes into the actor. Spacing and key order do not matter — it is canonicalised, so the same search always finds the same row."
              : "Matched the way the panel matches its terms: trimmed, and case is ignored."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="field-label" htmlFor="logStatus">
            Status
          </label>
          <select
            id="logStatus"
            value={status}
            onChange={(e) => setStatus(e.target.value as ApifySearchStatus)}
            className="field"
          >
            {APIFY_SEARCH_STATUSES.map((option) => (
              <option key={option} value={option}>
                {APIFY_SEARCH_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={saving || raw.trim() === ""}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Log it"}
        </button>
      </div>
      {error && (
        <p className="text-xs leading-relaxed text-bad">{error}</p>
      )}
    </div>
  );
}
