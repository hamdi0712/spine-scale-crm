// Performance tracking for one creative — numbers typed in by hand from the
// ad account. There is no ad-platform integration anywhere in the Ad Hub, so
// this is the whole of it: a dated log, and the totals underneath.
//
// Same shape as the invoice log on a client record: the table, then a row of
// fields that clears itself once an entry lands.

import { addPerformanceLog, deletePerformanceLog } from "@/lib/actions/adhub";
import { fmtDate, fmtMoney, fmtMoneyCents, toDateInput } from "@/lib/format";
import ConfirmForm from "@/components/ConfirmForm";

export interface PerformanceRow {
  id: string;
  loggedOn: Date;
  spend: number;
  impressions: number | null;
  ctr: number | null;
  cpl: number | null;
  conversions: number;
  notes: string | null;
}

function fmtPctValue(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(2)}%`;
}

function fmtCount(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}

export default function PerformanceLog({
  creativeId,
  logs,
}: {
  creativeId: string;
  logs: PerformanceRow[];
}) {
  const add = addPerformanceLog.bind(null, creativeId);
  const spend = logs.reduce((s, l) => s + l.spend, 0);
  const conversions = logs.reduce((s, l) => s + l.conversions, 0);
  // Blended cost per conversion across everything logged — the one number the
  // per-entry CPLs cannot give you.
  const blended = conversions > 0 ? spend / conversions : null;

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[10px] border border-line">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Date</th>
                <th className="th">Spend</th>
                <th className="th">Impressions</th>
                <th className="th">CTR</th>
                <th className="th">CPL</th>
                <th className="th">Conversions</th>
                <th className="th">Notes</th>
                <th className="th w-10">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-wash/60">
                  <td className="td num text-xs">{fmtDate(log.loggedOn)}</td>
                  <td className="td num">{fmtMoney(log.spend)}</td>
                  <td className="td num text-xs">
                    {fmtCount(log.impressions)}
                  </td>
                  <td className="td num text-xs">{fmtPctValue(log.ctr)}</td>
                  <td className="td num text-xs">{fmtMoneyCents(log.cpl)}</td>
                  <td className="td num">{log.conversions}</td>
                  <td className="td text-xs text-muted">{log.notes ?? "—"}</td>
                  <td className="td text-right">
                    <ConfirmForm
                      action={deletePerformanceLog.bind(null, log.id)}
                      message={`Delete the entry dated ${fmtDate(log.loggedOn)}?`}
                      className="px-1 text-muted hover:text-bad"
                    >
                      ×
                    </ConfirmForm>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td className="td text-sm text-muted" colSpan={8}>
                    Nothing logged yet. Add a row below each time you pull
                    numbers from the ad account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-line bg-wash/50 px-4 py-3">
          <span className="text-xs font-medium tracking-[0.02em] text-muted">
            Totals
          </span>
          <span className="flex items-baseline gap-4">
            {blended != null && (
              <span className="num text-xs text-muted">
                {fmtMoneyCents(blended)} per conversion
              </span>
            )}
            <span className="num text-xs text-muted">
              {conversions} conversion{conversions === 1 ? "" : "s"}
            </span>
            <span className="num text-lg font-semibold tracking-tight">
              {fmtMoney(spend)}
            </span>
          </span>
        </div>
      </div>

      {/* Keyed on the row count so the form remounts — and so clears itself —
          once an entry lands, rather than keeping the last one's values. */}
      <form
        key={logs.length}
        action={add}
        className="grid grid-cols-12 items-end gap-3"
      >
        <div className="col-span-2">
          <label className="field-label" htmlFor="perfLoggedOn">
            Date
          </label>
          <input
            id="perfLoggedOn"
            name="loggedOn"
            type="date"
            defaultValue={toDateInput(new Date())}
            required
            className="field num"
          />
        </div>
        <div className="col-span-1">
          <label className="field-label" htmlFor="perfSpend">
            Spend
          </label>
          <input
            id="perfSpend"
            name="spend"
            type="number"
            min="0"
            step="any"
            required
            className="field num"
          />
        </div>
        <div className="col-span-2">
          <label className="field-label" htmlFor="perfImpressions">
            Impressions
          </label>
          <input
            id="perfImpressions"
            name="impressions"
            type="number"
            min="0"
            step="1"
            placeholder="Optional"
            className="field num"
          />
        </div>
        <div className="col-span-1">
          <label className="field-label" htmlFor="perfCtr">
            CTR %
          </label>
          <input
            id="perfCtr"
            name="ctr"
            type="number"
            min="0"
            step="any"
            className="field num"
          />
        </div>
        <div className="col-span-1">
          <label className="field-label" htmlFor="perfCpl">
            CPL
          </label>
          <input
            id="perfCpl"
            name="cpl"
            type="number"
            min="0"
            step="any"
            className="field num"
          />
        </div>
        <div className="col-span-1">
          <label className="field-label" htmlFor="perfConversions">
            Conv.
          </label>
          <input
            id="perfConversions"
            name="conversions"
            type="number"
            min="0"
            step="1"
            defaultValue="0"
            className="field num"
          />
        </div>
        <div className="col-span-2">
          <label className="field-label" htmlFor="perfNotes">
            Notes
          </label>
          <input
            id="perfNotes"
            name="notes"
            placeholder="Optional"
            className="field"
          />
        </div>
        <div className="col-span-2">
          <button type="submit" className="btn w-full justify-center">
            Log entry
          </button>
        </div>
      </form>
    </div>
  );
}
