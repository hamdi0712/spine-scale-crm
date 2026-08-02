import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { deleteWeeklyReport, upsertWeeklyReport } from "@/lib/actions/reports";
import { computeMetrics } from "@/lib/kpi";
import {
  fmtDate,
  fmtMoney,
  fmtMoneyCents,
  fmtPct,
  toDateInput,
} from "@/lib/format";
import { ClientStatusBadge, FlaggedValue } from "@/components/Badge";
import ConfirmForm from "@/components/ConfirmForm";
import TrendCharts, { TrendPoint } from "@/components/TrendCharts";

export const dynamic = "force-dynamic";

// Most recent Monday (UTC) as a sensible default for the week-start input.
function defaultWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff)
  );
  return toDateInput(monday);
}

export default async function ClientReportingPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: { reports: { orderBy: { weekStart: "desc" } } },
  });
  if (!client) notFound();

  const upsert = upsertWeeklyReport.bind(null, client.id);

  const trend: TrendPoint[] = [...client.reports]
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .map((r) => {
      const m = computeMetrics(r);
      return {
        week: r.weekStart.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        leads: r.leads,
        cpl: m.cpl != null ? Number(m.cpl.toFixed(2)) : null,
        showRate: m.showRate != null ? Number((m.showRate * 100).toFixed(1)) : null,
      };
    });

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <Link href="/reporting" className="text-sm text-accent hover:underline">
            ← Reporting
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="display text-[32px] font-semibold">
              {client.clinicName}
            </h1>
            <ClientStatusBadge status={client.status} />
          </div>
        </div>
        <Link href={`/clients/${client.id}`} className="btn">
          Client record →
        </Link>
      </div>

      {trend.length > 0 && (
        <section className="mt-8">
          <h2 className="display mb-4 text-xl font-semibold">Trends</h2>
          <TrendCharts data={trend} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="display mb-4 text-xl font-semibold">Log a week</h2>
        <form action={upsert} className="card p-6">
          <div className="grid grid-cols-2 gap-5 md:grid-cols-6">
            <div>
              <label className="field-label" htmlFor="weekStart">
                Week start
              </label>
              <input
                id="weekStart"
                name="weekStart"
                type="date"
                required
                defaultValue={defaultWeekStart()}
                className="field num"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="spend">
                Ad spend ($)
              </label>
              <input
                id="spend"
                name="spend"
                type="number"
                min="0"
                step="any"
                required
                className="field num"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="leads">
                Leads
              </label>
              <input
                id="leads"
                name="leads"
                type="number"
                min="0"
                step="1"
                required
                className="field num"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="booked">
                Booked
              </label>
              <input
                id="booked"
                name="booked"
                type="number"
                min="0"
                step="1"
                required
                className="field num"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="shows">
                Shows
              </label>
              <input
                id="shows"
                name="shows"
                type="number"
                min="0"
                step="1"
                required
                className="field num"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="revenue">
                Revenue ($)
              </label>
              <input
                id="revenue"
                name="revenue"
                type="number"
                min="0"
                step="any"
                className="field num"
              />
            </div>
          </div>
          <div className="mt-5 flex items-end gap-5">
            <div className="flex-1">
              <label className="field-label" htmlFor="notes">
                Notes
              </label>
              <input id="notes" name="notes" className="field" />
            </div>
            <button type="submit" className="btn-primary shrink-0">
              Save week
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            One entry per week — saving an existing week-start date overwrites
            that week.
          </p>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="display mb-4 text-xl font-semibold">Weekly history</h2>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Week of</th>
                <th className="th">Spend</th>
                <th className="th">Leads</th>
                <th className="th">Booked</th>
                <th className="th">Shows</th>
                <th className="th">Revenue</th>
                <th className="th">CPL</th>
                <th className="th">Lead→Booked</th>
                <th className="th">Show rate</th>
                <th className="th">Notes</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {client.reports.map((r) => {
                const m = computeMetrics(r);
                const remove = deleteWeeklyReport.bind(null, r.id);
                return (
                  <tr key={r.id} className="hover:bg-wash/70">
                    <td className="td num text-xs">
                      {fmtDate(r.weekStart)}
                    </td>
                    <td className="td num">
                      {fmtMoney(r.spend)}
                    </td>
                    <td className="td num">{r.leads}</td>
                    <td className="td num">{r.booked}</td>
                    <td className="td num">{r.shows}</td>
                    <td className="td num">
                      {fmtMoney(r.revenue)}
                    </td>
                    <td className="td">
                      <FlaggedValue value={fmtMoneyCents(m.cpl)} flag={m.cplFlag} />
                    </td>
                    <td className="td">
                      <FlaggedValue
                        value={fmtPct(m.leadToBooked)}
                        flag={m.leadToBookedFlag}
                      />
                    </td>
                    <td className="td">
                      <FlaggedValue
                        value={fmtPct(m.showRate)}
                        flag={m.showRateFlag}
                      />
                    </td>
                    <td className="td max-w-[16rem] truncate text-xs text-muted">
                      {r.notes ?? ""}
                    </td>
                    <td className="td">
                      <ConfirmForm
                        action={remove}
                        message={`Delete the week of ${fmtDate(r.weekStart)}?`}
                        className="px-1 text-muted hover:text-bad"
                      >
                        ×
                      </ConfirmForm>
                    </td>
                  </tr>
                );
              })}
              {client.reports.length === 0 && (
                <tr>
                  <td className="td text-muted" colSpan={11}>
                    No weeks logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Targets — CPL: $10–35 · Lead→Booked: 20–40% · Show rate: 50–70%.
          Yellow = near band, red = outside.
        </p>
      </section>
    </div>
  );
}
