"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { IconChevronRight, IconLayoutGrid, IconList, IconMail, IconMapPin, IconSearch } from "@tabler/icons-react";
import { EMAIL_LEAD_NEXT, EmailLeadStatus } from "@/lib/emailChannel";
import { IcpTier } from "@/lib/icp";
import { EmailToSend, inboxShort } from "@/lib/emailWorkflow";
import { EmailStatusBadge, IcpScoreBadge, IcpTierChip } from "@/components/Badge";
import EmailSendButtons, { RiskyTag } from "@/components/EmailSendButtons";
import { startEmailCheckJob, startFacebookEmailJob, startOwnerJob } from "@/lib/actions/jobs";
import { useJobRun } from "@/components/JobProgress";
import { LostTag, isLost } from "@/components/LostLeads";
import ContactFormButtons from "@/components/ContactFormButtons";
import { PIPELINE_EMAIL_TAB_COOKIE, recalledPipelineFilter, rememberPipelineFilter } from "@/lib/emailChannel";

export interface EmailLeadRow {
  id: string;
  clinicName: string;
  contactName: string | null;
  location: string | null;
  email: string | null;
  // "Owner · Valid", "Front desk · Not checked". Null without an address.
  emailDetail: string | null;
  // An address on the lead (the email or an alternate) is risky: its domain
  // accepts every address, so it can't be confirmed.
  risky: boolean;
  icpTier: IcpTier | null;
  icpVerdict: string | null;
  icpScore: string | null;
  status: EmailLeadStatus;
  // A Contact form / Form sent lead: the buttons that stand in for the address.
  form: { leadId: string; contactFormUrl: string | null; message: { subject: string; body: string }; lastSentLabel: string | null } | null;
  sequence: string;
  // The email to send now — Email 1 once Ready, or the follow-up that is due —
  // with its buttons on the row. Null for everything else.
  toSend: EmailToSend | null;
  // There is one, but it cannot go yet (no inbox, nobody to sign it as).
  sendBlocked: string | null;
  followUpDueToday: boolean;
  // The inbox it is sent from, and what that inbox has sent today.
  inbox: string | null;
  inboxSentToday: number;
  inboxLimit: number;
  inboxRiskySentToday: number;
  riskyLimit: number;
  // The main address is risky and accepted by hand; flagged for review after
  // a bounce on its domain.
  riskyAccepted: boolean;
  riskyFlagged: boolean;
  // The lead's pipeline stage. Lost leads are hidden unless the Lost chip is
  // picked (or a search by clinic name finds one).
  stage: string;
}

const VIEW_KEY = "pipeline-email-view";
const TIER_DOT: Record<"A" | "B" | "C", string> = { A: "bg-ok", B: "bg-warn", C: "bg-bad" };

// Six tabs rather than a chip per status: the statuses grouped by what the
// work is. "Needs work" is everything waiting on the operator before it can be
// sent; "Done" is everything the sequence has finished with, one way or
// another. Due today cuts across them (every lead in it is In sequence).
type Filter = "all" | "email" | "noemail" | "risky" | "ready" | "form" | "due" | "work" | "sequence" | "done" | "lost";

const FILTERS: Filter[] = ["all", "email", "noemail", "risky", "ready", "form", "due", "work", "sequence", "done", "lost"];

function readFilter(v: unknown): Filter | null {
  return (FILTERS as unknown[]).includes(v) ? (v as Filter) : null;
}

const FILTER_STATUSES: Record<Exclude<Filter, "all" | "due" | "email" | "noemail" | "risky" | "lost">, EmailLeadStatus[]> = {
  ready: ["ready"],
  form: ["contact_form", "form_sent"],
  work: ["needs_opener", "needs_manual_opener", "check_email", "check_contact", "no_email"],
  sequence: ["in_sequence"],
  done: ["replied", "stopped", "not_ab"],
};

// Lost leads are in the Lost chip and no other: every other chip, and its
// count, leaves them out.
function matches(row: EmailLeadRow, filter: Filter): boolean {
  if (filter === "lost") return isLost(row.stage);
  if (isLost(row.stage)) return false;
  if (filter === "all") return true;
  if (filter === "due") return row.followUpDueToday;
  // Every lead with an address, whatever it is waiting on.
  if (filter === "email") return row.email !== null;
  if (filter === "noemail") return row.email === null && row.form === null;
  if (filter === "risky") return row.risky;
  return FILTER_STATUSES[filter].includes(row.status);
}

