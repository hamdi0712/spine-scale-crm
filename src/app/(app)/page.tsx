import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { OPEN_STAGES } from "@/lib/constants";
import { computeMetrics } from "@/lib/kpi";
import { fmtDate, fmtMoney } from "@/lib/format";
import { StageBadge } from "@/components/Badge";
import Icon from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [activeClients, openLeads, followUps, clients] = await Promise.all([
    prisma.client.findMany({ where: { status: "ACTIVE" } }),
    prisma.lead.findMany({
      where: { archived: false, stage: { in: [...OPEN_STAGES] } },
    }),
    prisma.lead.findMany({
      where: {
        archived: false,
        stage: { in: [...OPEN_STAGES] },
        nextFollowUp: { lte: in7Days },
      },
      orderBy: { nextFollowUp: "asc" },
    }),
    prisma.client.findMany({
      where: { status: { not: "CHURNED" } },
      include: { reports: { orderBy: { weekStart: "desc" }, take: 1 } },
    }),
  ]);

  const pipelineValue = openLeads.reduce((s, l) => s + (l.estValue ?? 0), 0);
  const mrr = activeClients.reduce((s, c) => s + (c.monthlyFee ?? 0), 0);

  const redFlagged = clients
    .map((c) => {
      const latest = c.reports[0];
      if (!latest) return null;
      const m = computeMetrics(latest);
      if (!m.hasRed) return null;
      const reds: string[] = [];
      if (m.cplFlag === "red") reds.push("CPL");
      if (m.leadToBookedFlag === "red") reds.push("Lead→Booked");
      if (m.showRateFlag === "red") reds.push("Show rate");
      return { client: c, weekStart: latest.weekStart, reds };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div>
      <h1 className="text-[32px] font-bold tracking-[-0.02em]">Dashboard</h1>
      <p className="mt-1.5 text-sm text-muted">Agency at a glance</p>

      <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
        {[
          {
            label: "Active clients",
            value: String(activeClients.length),
            detail: "Currently on the books",
            icon: "clients",
          },
          {
            label: "MRR (active)",
            value: fmtMoney(mrr),
            detail: "Recurring monthly fees",
            icon: "dollar",
          },
          {
            label: "Pipeline value",
            value: fmtMoney(pipelineValue),
            detail: `${openLeads.length} open lead${openLeads.length === 1 ? "" : "s"}`,
            icon: "trend",
          },
          {
            label: "Follow-ups due (7d)",
            value: String(followUps.length),
            detail: "Due in the next 7 days",
            icon: "clock",
          },
        ].map((kpi) => (
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
            <div className="mt-2.5 text-xs text-muted">{kpi.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-4 text-xl font-semibold">Follow-ups due</h2>
          <div className="card">
            {followUps.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                No follow-ups due in the next 7 days.
              </p>
            ) : (
              <table className="w-full">
                <tbody>
                  {followUps.map((lead) => {
                    const overdue =
                      lead.nextFollowUp && lead.nextFollowUp < now;
                    return (
                      <tr key={lead.id}>
                        <td className="td">
                          <Link
                            href={`/pipeline/${lead.id}`}
                            className="font-medium text-ink hover:underline"
                          >
                            {lead.clinicName}
                          </Link>
                        </td>
                        <td className="td">
                          <StageBadge stage={lead.stage} />
                        </td>
                        <td
                          className={`td num text-xs ${
                            overdue ? "text-bad" : "text-muted"
                          }`}
                        >
                          {fmtDate(lead.nextFollowUp)}
                          {overdue ? " · overdue" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-semibold">Clients needing attention</h2>
          <div className="card">
            {redFlagged.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                No red-flagged metrics in the latest reported weeks.
              </p>
            ) : (
              <table className="w-full">
                <tbody>
                  {redFlagged.map(({ client, weekStart, reds }) => (
                    <tr key={client.id}>
                      <td className="td">
                        <Link
                          href={`/reporting/${client.id}`}
                          className="font-medium text-ink hover:underline"
                        >
                          {client.clinicName}
                        </Link>
                      </td>
                      <td className="td text-bad">{reds.join(", ")}</td>
                      <td className="td num text-xs text-muted">
                        wk of {fmtDate(weekStart)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
