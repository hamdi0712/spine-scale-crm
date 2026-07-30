import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { computeMetrics } from "@/lib/kpi";
import { fmtDate, fmtMoneyCents, fmtPct } from "@/lib/format";
import { ClientStatusBadge, FlaggedValue } from "@/components/Badge";

export const dynamic = "force-dynamic";

export default async function ReportingPage() {
  const clients = await prisma.client.findMany({
    orderBy: [{ status: "asc" }, { clinicName: "asc" }],
    include: { reports: { orderBy: { weekStart: "desc" }, take: 1 } },
  });

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Reporting</h1>
      <p className="mt-0.5 text-sm text-muted">
        Latest reported week per client, against target KPIs
      </p>

      <div className="card mt-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Client</th>
              <th className="th">Status</th>
              <th className="th text-right">Last week</th>
              <th className="th text-right">Leads</th>
              <th className="th text-right">CPL</th>
              <th className="th text-right">Lead→Booked</th>
              <th className="th text-right">Show rate</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => {
              const latest = client.reports[0];
              const m = latest ? computeMetrics(latest) : null;
              return (
                <tr key={client.id} className="hover:bg-bg">
                  <td className="td">
                    <Link
                      href={`/reporting/${client.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {client.clinicName}
                    </Link>
                  </td>
                  <td className="td">
                    <ClientStatusBadge status={client.status} />
                  </td>
                  <td className="td text-right font-mono text-xs">
                    {latest ? fmtDate(latest.weekStart) : "—"}
                  </td>
                  <td className="td text-right font-mono">
                    {latest ? latest.leads : "—"}
                  </td>
                  <td className="td text-right">
                    {m ? (
                      <FlaggedValue value={fmtMoneyCents(m.cpl)} flag={m.cplFlag} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="td text-right">
                    {m ? (
                      <FlaggedValue
                        value={fmtPct(m.leadToBooked)}
                        flag={m.leadToBookedFlag}
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="td text-right">
                    {m ? (
                      <FlaggedValue
                        value={fmtPct(m.showRate)}
                        flag={m.showRateFlag}
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {clients.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={7}>
                  No clients yet — reporting starts once a client is on the
                  books.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
