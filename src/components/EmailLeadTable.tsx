"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { IconChevronRight, IconLayoutGrid, IconList, IconMail, IconMapPin, IconSearch } from "@tabler/icons-react";
import { EMAIL_LEAD_NEXT, EmailLeadStatus } from "@/lib/emailChannel";
import { IcpTier } from "@/lib/icp";
import { EmailToSend, inboxShort } from "@/lib/emailWorkflow";
import { EmailStatusBadge, IcpScoreBadge, IcpTierChip } from "@/components/Badge";
import EmailSendButtons, { RiskyTag } from "@/components/EmailSendButtons";
import { LostTag, isLost } from "@/components/LostLeads";
import {
  CONTACT_TABS,
  Filter,
  NO_SELECTION,
  STATUS_TABS,
  Selection,
  Sort,
  VIEW_STATE_KEY,
  chipCount,
  chipOn,
  parseViewState,
  pressChip,
  readSelection,
  serializeViewState,
  visibleRows,
  writeSelection,
} from "@/lib/emailFilters";
import type { MatchTag } from "@/lib/duplicates";
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
  // The same doctor or clinic on other leads: a Duplicate on the same
  // channel, "On LinkedIn" / "On Call" on another (src/lib/duplicates.ts).
  duplicates: MatchTag[];
  // Where the contact finder routed it: the Owner and Front desk chips.
  contactStatus: string | null;
  // The lead's pipeline stage. Lost leads are hidden unless the Lost chip is
  // picked (or a search by clinic name finds one).
  stage: string;
}

const VIEW_KEY = "pipeline-email-view";
const TIER_DOT: Record<"A" | "B" | "C", string> = { A: "bg-ok", B: "bg-warn", C: "bg-bad" };

// The chips and their rules: src/lib/emailFilters.ts (pure, and tested).

