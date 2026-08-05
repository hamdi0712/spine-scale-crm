import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  addLeadNote,
  convertLeadToClient,
  deleteLead,
  saveIcpScorecard,
  updateLead,
} from "@/lib/actions/leads";
import { addLeadCall } from "@/lib/actions/calls";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import {
  ICP_SCORING_RULE,
  leadTier,
  suggestedStaffSizeScore,
} from "@/lib/icp";
import { fmtDateTime, toDateInput } from "@/lib/format";
import { IcpTierBadge, StageBadge } from "@/components/Badge";
import CallLog from "@/components/CallLog";
import ConfirmForm from "@/components/ConfirmForm";
import IcpScorecard from "@/components/IcpScorecard";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: {
      notes: { orderBy: { createdAt: "desc" } },
      calls: { orderBy: { scheduledAt: "asc" } },
      client: true,
    },
  });
  if (!lead) notFound();

  const update = updateLead.bind(null, lead.id);
  const addNote = addLeadNote.bind(null, lead.id);
  const addCall = addLeadCall.bind(null, lead.id);
  const convert = convertLeadToClient.bind(null, lead.id);
  const remove = deleteLead.bind(null, lead.id);
  const saveScorecard = saveIcpScorecard.bind(null, lead.id);
  const staffSizeSuggestion = suggestedStaffSizeScore(lead.staffCountRaw);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <Link href="/pipeline" className="text-sm text-accent hover:underline">
            ← Pipeline
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="display text-[32px] font-semibold">{lead.clinicName}</h1>
            <StageBadge stage={lead.stage} />
            <IcpTierBadge tier={leadTier(lead)} />
            {lead.archived && (
              <span className="inline-flex h-[22px] items-center rounded-full bg-line/70 px-2.5 text-xs font-medium text-muted">
                Archived
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.client ? (
            <Link href={`/clients/${lead.client.id}`} className="btn">
              View client record →
            </Link>
          ) : lead.stage === "WON" ? (
            <form action={convert}>
              <button type="submit" className="btn-primary">
                Convert to Client
              </button>
            </form>
          ) : null}
          <ConfirmForm
            action={remove}
            message={`Delete lead "${lead.clinicName}" and its activity log?`}
            className="btn-danger"
          >
            Delete
          </ConfirmForm>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="display mb-4 text-xl font-semibold">Details</h2>
          <form action={update} className="card space-y-5 p-6">
            <div>
              <label className="field-label" htmlFor="clinicName">
                Clinic name
              </label>
              <input
                id="clinicName"
                name="clinicName"
                defaultValue={lead.clinicName}
                required
                className="field"
              />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              <div>
                <label className="field-label" htmlFor="contactName">
                  Contact name
                </label>
                <input
                  id="contactName"
                  name="contactName"
                  defaultValue={lead.contactName ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="leadSource">
                  Lead source
                </label>
                <input
                  id="leadSource"
                  name="leadSource"
                  defaultValue={lead.leadSource ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="phone">
                  Phone
                </label>
                <input
                  id="phone"
                  name="phone"
                  defaultValue={lead.phone ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={lead.email ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="linkedinUrl">
                  LinkedIn URL
                </label>
                <input
                  id="linkedinUrl"
                  name="linkedinUrl"
                  defaultValue={lead.linkedinUrl ?? ""}
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
                  defaultValue={lead.companyLinkedinUrl ?? ""}
                  placeholder="Clinic's company page"
                  className="field"
                />
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
                  defaultValue={lead.staffCountRaw ?? ""}
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
                  defaultValue={lead.estValue ?? ""}
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
                  defaultValue={toDateInput(lead.nextFollowUp)}
                  className="field num"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="stage">
                  Stage
                </label>
                <select
                  id="stage"
                  name="stage"
                  defaultValue={lead.stage}
                  className="field"
                >
                  {LEAD_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* A launchpad for outreach done by hand, sitting with the contact
                details it belongs to. Opening a profile is the whole feature —
                nothing here sends, connects, or messages anyone. */}
            {(lead.linkedinUrl || lead.companyLinkedinUrl) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-5">
                {lead.linkedinUrl && (
                  <a
                    href={lead.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn h-[34px] px-3.5 text-xs"
                  >
                    View LinkedIn profile ↗
                  </a>
                )}
                {lead.companyLinkedinUrl && (
                  <a
                    href={lead.companyLinkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn h-[34px] px-3.5 text-xs"
                  >
                    View company page ↗
                  </a>
                )}
              </div>
            )}
            <div className="flex justify-end border-t border-line/60 pt-5">
              <button type="submit" className="btn-primary">
                Save changes
              </button>
            </div>
          </form>
        </section>

        <section>
          <h2 className="display mb-4 text-xl font-semibold">Activity log</h2>
          <form action={addNote} className="card flex gap-3 p-4">
            <input
              name="body"
              placeholder="Add a note — calls, emails, objections…"
              required
              className="field"
            />
            <button type="submit" className="btn shrink-0">
              Log
            </button>
          </form>
          <div className="card mt-4">
            {lead.notes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                No activity yet. Notes are append-only and timestamped.
              </p>
            ) : (
              <ul>
                {lead.notes.map((note) => (
                  <li key={note.id} className="border-b border-line/60 px-5 py-4 last:border-b-0">
                    <div className="num text-xs text-muted">
                      {fmtDateTime(note.createdAt)}
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap text-sm">
                      {note.body}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="mt-8">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-xl font-semibold">Calls</h2>
          <p className="text-sm text-muted">
            Alongside the next follow-up date, not instead of it
          </p>
        </div>
        <CallLog calls={lead.calls} addAction={addCall} />
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="display text-xl font-semibold">ICP Scorecard</h2>
          <p className="max-w-xl text-right text-sm text-muted">
            {ICP_SCORING_RULE}
          </p>
        </div>
        <IcpScorecard
          action={saveScorecard}
          // A staff count that came in with the lead (usually from a CSV
          // import) suggests category A's band. Computed here, offered by the
          // card, and stored by nothing until the card is saved.
          staffSizeSuggestion={
            staffSizeSuggestion == null || lead.staffCountRaw == null
              ? null
              : { staffCount: lead.staffCountRaw, points: staffSizeSuggestion }
          }
          values={{
            icpDqSurgicalPractice: lead.icpDqSurgicalPractice,
            icpDqSoloNoStaff: lead.icpDqSoloNoStaff,
            icpDqFranchiseLocked: lead.icpDqFranchiseLocked,
            icpDqSystemComplete: lead.icpDqSystemComplete,
            icpDqOutOfRegion: lead.icpDqOutOfRegion,
            icpStaffSize: lead.icpStaffSize,
            icpPackageEconomics: lead.icpPackageEconomics,
            icpBudgetSignal: lead.icpBudgetSignal,
            icpGapBooking: lead.icpGapBooking,
            icpGapReviews: lead.icpGapReviews,
            icpGapRemarketing: lead.icpGapRemarketing,
            icpNotes: lead.icpNotes,
            icpScoredAt: lead.icpScoredAt
              ? lead.icpScoredAt.toISOString()
              : null,
          }}
        />
      </section>
    </div>
  );
}
