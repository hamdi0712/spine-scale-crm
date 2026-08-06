import Link from "next/link";
import { createLead } from "@/lib/actions/leads";
import { US_TIME_ZONES } from "@/lib/timezones";

export default function NewLeadPage() {
  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link href="/pipeline" className="text-sm text-accent hover:underline">
          ← Pipeline
        </Link>
        <h1 className="display mt-2 text-[32px] font-semibold">New lead</h1>
      </div>
      <form action={createLead} className="card space-y-5 p-6">
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
            <label className="field-label" htmlFor="linkedinUrl">
              LinkedIn URL
            </label>
            <input
              id="linkedinUrl"
              name="linkedinUrl"
              placeholder="Contact's profile"
              className="field"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="companyLinkedinUrl">
              Company LinkedIn URL
            </label>
            <input
              id="companyLinkedinUrl"
              name="companyLinkedinUrl"
              placeholder="Clinic's company page"
              className="field"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="timeZone">
              Time zone
            </label>
            <select
              id="timeZone"
              name="timeZone"
              defaultValue=""
              className="field"
            >
              <option value="">Not set</option>
              {US_TIME_ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="staffCountRaw">
              Staff count
            </label>
            <input
              id="staffCountRaw"
              name="staffCountRaw"
              type="number"
              min="0"
              step="1"
              className="field num"
            />
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
              className="field num"
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
              className="field num"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-line/60 pt-5">
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
