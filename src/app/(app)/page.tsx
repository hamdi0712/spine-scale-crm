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
import KpiCard, { Kpi, KpiTone } from "@/components/KpiCard";
import PipelineDonut from "@/components/PipelineDonut";
import TodaysFocus from "@/components/TodaysFocus";
import UsNightMap from "@/components/UsNightMap";

export const dynamic = "force-dynamic";

// How many rows the two feed cards carry before they defer to their full page.
// Both are deliberately short: the cards are a glance at the newest thing that
// happened and the newest clients on the books, not a place to read either
// list from.
const ACTIVITY_ROWS = 3;
const HEALTH_ROWS = 2;

// One step of the pipeline palette per KPI card, chosen for distance rather
// than for adjacency: steps 0, 4, 1 and 2 give blue, teal, blue-indigo and
// indigo, which is the widest spread four steps of that ramp can make. The row
// is therefore drawn in the same colours as the donut at the bottom of the page
// while no two cards share a hue. Money takes the teal — the step that reads
// least like the rest — because it is the number people look for first.
// Positional rather than keyed off the label, because the labels are composed
// below and the row's order is what the reader actually sees.
const KPI_TONES: KpiTone[] = [0, 4, 1, 2];

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

  const kpis: Kpi[] = [
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
        {kpis.map((kpi, i) => (
          <KpiCard key={kpi.label} kpi={kpi} tone={KPI_TONES[i]} />
        ))}
      </div>

      {/* The two cards match heights while Now is collapsed, and the row is as
          tall as whichever is naturally taller — either can be: business hours
          is always four rows, Now varies with its banner. So the default
          stretch applies to both and neither one leads.

          Expanded, Now is showing a list it was never sized for and business
          hours should not be dragged along with it, so items-start hands both
          cards back their natural heights. Now keeps self-stretch through
          that, which is what still lifts a short expanded list — one hidden
          row, say — up to the height of business hours beside it.

          The flag comes off the data attribute TodaysFocus sets from the state
          behind its own "View all" toggle. */}
      <div className="mt-6 grid items-stretch gap-6 has-[[data-focus-expanded]]:items-start lg:grid-cols-2">
        <section className="card self-stretch p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="display text-xl font-semibold">Now</h2>
            {/* Nothing wrong is stated quietly: a muted pill whose only colour
                is the dot. Something overdue keeps the red — an understated
                alert is not an alert — but takes the same pill, so the two
                states are one object in two tones rather than two objects. */}
            <span
              className={`inline-flex h-[24px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ${
                summary.overdue > 0
                  ? "bg-bad-soft text-bad"
                  : "bg-wash text-muted"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  summary.overdue > 0 ? "bg-bad" : "bg-ok"
                }`}
                aria-hidden
              />
              {summary.overdue > 0
                ? `${summary.overdue} overdue`
                : "Nothing overdue"}
            </span>
          </div>

          {/* The banner is the one lit surface inside a white card: a shallow
              blue gradient with a pale edge, so the headline sits on glass
              rather than on a flat tint. */}
          <div
            className="mt-4 flex items-center gap-4 rounded-[18px] border border-[#DCE8FB] p-4"
            style={{
              backgroundImage: "linear-gradient(135deg, #F1F5FF, #E7F2FF)",
            }}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-white/70 text-accent shadow-[0_1px_2px_rgba(28,27,39,0.06)]">
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

        {/* The one dark surface on the dashboard, and it earns it by being
            about somewhere else: every other card counts this agency's own
            records, and this one is four clocks in other people's daylight.
            Text goes to white and its supporting tiers to white at reduced
            opacity — .text-muted is a grey mixed for paper. */}
        <section className="hero-navy p-6">
          {/* Layer 1 of 3. The map is the bottom of the stack and the only
              thing in the section that is absolutely positioned — it spans the
              whole field, is cut by the container's radius, and fades on every
              edge so it is embedded in the glass rather than pasted onto it. */}
          <UsNightMap />

          {/* Layers 2 and 3 — header, then tiles — share one relative wrapper,
              which is what lifts them clear of the map without either needing a
              z-index of its own.

              It is a column with the tiles pushed to the bottom, so whatever
              height this panel is handed by the card beside it becomes open
              space between the header and the tiles — and that space is where
              the country shows. Without it the tiles sit straight under the
              header and cover the one part of the picture worth seeing. */}
          <div className="relative flex h-full min-h-[300px] flex-col">
            <div className="flex items-center justify-between gap-3">
              <h2 className="display flex items-center gap-3 text-xl font-semibold text-white">
                <span
                  className="glass-mark-dark h-9 w-9"
                  style={
                    {
                      "--mark-tint": "rgba(126, 176, 245, 0.5)",
                      "--mark-tint-soft": "rgba(126, 176, 245, 0.12)",
                    } as React.CSSProperties
                  }
                >
                  <Icon
                    name="clock"
                    className="h-[18px] w-[18px] text-[#CFE4FF]"
                  />
                </span>
                US business hours
              </h2>
              <span className="text-xs text-white/60">Mon–Fri · 9–5 local</span>
            </div>
            <div className="mt-auto pt-8">
              <BusinessHoursPanel />
            </div>
          </div>
        </section>
      </div>

      {/* These three always stand level, in every state — an empty feed, a
          single teaser row and the donut all end up the same height as the
          tallest of them. None of them expands in place, so there is nothing
          to make it conditional on: all three "View all" links leave for a
          page of their own.

          The stretch reaches the bordered card directly because each section
          carries .card itself and is the grid item — no wrapper in between to
          stretch instead and leave the visible card floating short inside it. */}
      <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="display text-xl font-semibold">Recent activity</h2>
            <Link href="/activity" className="text-xs font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
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
            illustrateEmpty
          />
        </section>

        <section className="card p-6">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="display text-xl font-semibold">Client health</h2>
            <Link href="/clients" className="text-xs font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          <ClientHealthList rows={healthRows} teaser={healthTeaser} />
        </section>

        <section className="card p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="display text-xl font-semibold">Pipeline snapshot</h2>
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