// The Email view of the pipeline: one row per clinic, built around the one
// thing to do next. Every tab is always shown with its count, so the set
// reads the same on every visit. Due today opens first when there is any:
// it is the work that cannot wait.
// initialTab: the tab a link opened the page on (?tab=, from a Dashboard card).
export default function EmailLeadTable({ rows, initialTab }: { rows: EmailLeadRow[]; initialTab?: string }) {
  const router = useRouter();
  const due = rows.filter((r) => r.followUpDueToday && !isLost(r.stage)).length;
  // One contact chip and at most one status chip (src/lib/emailFilters.ts).
  const [sel, setSel] = useState<Selection>(() => {
    const linked = readSelection(initialTab);
    return linked ?? (due > 0 ? { contact: "all", status: "due" } : NO_SELECTION);
  });
  // Remembered so coming back from a lead's page lands on the same chips.
  useEffect(() => {
    const f = readSelection(recalledPipelineFilter(PIPELINE_EMAIL_TAB_COOKIE, "tab"));
    if (f) setSel(f);
  }, []);
  function pickFilter(f: Filter) {
    const next = pressChip(sel, f);
    setSel(next);
    rememberPipelineFilter(PIPELINE_EMAIL_TAB_COOKIE, writeSelection(next));
  }
  const isOn = (f: Filter) => chipOn(sel, f);
  const [query, setQuery] = useState("");
  // The big monitor's extras: cards or the table, a tier and an inbox filter,
  // and a sort. Below the wide breakpoint none of these are shown and the
  // table is the view; the choice of view is remembered per browser.
  const [view, setView] = useState<"cards" | "table">("cards");
  const [tiers, setTiers] = useState<Set<string>>(new Set());
  const [inbox, setInbox] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  // Back from a lead's page: the tiers, sort, search and inbox as they were.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const st = parseViewState(sessionStorage.getItem(VIEW_STATE_KEY));
      if (st) {
        setTiers(new Set(st.tiers));
        setSort(st.sort);
        setQuery(st.query);
        setInbox(st.inbox);
      }
    } catch {
      // No storage (a private window): the view starts fresh.
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(VIEW_STATE_KEY, serializeViewState({ tiers: Array.from(tiers), sort, query, inbox }));
    } catch {}
  }, [restored, tiers, sort, query, inbox]);
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

  // The list and every count come from the same visibleRows(): a count is
  // exactly what pressing that chip would list, beside everything else active.
  const viewFilters = useMemo(() => ({ tiers: Array.from(tiers), inbox, query }), [tiers, inbox, query]);
  const tabGroups = useMemo(
    () =>
      [CONTACT_TABS, STATUS_TABS].map((group) =>
        (group as [Filter, string][]).map(([key, label]) => ({ key, label, count: chipCount(rows, sel, key, viewFilters) })),
      ),
    [rows, sel, viewFilters],
  );

  const q = query.trim().toLowerCase();
  const shown = visibleRows(rows, sel, viewFilters)
    .slice()
    .sort((a, b) =>
      sort === "score"
        ? (Number(b.icpScore) || -1) - (Number(a.icpScore) || -1)
        : sort === "name"
          ? a.clinicName.localeCompare(b.clinicName)
          : 0,
    );
  const cards = view === "cards";
  const tagLost = sel.status !== "lost";
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
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter">
          {tabGroups.map((group, gi) => (
            <Fragment key={gi}>
              {gi > 0 && <span className="mx-1.5 h-4 w-px bg-line" aria-hidden />}
              <div className="flex flex-wrap gap-1" role="group" aria-label={gi === 0 ? "Contact" : "Status"}>
                {group.map((tab) => {
                  const on = isOn(tab.key);
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
            </Fragment>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 md:mb-0 md:border-b md:border-line/60 md:px-4 md:py-3 wide:hidden">
        <div className="m-pill-row flex flex-wrap items-center gap-1" role="group" aria-label="Filter">
          {tabGroups.map((group, gi) => (
            <Fragment key={gi}>
              {gi > 0 && <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />}
              {group.map((tab) => {
                const on = isOn(tab.key);
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
            </Fragment>
          ))}
        </div>
        <div className="flex w-full items-center gap-2 md:w-auto">
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
            className={`card card-sheen group flex cursor-pointer flex-col gap-2 p-3.5 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
              <div className="min-w-0">
                <Link href={`/pipeline/${row.id}`} className="block truncate text-sm font-semibold text-ink">
                  {row.clinicName}
                  {tagLost && isLost(row.stage) && <LostTag />}
                  <DuplicateTag also={row.duplicates} />
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
            <div className={`space-y-0.5 text-[12.5px]`}>
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
            <div className={`mt-auto flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px] [&>span:first-child]:h-5 [&>span:first-child]:px-2 [&>span:first-child]:text-[11px]`}>
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
                  <DuplicateTag also={row.duplicates} />
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
                <td className="td">
                  <Link
                    href={`/pipeline/${row.id}`}
                    className="inline-block font-medium text-ink transition-transform duration-200 group-hover:translate-x-1"
                  >
                    {row.clinicName}
                  </Link>
                  {tagLost && isLost(row.stage) && <LostTag />}
                  <DuplicateTag also={row.duplicates} />
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
                <td className="td text-muted" colSpan={6}>
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

// The same doctor or clinic on another lead. Same channel: a warning
// "Duplicate". Another channel (LinkedIn, Call): a neutral "On LinkedIn".
// A label only; nothing is merged or blocked.
function DuplicateTag({ also }: { also: MatchTag[] }) {
  if (also.length === 0) return null;
  const dupes = also.filter((m) => m.kind === "duplicate");
  const elsewhere = Array.from(new Set(also.filter((m) => m.kind === "elsewhere").map((m) => m.pill)));
  const pill = "ml-1.5 inline-flex h-[18px] items-center rounded-full px-1.5 align-middle text-[10.5px] font-medium";
  return (
    <>
      {dupes.length > 0 && (
        <span title={dupes.map((m) => m.tooltip).join("; ")} className={`${pill} bg-warn-soft text-warn`}>
          Duplicate
        </span>
      )}
      {elsewhere.map((label) => (
        <span key={label} title={also.filter((m) => m.pill === label).map((m) => m.tooltip).join("; ")} className={`${pill} bg-wash text-muted`}>
          {label}
        </span>
      ))}
    </>
  );
}
