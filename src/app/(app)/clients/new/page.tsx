import Link from "next/link";
import { createClient } from "@/lib/actions/clients";
import { CLIENT_STATUSES, CLIENT_STATUS_LABELS } from "@/lib/constants";

export default function NewClientPage() {
  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link href="/clients" className="text-sm text-accent hover:underline">
          ← Clients
        </Link>
        <h1 className="mt-2 text-[32px] font-bold tracking-[-0.02em]">New client</h1>
        <p className="mt-1.5 text-sm text-muted">
          Seeds the default delivery checklist automatically.
        </p>
      </div>
      <form action={createClient} className="card space-y-5 p-6">
        <div>
          <label className="field-label" htmlFor="clinicName">
            Clinic name
          </label>
          <input id="clinicName" name="clinicName" required className="field" />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <div>
            <label className="field-label" htmlFor="contactName">
              Contact name
            </label>
            <input id="contactName" name="contactName" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue="ONBOARDING" className="field">
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CLIENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="phone">
              Phone
            </label>
            <input id="phone" name="phone" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="packageName">
              Package / plan
            </label>
            <input id="packageName" name="packageName" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="monthlyFee">
              Monthly fee ($)
            </label>
            <input
              id="monthlyFee"
              name="monthlyFee"
              type="number"
              min="0"
              step="any"
              className="field"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="contractStart">
              Contract start
            </label>
            <input
              id="contractStart"
              name="contractStart"
              type="date"
              className="field"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-line/60 pt-5">
          <Link href="/clients" className="btn">
            Cancel
          </Link>
          <button type="submit" className="btn-primary">
            Create client
          </button>
        </div>
      </form>
    </div>
  );
}