// The Email view of the pipeline: one row per clinic, built around the one
// thing to do next. Every tab is always shown with its count, so the set
// reads the same on every visit. Due today opens first when there is any:
// it is the work that cannot wait.
// initialTab: the tab a link opened the page on (?tab=, from a Dashboard card).
export default function EmailLeadTable({ rows, initialTab }: { rows: EmailLeadRow[]; initialTab?: string }) {
  const router = useRouter();
  const due = rows.filter((r) => r.followUpDueToday && !isLost(r.stage)).length;
  const [filter, setFilter] = useState<Filter>(readFilter(initialTab) ?? (due > 0 ? "due" : "all"));
  // Remembered so coming back from a lead's page lands on the same chip.
  useEffect(() => {
    const f = readFilter(recalledPipelineFilter(PIPELINE_EMAIL_TAB_COOKIE, "tab"));
    if (f) setFilter(f);
  }, []);
  function pickFilter(f: Filter) {
    setFilter(f);
    rememberPipelineFilter(PIPELINE_EMAIL_TAB_COOKIE, f);
  }
  const [query, setQuery] = useState("");
  // The big monitor's extras: cards or the table, a tier and an inbox filter,
  // and a sort. Below the wide breakpoint none of these are shown and the
  // table is the view; the choice of view is remembered per browser.
  const [view, setView] = useState<"cards" | "table">("cards");
  const [tiers, setTiers] = useState<Set<string>>(new Set());
  const [inbox, setInbox] = useState("");
  const [sort, setSort] = useState<"updated" | "score" | "name">("updated");
  // The pick for the bulk actions, as on Discovery: tick cards or rows, or
  // Select all for everything the filters show.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The tick boxes only show in select mode; leaving it drops the pick.
  const [selecting, setSelecting] = useState(false);
  function setSelectMode(on: boolean) {
    setSelecting(on);
    if (!on) setPicked(new Set());
  }
  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "table") setView("table");
    } catch {}
  }, []);
  function chooseView(v: "cards" | "table") {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }
  const inboxes = useMemo(() => Array.from(new Set(rows.map((r) => r.inbox).filter((x): x is string => !!x))).sort(), [rows]);

  const tabs = useMemo(
    () =>
      (
        [
          ["all", "All"],
          ["email", "Has email"],
          ["noemail", "No email"],
          ["risky", "Risky"],
          ["ready", "Ready"],
          ["form", "Contact form"],
          ["due", "Due today"],
          ["work", "Needs work"],
          ["sequence", "In sequence"],
          ["done", "Done"],
          ["lost", "Lost"],
        ] as [Filter, string][]
      ).map(([key, label]) => ({ key, label, count: rows.filter((r) => matches(r, key)).length })),
    [rows],
  );

  const q = query.trim().toLowerCase();
  const shown = rows
    .filter(
      (r) =>
        // A search by clinic name finds a Lost lead from any chip.
        (matches(r, filter) || (q !== "" && isLost(r.stage) && r.clinicName.toLowerCase().includes(q))) &&
        (tiers.size === 0 || (r.icpTier !== null && tiers.has(r.icpTier))) &&
        (inbox === "" || r.inbox === inbox) &&
        (q === "" ||
          [r.clinicName, r.contactName, r.location, r.email].some((v) => (v ?? "").toLowerCase().includes(q))),
    )
    .sort((a, b) =>
      sort === "score"
        ? (Number(b.icpScore) || -1) - (Number(a.icpScore) || -1)
        : sort === "name"
          ? a.clinicName.localeCompare(b.clinicName)
          : 0,
    );
  const cards = view === "cards";
  const tagLost = filter !== "lost";
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));
  function pickAll(on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }
  const pickedRows = rows.filter((r) => picked.has(r.id));
  const extras = (
    <>
          <select value={inbox} onChange={(e) => setInbox(e.target.value)} aria-label="Inbox" className="field !h-8 w-auto text-[13px]">
            <option value="">All inboxes</option>
            {inboxes.map((i) => (
              <option key={i} value={i}>
                {inboxShort(i)}
              </option>
            ))}
          </select>
          <div className="flex rounded-[10px] border border-line p-0.5" role="group" aria-label="Tier">
            {(["A", "B", "C"] as const).map((t) => {
              const on = tiers.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setTiers((prev) => {
                      const next = new Set(prev);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      return next;
                    })
                  }
                  className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors ${on ? "bg-wash text-ink" : "text-muted hover:text-ink"}`}
                >
                  <span className={`h-2 w-2 rounded-full ${TIER_DOT[t]}`} aria-hidden />
                  {t}
                </button>
              );
            })}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort" className="field !h-8 w-auto text-[13px]">
            <option value="updated">Recently updated</option>
            <option value="score">Highest score</option>
            <option value="name">Clinic name</option>
          </select>
          <div className="flex rounded-[10px] border border-line p-0.5" role="group" aria-label="View">
            <button type="button" aria-pressed={cards} aria-label="Cards" onClick={() => chooseView("cards")} className={`flex h-6 w-7 items-center justify-center rounded-md ${cards ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}>
              <IconLayoutGrid size={16} stroke={2} aria-hidden />
            </button>
            <button type="button" aria-pressed={!cards} aria-label="Table" onClick={() => chooseView("table")} className={`flex h-6 w-7 items-center justify-center rounded-md ${!cards ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}>
              <IconList size={16} stroke={2} aria-hidden />
            </button>
          </div>
        </>
  );

  return (
    <div className="md:card md:overflow-hidden wide:overflow-visible wide:rounded-none wide:border-0 wide:bg-transparent wide:shadow-none">
      {/* The big monitor's toolbar, its own card: search across the top with
          the filters, sort and view beside it, and the tabs as chips below. */}
      <div className="card mb-4 hidden flex-col gap-2 overflow-visible px-3 py-2.5 wide:flex">
        <div className="flex items-center gap-2">
          <label className="relative flex flex-1 items-center">
            <span className="sr-only">Search</span>
            <IconSearch size={15} stroke={2} aria-hidden className="pointer-events-none absolute left-3 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clinics, contacts, emails…"
              className="field !h-8 w-full pl-9 text-[13px]"
            />
          </label>
          {extras}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter">
          {tabs.map((tab) => {
            const on = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => pickFilter(tab.key)}
                aria-pressed={on}
                className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[11px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                  on ? "border-accent/40 bg-accent-soft font-semibold text-accent" : "border-line font-medium text-ink-soft hover:bg-wash"
                }`}
              >
                {tab.label}
                <span className="num opacity-70">{tab.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <SelectionBar
        rows={pickedRows}
        allPicked={allPicked}
        shownCount={shown.length}
        onPickAll={pickAll}
        onClear={() => setPicked(new Set())}
        selecting={selecting}
        onSelectMode={setSelectMode}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 md:mb-0 md:border-b md:border-line/60 md:px-4 md:py-3 wide:hidden">
        <div className="m-pill-row flex flex-wrap items-center gap-1" role="group" aria-label="Filter">
          {tabs.map((tab) => {
            const on = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => pickFilter(tab.key)}
                aria-pressed={on}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                  on ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-wash hover:text-ink"
                }`}
              >
                {tab.label}
                <span className={`num text-xs ${on ? "opacity-90" : "opacity-70"}`}>{tab.count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex w-full items-center gap-2 md:w-auto">
        {/* Below the big monitor, Select sits here beside the search rather
            than on a row of its own. */}
        {!selecting && (
          <button
            type="button"
            onClick={() => setSelectMode(true)}
            disabled={shown.length === 0}
            className="btn !h-9 !px-3 text-sm max-md:hidden disabled:cursor-not-allowed disabled:opacity-50"
          >
            Select
          </button>
        )}
        <label className="relative flex w-full items-center md:w-60">
          <span className="sr-only">Search clinics</span>
          <IconSearch size={15} stroke={2} aria-hidden className="pointer-events-none absolute left-3 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clinics"
            className="field h-9 w-full pl-9 text-sm"
          />
        </label>
        </div>
      </div>

      {/* The big monitor's cards: three across, a clinic each. The whole card
          opens the lead; its send buttons do their own thing. */}
      <ul className={`hidden grid-cols-3 gap-3 ${cards ? "wide:grid" : ""}`}>
        {shown.map((row) => (
          <li
            key={row.id}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
              router.push(`/pipeline/${row.id}`);
            }}
            className={`card card-sheen group flex cursor-pointer flex-col gap-2 p-3.5 ${picked.has(row.id) ? "border-accent/40 bg-accent/5" : ""} transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
              {selecting && (
                <input
                  type="checkbox"
                  checked={picked.has(row.id)}
                  onChange={(e) => toggle(row.id, e.target.checked)}
                  aria-label={`Select ${row.clinicName}`}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                />
              )}
              <div className="min-w-0">
                <Link href={`/pipeline/${row.id}`} className="block truncate text-sm font-semibold text-ink">
                  {row.clinicName}
                  {tagLost && isLost(row.stage) && <LostTag />}
                </Link>
                <p className="mt-0.5 truncate text-[11px] text-muted">{row.contactName ?? "No contact yet"}</p>
              </div>
              </div>
              {row.icpVerdict ? (
                <IcpTierChip tier={row.icpTier} verdict={row.icpVerdict} score={row.icpScore} />
              ) : (
                <IcpScoreBadge
                  tier={row.icpTier}
                  total={row.icpScore ? Number(row.icpScore.split("/")[0]) : null}
                  max={row.icpScore ? Number(row.icpScore.split("/")[1]) : 100}
                />
              )}
            </div>
            <div className={`space-y-0.5 ${selecting ? "pl-[26px]" : ""} text-[12.5px]`}>
              <p className="flex min-w-0 items-center gap-2 text-ink-soft">
                <IconMapPin size={13} stroke={1.75} aria-hidden className="shrink-0 text-muted" />
                <span className="truncate">{row.location ?? "—"}</span>
              </p>
              {row.form ? (
                <div className="pt-1">
                  <ContactFormButtons {...row.form} compact />
                </div>
              ) : (
                <p className={`flex min-w-0 items-center gap-2 ${row.email ? "text-ink-soft" : "text-muted"}`} title={row.emailDetail ?? undefined}>
                  <IconMail size={13} stroke={1.75} aria-hidden className="shrink-0 text-muted" />
                  <span className="truncate">{row.email ?? "No email yet"}</span>
                  {row.riskyAccepted && <RiskyTag />}
                  {row.riskyFlagged && <span className="text-[11px] font-medium text-warn">Review</span>}
                </p>
              )}
            </div>
            <div className={`mt-auto flex flex-wrap items-center justify-between gap-2 ${selecting ? "pl-[26px]" : ""} pt-0.5 text-[11px] [&>span:first-child]:h-5 [&>span:first-child]:px-2 [&>span:first-child]:text-[11px]`}>
              <EmailStatusBadge status={row.status} />
              {row.sendBlocked && !row.toSend ? (
                <span className="truncate text-xs text-bad" title={row.sendBlocked}>Can&apos;t send yet</span>
              ) : row.toSend ? (
                <EmailSendButtons leadId={row.id} toSend={row.toSend} inboxSentToday={row.inboxSentToday} inboxLimit={row.inboxLimit} inboxRiskySentToday={row.inboxRiskySentToday} riskyLimit={row.riskyLimit} compact />
              ) : (
                <span className="truncate text-[11px] text-muted">{row.followUpDueToday ? "Send the follow-up" : EMAIL_LEAD_NEXT[row.status]}</span>
              )}
            </div>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="card col-span-3 px-4 py-10 text-center text-sm text-muted">
            {q ? "No clinic matches that search." : "Nothing here right now."}
          </li>
        )}
      </ul>

      {/* A phone gets a card per clinic: who, the address, the status and the
          next move. Tier and sequence are on the desktop table and the lead. */}
      <ul className="space-y-2.5 md:hidden">
        {shown.map((row) => (
          <li key={row.id}>
            <Link href={`/pipeline/${row.id}`} className="card card-interactive block p-3.5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-[15px] font-medium leading-snug text-ink">
                  {row.clinicName}
                  {tagLost && isLost(row.stage) && <LostTag />}
                </span>
                <EmailStatusBadge status={row.status} />
              </div>
              <p className={`mt-1 truncate text-sm ${row.email ? "text-ink/80" : "text-muted"}`}>
                {row.form ? (row.form.lastSentLabel ?? "Contact form — open the lead to send it") : (row.email ?? "No email yet")}
                {row.riskyAccepted && <> <RiskyTag /></>}
              </p>
              <p className="mt-2 text-xs font-medium text-accent">
                {row.followUpDueToday ? "Send the follow-up" : EMAIL_LEAD_NEXT[row.status]} →
              </p>
            </Link>
            {row.toSend && (
              <div className="mt-2 px-1">
                <EmailSendButtons leadId={row.id} toSend={row.toSend} inboxSentToday={row.inboxSentToday} inboxLimit={row.inboxLimit} inboxRiskySentToday={row.inboxRiskySentToday} riskyLimit={row.riskyLimit} compact />
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && (
          <li className="card px-4 py-6 text-center text-sm text-muted">
            {q ? "No clinic matches that search." : "Nothing here right now."}
          </li>
        )}
      </ul>

      <div className={`overflow-x-auto max-md:hidden wide:card ${cards ? "wide:hidden" : ""}`}>
        {/* On the big monitor the rows are drawn at the toolbar's scale. */}
        <table className="w-full wide:[&_.td]:text-[13px] wide:[&_.td]:py-2.5 wide:[&_.th]:py-2 wide:[&_.th]:text-[11px]">
          <thead>
            <tr>
              {selecting && (
                <th className="th w-10 pr-0">
                  <input type="checkbox" checked={allPicked} onChange={(e) => pickAll(e.target.checked)} aria-label="Select all" className="h-4 w-4 accent-accent" />
                </th>
              )}
              <th className="th">Clinic</th>
              <th className="th">Email</th>
              <th className="th">Tier</th>
              <th className="th">Status</th>
              <th className="th text-right">Next step</th>
              <th className="th w-8" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={row.id}
                // The whole row opens the lead. A press on one of its own
                // buttons or links (Gmail, Copy, Mark sent, the next step) does
                // that thing instead.
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
                  router.push(`/pipeline/${row.id}`);
                }}
                className="group cursor-pointer transition-colors hover:bg-wash/70"
              >
                {selecting && (
                  <td className="td w-10 pr-0">
                    <input
                      type="checkbox"
                      checked={picked.has(row.id)}
                      onChange={(e) => toggle(row.id, e.target.checked)}
                      aria-label={`Select ${row.clinicName}`}
                      className="h-4 w-4 accent-accent"
                    />
                  </td>
                )}
                <td className="td">
                  <Link
                    href={`/pipeline/${row.id}`}
                    className="inline-block font-medium text-ink transition-transform duration-200 group-hover:translate-x-1"
                  >
                    {row.clinicName}
                  </Link>
                  {tagLost && isLost(row.stage) && <LostTag />}
                  <div className="mt-0.5 text-xs text-muted">
                    {[row.contactName ?? "No contact yet", row.location].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="td">
                  {row.form ? (
                    <ContactFormButtons {...row.form} compact />
                  ) : row.email ? (
                    <>
                      <div className="break-all text-sm text-ink">
                        {row.email}
                      </div>
                      {/* "Front desk · Risky": the check result carries the
                          yellow Risky highlight here, so the address itself
                          needs no second tag. */}
                      {row.emailDetail && (
                        <div className="mt-0.5 text-xs text-muted">
                          {row.emailDetail.split(" · ").map((part, i) => (
                            <span key={i}>
                              {i > 0 && " · "}
                              {part === "Risky" ? <RiskyTag /> : part}
                            </span>
                          ))}
                        </div>
                      )}
                      {row.inbox && <div className="mt-0.5 text-xs text-muted">from {inboxShort(row.inbox)}</div>}
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="td">
                  {row.icpTier || row.icpVerdict ? (
                    <IcpTierChip tier={row.icpTier} verdict={row.icpVerdict} score={row.icpScore} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="td">
                  <EmailStatusBadge status={row.status} />
                  <div className="num mt-1 text-xs text-muted">{row.sequence}</div>
                </td>
                <td className="td text-right">
                  {row.sendBlocked && !row.toSend ? (
                    <span className="text-xs text-bad">{row.sendBlocked}</span>
                  ) : row.toSend ? (
                    <div className="flex justify-end">
                      <EmailSendButtons leadId={row.id} toSend={row.toSend} inboxSentToday={row.inboxSentToday} inboxLimit={row.inboxLimit} inboxRiskySentToday={row.inboxRiskySentToday} riskyLimit={row.riskyLimit} compact />
                    </div>
                  ) : (
                    <Link href={`/pipeline/${row.id}`} className="btn h-8 whitespace-nowrap px-3 text-xs">
                      {EMAIL_LEAD_NEXT[row.status]}
                    </Link>
                  )}
                </td>
                {/* The arrow that says the row opens: hidden until the row is
                    hovered, then sliding in. */}
                <td className="td w-8 pl-0 pr-4">
                  <IconChevronRight
                    size={18}
                    stroke={2}
                    aria-hidden
                    className="-translate-x-1 text-muted opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                  />
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={selecting ? 7 : 6}>
                  {q ? "No clinic matches that search." : "Nothing here right now."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The pick's bar: Select all, how many are ticked, and the email-finding runs
// for just those leads. Each run takes only the picked leads it applies to
// (Check: ones with an address; Facebook and owners: their own waiting lists)
// and says so when none of them qualify.
function SelectionBar({
  rows,
  allPicked,
  shownCount,
  onPickAll,
  onClear,
  selecting,
  onSelectMode,
}: {
  rows: EmailLeadRow[];
  allPicked: boolean;
  shownCount: number;
  onPickAll: (on: boolean) => void;
  onClear: () => void;
  selecting: boolean;
  onSelectMode: (on: boolean) => void;
}) {
  const check = useJobRun("email-check");
  const facebook = useJobRun("facebook-emails");
  const owners = useJobRun("find-owners");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = rows.map((r) => r.id);
  const withEmail = rows.filter((r) => r.email !== null).length;
  const noEmail = rows.length - withEmail;

  async function run(
    key: string,
    ask: string,
    start: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>,
    track: (id: string) => void,
  ) {
    if (!confirm(ask)) return;
    setError(null);
    setBusy(key);
    const r = await start().catch(() => ({ ok: false as const, error: "The run could not be started." }));
    setBusy(null);
    if (!r.ok) setError(r.error);
    else track(r.id);
  }

  const n = rows.length;
  const btn = "btn !h-8 !px-3 !text-[13px] disabled:cursor-not-allowed disabled:opacity-50";
  if (!selecting) {
    return (
      <div className="mb-3 hidden items-center wide:flex">
        <button type="button" onClick={() => onSelectMode(true)} className={btn} disabled={shownCount === 0}>
          Select
        </button>
      </div>
    );
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 max-md:hidden md:mb-0 md:border-b md:border-line/60 md:px-4 md:py-2.5 wide:mb-3 wide:border-0 wide:px-0 wide:py-0">
      <button type="button" onClick={() => onSelectMode(false)} className={btn}>
        Done
      </button>
      <label className="flex items-center gap-2 text-[13px] text-ink-soft">
        <input type="checkbox" checked={allPicked} onChange={(e) => onPickAll(e.target.checked)} disabled={shownCount === 0} className="h-4 w-4 accent-accent" />
        Select all
      </label>
      {n > 0 && (
        <>
          <span className="num ml-1 text-[13px] font-medium text-ink">{n} selected</span>
          <button
            type="button"
            className={btn}
            disabled={owners.running || busy !== null}
            onClick={() =>
              void run(
                "owners",
                `Find the owner for the ${n} selected lead${n === 1 ? "" : "s"}?\n\nNames come from the NPI Registry and the clinic's site (free); emails for confirmed owners use Hunter and Instantly credits. Leads that already have their owner are skipped.`,
                () => startOwnerJob({ leadIds: ids }),
                owners.track,
              )
            }
          >
            {busy === "owners" || owners.running ? "Finding owners…" : "Find owners"}
          </button>
          <button
            type="button"
            className={btn}
            disabled={withEmail === 0 || check.running || busy !== null}
            title={withEmail === 0 ? "None of the selected leads has an address" : undefined}
            onClick={() =>
              void run(
                "check",
                `Check the ${withEmail} selected address${withEmail === 1 ? "" : "es"} through Instantly? Each check uses Instantly credits.`,
                () => startEmailCheckJob({ leadIds: ids, force: true }),
                check.track,
              )
            }
          >
            {busy === "check" || check.running ? "Checking…" : `Check emails${withEmail > 0 ? ` (${withEmail})` : ""}`}
          </button>
          <button
            type="button"
            className={btn}
            disabled={noEmail === 0 || facebook.running || busy !== null}
            title={noEmail === 0 ? "Every selected lead already has an address" : undefined}
            onClick={() =>
              void run(
                "facebook",
                `Look for an email on the website and Facebook page of the ${noEmail} selected lead${noEmail === 1 ? "" : "s"} with no address?`,
                () => startFacebookEmailJob({ leadIds: ids }),
                facebook.track,
              )
            }
          >
            {busy === "facebook" || facebook.running ? "Reading…" : `Find on Facebook${noEmail > 0 ? ` (${noEmail})` : ""}`}
          </button>
          <button type="button" onClick={onClear} className="text-[13px] font-medium text-muted hover:text-ink">
            Clear
          </button>
        </>
      )}
      {error && <p className="basis-full text-xs text-bad">{error}</p>}
    </div>
  );
}
