// The invoice log — a running list of what has been billed and what has come
// in. Shown inside the onboarding wizard's step 3 and on the client record,
// since invoices keep arriving long after onboarding is done.

import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  invoiceTotals,
} from "@/lib/onboarding";
import { addInvoice, deleteInvoice, setInvoiceStatus } from "@/lib/actions/onboarding";
import { fmtDate, fmtMoney, toDateInput } from "@/lib/format";
import ConfirmForm from "@/components/ConfirmForm";

export interface InvoiceRow {
  id: string;
  issuedOn: Date;
  amount: number;
  status: string;
  memo: string | null;
}

export default function InvoiceLog({
  clientId,
  invoices,
  defaultAmount,
}: {
  clientId: string;
  invoices: InvoiceRow[];
  defaultAmount: number | null;
}) {
  const add = addInvoice.bind(null, clientId);
  const totals = invoiceTotals(invoices);

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[10px] border border-line">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Amount</th>
              <th className="th">Status</th>
              <th className="th">Memo</th>
              <th className="th w-10">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="hover:bg-wash/60">
                <td className="td num text-xs">{fmtDate(invoice.issuedOn)}</td>
                <td className="td num">{fmtMoney(invoice.amount)}</td>
                <td className="td">
                  <div className="inline-flex overflow-hidden rounded-full border border-line">
                    {INVOICE_STATUSES.map((s) => {
                      const setStatus = setInvoiceStatus.bind(null, invoice.id, s);
                      const active = invoice.status === s;
                      return (
                        <form action={setStatus} key={s}>
                          <button
                            type="submit"
                            className={`h-7 px-3 text-xs font-medium ${
                              active
                                ? s === "PAID"
                                  ? "bg-ok-soft text-ok"
                                  : "bg-warn-soft text-warn"
                                : "text-muted/70 hover:bg-wash/70 hover:text-ink"
                            }`}
                          >
                            {INVOICE_STATUS_LABELS[s]}
                          </button>
                        </form>
                      );
                    })}
                  </div>
                </td>
                <td className="td text-xs text-muted">{invoice.memo ?? "—"}</td>
                <td className="td text-right">
                  <ConfirmForm
                    action={deleteInvoice.bind(null, invoice.id)}
                    message={`Delete the ${fmtMoney(invoice.amount)} invoice dated ${fmtDate(invoice.issuedOn)}?`}
                    className="px-1 text-muted hover:text-bad"
                  >
                    ×
                  </ConfirmForm>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td className="td text-sm text-muted" colSpan={5}>
                  No invoices logged yet. Add the first one below — more can be
                  added over time as they go out.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-4 border-t border-line bg-wash/50 px-4 py-3">
          <span className="text-xs font-medium tracking-[0.02em] text-muted">
            Total collected
          </span>
          <span className="flex items-baseline gap-3">
            {totals.outstanding > 0 && (
              <span className="num text-xs text-warn">
                {fmtMoney(totals.outstanding)} outstanding
              </span>
            )}
            <span className="num text-lg font-semibold tracking-tight text-ok">
              {fmtMoney(totals.collected)}
            </span>
          </span>
        </div>
      </div>

      {/* Keyed on the row count so the form remounts — and so clears itself —
          once an entry lands, rather than keeping the last one's values. */}
      <form
        key={invoices.length}
        action={add}
        className="grid grid-cols-12 items-end gap-3"
      >
        <div className="col-span-3">
          <label className="field-label" htmlFor="issuedOn">
            Date
          </label>
          <input
            id="issuedOn"
            name="issuedOn"
            type="date"
            defaultValue={toDateInput(new Date())}
            required
            className="field num"
          />
        </div>
        <div className="col-span-2">
          <label className="field-label" htmlFor="amount">
            Amount ($)
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            min="0"
            step="any"
            defaultValue={defaultAmount ?? ""}
            required
            className="field num"
          />
        </div>
        <div className="col-span-2">
          <label className="field-label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue="UNPAID" className="field">
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INVOICE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="field-label" htmlFor="memo">
            Memo
          </label>
          <input id="memo" name="memo" placeholder="Optional" className="field" />
        </div>
        <div className="col-span-3">
          <button type="submit" className="btn w-full justify-center">
            Log invoice
          </button>
        </div>
      </form>
    </div>
  );
}
