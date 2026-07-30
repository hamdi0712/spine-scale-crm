import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { OPEN_STAGES } from "@/lib/constants";
import { computeMetrics } from "@/lib/kpi";
import { fmtDate, fmtMoney } from "@/lib/format";
import { StageBadge } from "@/components/Badge";

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
      <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-0.5 text-sm text-muted">Agency at a glance</p>

      <div className="mt-6 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        <div className="bg-surface px-4 py-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
            Active clients
          </div>
          <div className="mt-1 font-mono text-2xl font-medium">
            {activeClients.length}
          </div>
        </div>
        <div className="bg-surface px-4 py-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
            MRR (active)
          </div>
          <div className="mt-1 font-mono text-2xl font-medium">{fmtMoney(mrr)}</div>
        </div>
        <div className="bg-surface px-4 py-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
            Pipeline value
          </div>
          <div className="mt-1 font-mono text-2xl font-medium">
            {fmtMoney(pipelineValue)}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {openLeads.length} open lead{openLeads.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="bg-surface px-4 py-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
            Follow-ups due (7d)
          </div>
          <div className="mt-1 font-mono text-2xl font-medium">
            {followUps.length}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Follow-ups due</h2>
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
                            className="font-medium text-accent hover:underline"
                          >
                            {lead.clinicName}
                          </Link>
                        </td>
                        <td className="td">
                          <StageBadge stage={lead.stage} />
                        </td>
                        <td
                          className={`td text-right font-mono text-xs ${
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
          <h2 className="mb-2 text-sm font-semibold">Clients needing attention</h2>
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
                          className="font-medium text-accent hover:underline"
                        >
                          {client.clinicName}
                        </Link>
                      </td>
                      <td className="td text-bad">{reds.join(", ")}</td>
                      <td className="td text-right font-mono text-xs text-muted">
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
