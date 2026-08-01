import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_SHORT_LABELS,
  LeadStage,
  OPEN_STAGES,
} from "@/lib/constants";
import { HEALTH_WINDOW_WEEKS, computeHealth } from "@/lib/health";
import { buildFocus, splitFocus, summariseFocus } from "@/lib/focus";
import { fmtMoney } from "@/lib/format";
import ActivityFeed from "@/components/ActivityFeed";
import BusinessHoursPanel, {
  BusinessHoursChip,
} from "@/components/BusinessHoursPanel";
import ClientHealthList, {
  HealthRow,
  HealthTeaser,
} from "@/components/ClientHealthList";
import Greeting from "@/components/Greeting";
import Icon from "@/components/Icons";
import PipelineDonut from "@/components/PipelineDonut";
import TodaysFocus from "@/components/TodaysFocus";

export const dynamic = "force-dynamic";

// How many rows the two feed cards carry before they defer to their full page.
// Both are deliberately short: the cards are a glance at the newest thing that
// happened and the newest clients on the books, not a place to read either
// list from.
const ACTIVITY_ROWS = 3;
const HEALTH_ROWS = 2;

export default async function DashboardPage() {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    activeClients,
    openLeads,
    focusCalls,
    focusClients,
    activity,
    activityTotal,
  ] = await Promise.all([
    prisma.client.findMany({
      where: { status: "ACTIVE" },
      orderBy: { clinicName: "asc" },
      include: {
        reports: { orderBy: { weekStart: "desc" }, take: HEALTH_WINDOW_WEEKS },
      },
    }),
    prisma.lead.findMany({
      where: { archived: false, stage: { in: [...OPEN_STAGES] } },
    }),
    // No lower bound: anything still marked Scheduled whose time has passed
    // is overdue, not gone. Archived leads have been closed out, so their
    // calls stop nagging.
    prisma.call.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { lte: dayEnd },
        OR: [{ leadId: null }, { lead: { archived: false } }],
      },
      orderBy: { scheduledAt: "asc" },
      include: { lead: true, client: true },
    }),
    prisma.client.findMany({
      where: { status: { not: "CHURNED" } },
      include: { checklist: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_ROWS,
    }),
    // Counted rather than fetched: the card only needs to know how much it is
    // not showing so the "View all" can say so.
    prisma.activityLog.count(),
  ]);

  // ─── Headline numbers ────────────────────────────────────────────────────

  const pipelineValue = openLeads.reduce((s, l) => s + (l.estValue ?? 0), 0);
  const mrr = activeClients.reduce((s, c) => s + (c.monthlyFee ?? 0), 0);
  const followUps7d = openLeads.filter(
    (l) => l.nextFollowUp !== null && l.nextFollowUp <= in7Days,
  );
  const dueToday = followUps7d.filter(
    (l) => l.nextFollowUp !== null && l.nextFollowUp <= dayEnd,
  ).length;

  // Month-on-month is only claimed where the data actually supports it: we
  // know when each client went active, so "added this month" is real. There is
  // no stored history of what MRR was in June, so no percentage is shown.
  const newThisMonth = activeClients.filter(
    (c) => c.activeSince !== null && c.activeSince >= monthStart,
  );
  const mrrAdded = newThisMonth.reduce((s, c) => s + (c.monthlyFee ?? 0), 0);

  const kpis: {
    label: string;
    value: string;
    icon: string;
    delta: string;
    tone: "up" | "alert" | "flat";
  }[] = [
    {
      label: "Active clients",
      value: String(activeClients.length),
      icon: "clients",
      delta:
        newThisMonth.length > 0
          ? `${newThisMonth.length} added this month`
          : "No change this month",
      tone: newThisMonth.length > 0 ? "up" : "flat",
    },
    {
      label: "MRR (active)",
      value: fmtMoney(mrr),
      icon: "dollar",
      delta:
        mrrAdded > 0
          ? `${fmtMoney(mrrAdded)} added this month`
          : "Recurring monthly fees",
      tone: mrrAdded > 0 ? "up" : "flat",
    },
    {
      label: "Pipeline value",
      value: fmtMoney(pipelineValue),
      icon: "trend",
      delta: `${openLeads.length} open lead${openLeads.length === 1 ? "" : "s"}`,
      tone: "flat",
    },
    {
      label: "Follow-ups due (7d)",
      value: String(followUps7d.length),
      icon: "clock",
      delta: dueToday > 0 ? `${dueToday} due today` : "None due today",
      tone: dueToday > 0 ? "alert" : "flat",
    },
  ];

  // ─── Today's focus ───────────────────────────────────────────────────────

  const focus = buildFocus({ now, calls: focusCalls, leads: openLeads, clients: focusClients });
  const { visible, hidden } = splitFocus(focus);
  const summary = summariseFocus(focus);

  // ─── Client health ───────────────────────────────────────────────────────

  // Newest clients first: at two rows the card is a "who has just come on
  // board" glance, and the clients page is where the whole book is read. A
  // client with no activeSince recorded sorts last rather than to the top.
  const healthRows: HealthRow[] = [...activeClients]
    .sort(
      (a, b) =>
        (b.activeSince?.getTime() ?? -Infinity) -
          (a.activeSince?.getTime() ?? -Infinity) ||
        a.clinicName.localeCompare(b.clinicName),
    )
    .slice(0, HEALTH_ROWS)
    .map((client) => ({
      id: client.id,
      clinicName: client.clinicName,
      detail: ["Active", client.packageName ?? "No package set"].join(" · "),
      health: computeHealth(client, client.reports),
    }));

  // The spare slot, when there is one, goes to the lead closest to closing —
  // furthest along the open stages, then the largest of those, then by name so
  // the pick never wobbles between renders. Better a real thing coming than a
  // dashed outline of nothing.
  const teaserLead =
    healthRows.length < HEALTH_ROWS
      ? [...openLeads].sort(
          (a, b) =>
            OPEN_STAGES.indexOf(b.stage as LeadStage) -
              OPEN_STAGES.indexOf(a.stage as LeadStage) ||
            (b.estValue ?? 0) - (a.estValue ?? 0) ||
            a.clinicName.localeCompare(b.clinicName),
        )[0]
      : undefined;
  const healthTeaser: HealthTeaser | null = teaserLead
    ? {
        id: teaserLead.id,
        clinicName: teaserLead.clinicName,
        stageLabel:
          LEAD_STAGE_LABELS[teaserLead.stage as LeadStage] ?? teaserLead.stage,
      }
    : null;

  // ─── Pipeline snapshot ───────────────────────────────────────────────────

  const slices = OPEN_STAGES.map((stage) => ({
    stage,
    label: LEAD_STAGE_SHORT_LABELS[stage],
    value: openLeads
      .filter((l) => l.stage === stage)
      .reduce((s, l) => s + (l.estValue ?? 0), 0),
  }));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Greeting serverHour={now.getHours()} />
          <p className="mt-1.5 text-sm text-muted">Agency at a glance</p>
        </div>
        <div className="flex items-center gap-3">
          <BusinessHoursChip />
          <Link href="/clients/new" className="btn-primary">
            <Icon name="plus" className="h-4 w-4" />
            New client
          </Link>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="card p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs font-medium tracking-[0.02em] text-muted">
                {kpi.label}
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent/10 text-accent">
                <Icon name={kpi.icon} />
              </div>
            </div>
            <div className="num mt-2 text-[28px] font-semibold leading-none tracking-tight">
              {kpi.value}
            </div>
            <div
              className={`mt-2.5 flex items-center gap-1 text-xs ${
                kpi.tone === "up"
                  ? "text-ok"
                  : kpi.tone === "alert"
                    ? "text-bad"
                    : "text-muted"
              }`}
            >
              {kpi.tone !== "flat" && (
                <Icon name="arrowUp" className="h-3.5 w-3.5" />
              )}
              {kpi.delta}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Now</h2>
            <span
              className={`inline-flex items-center gap-2 text-xs font-medium ${
                summary.overdue > 0 ? "text-bad" : "text-ok"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  summary.overdue > 0 ? "bg-bad" : "bg-ok"
                }`}
                aria-hidden
              />
              {summary.overdue > 0
                ? `${summary.overdue} overdue`
                : "Nothing overdue"}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-4 rounded-xl bg-accent/[0.06] p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent/10 text-accent">
              <Icon name="bell" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {summary.headline}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {summary.detail}
              </span>
            </span>
            {summary.cta && (
              <Link
                href={summary.cta.href}
                className="btn h-[34px] shrink-0 px-3.5 text-xs"
              >
                {summary.cta.label}
                <Icon name="chevronRight" className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>

          <h3 className="mb-1 mt-6 text-sm font-semibold">Today&rsquo;s focus</h3>
          <TodaysFocus visible={visible} hidden={hidden} />
        </section>

        <section className="card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-xl font-semibold">
              <Icon name="clock" className="h-[18px] w-[18px] text-accent" />
              US business hours
            </h2>
            <span className="text-xs text-muted">9–5 local, Mon–Fri</span>
          </div>
          <BusinessHoursPanel />
        </section>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-3">
        <section className="card p-6">
          {/* No header link here, unlike the two cards beside it: the feed
              carries its own "View all (N)" under the rows, where the count
              can say how much is behind it. */}
          <h2 className="mb-1 text-xl font-semibold">Recent activity</h2>
          <ActivityFeed
            entries={activity.map((a) => ({
              id: a.id,
              kind: a.kind,
              summary: a.summary,
              createdAt: a.createdAt,
              href: a.clientId
                ? `/clients/${a.clientId}`
                : a.leadId
                  ? `/pipeline/${a.leadId}`
                  : null,
            }))}
            now={now}
            total={activityTotal}
          />
        </section>

        <section className="card p-6">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Client health</h2>
            <Link href="/clients" className="text-xs font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          <ClientHealthList rows={healthRows} teaser={healthTeaser} />
        </section>

        <section className="card p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Pipeline snapshot</h2>
            <Link href="/pipeline" className="text-xs font-medium text-accent hover:underline">
              View pipeline
            </Link>
          </div>
          <PipelineDonut slices={slices} total={pipelineValue} />
        </section>
      </div>
    </div>
  );
}
