import Link from "next/link";
import { createLead } from "@/lib/actions/leads";

export default function NewLeadPage() {
  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link href="/pipeline" className="text-sm text-accent hover:underline">
          ← Pipeline
        </Link>
        <h1 className="mt-2 text-xl font-bold tracking-tight">New lead</h1>
      </div>
      <form action={createLead} className="card space-y-4 p-5">
        <div>
          <label className="field-label" htmlFor="clinicName">
            Clinic name
          </label>
          <input id="clinicName" name="clinicName" required className="field" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="contactName">
              Contact name
            </label>
            <input id="contactName" name="contactName" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="leadSource">
              Lead source
            </label>
            <input
              id="leadSource"
              name="leadSource"
              placeholder="Referral, cold email, Meta ad…"
              className="field"
            />
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
            <label className="field-label" htmlFor="estValue">
              Est. deal value ($/mo)
            </label>
            <input
              id="estValue"
              name="estValue"
              type="number"
              min="0"
              step="any"
              className="field font-mono"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="nextFollowUp">
              Next follow-up
            </label>
            <input
              id="nextFollowUp"
              name="nextFollowUp"
              type="date"
              className="field font-mono"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Link href="/pipeline" className="btn">
            Cancel
          </Link>
          <button type="submit" className="btn-primary">
            Create lead
          </button>
        </div>
      </form>
    </div>
  );
}
