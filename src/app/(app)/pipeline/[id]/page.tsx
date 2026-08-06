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
import { applyEnrichSelection, runLeadEnrichment } from "@/lib/actions/enrich";
import { addLeadCall } from "@/lib/actions/calls";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import {
  ICP_SCORING_RULE,
  leadTier,
  suggestedStaffSizeScore,
} from "@/lib/icp";
import { enrichPlan } from "@/lib/leadEnrich";
import { fmtRelative } from "@/lib/activity";
import { fmtDateTime, toDateInput } from "@/lib/format";
import { IcpTierBadge, StageBadge } from "@/components/Badge";
import CallLog from "@/components/CallLog";
import ConfirmForm from "@/components/ConfirmForm";
import IcpScorecard from "@/components/IcpScorecard";
import LeadEnrichPanel from "@/components/LeadEnrichPanel";

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
  const runEnrichment = runLeadEnrichment.bind(null, lead.id);
  const applySelection = applyEnrichSelection.bind(null, lead.id);
  const staffSizeSuggestion = suggestedStaffSizeScore(lead.staffCountRaw);

  // What an enrichment run would do with this lead as it stands, worked out
  // here so the panel can say which actors it is skipping before it runs
  // anything.
  const plan = enrichPlan(lead);

  // Enrichment is scraped evidence with a date on it, so it is shown as its
  // own thing rather than mixed into the editable details — a one-line summary
  // by the title for a glance, and the values in full further down.
  const enriched =
    lead.metaAdsSignal !== null ||
    lead.reviewCount !== null ||
    lead.websiteNotes !== null;

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
          {/* The last enrichment at a glance. The run's date leads, because it
              is the one thing that says how much any of the rest is worth
              today. The values in full are in the card below. */}
          {(enriched || lead.enrichedAt) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted">
              {lead.enrichedAt && (
                <span
                  className="num font-medium text-ink"
                  title={`Last enrichment run ${fmtDateTime(lead.enrichedAt)}`}
                >
                  Enriched {fmtRelative(lead.enrichedAt)}
                </span>
              )}
              {lead.metaAdsSignal && (
                <>
                  {lead.enrichedAt && <span aria-hidden>·</span>}
                  <span className="max-w-[420px] truncate" title={lead.metaAdsSignal}>
                    Ads: <span className="text-ink">{lead.metaAdsSignal}</span>
                  </span>
                </>
              )}
              {lead.reviewCount !== null && (
                <>
                  {(lead.enrichedAt || lead.metaAdsSignal) && (
                    <span aria-hidden>·</span>
                  )}
                  <span className="num">
                    Reviews: <span className="text-ink">{lead.reviewCount}</span>
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <LeadEnrichPanel
            run={runEnrichment}
            applySelection={applySelection}
            plan={plan}
            clinicName={lead.clinicName}
          />
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
                <label className="field-label" htmlFor="websiteUrl">
                  Website URL
                </label>
                <input
                  id="websiteUrl"
                  name="websiteUrl"
                  defaultValue={lead.websiteUrl ?? ""}
                  placeholder="Crawled for website notes"
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="facebookUrl">
                  Facebook URL
                </label>
                <input
                  id="facebookUrl"
                  name="facebookUrl"
                  defaultValue={lead.facebookUrl ?? ""}
                  placeholder="Page, for the ads library check"
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="location">
                  Location
                </label>
                <input
                  id="location"
                  name="location"
                  defaultValue={lead.location ?? ""}
                  placeholder="Town or metro — narrows the Maps search"
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
            {(lead.linkedinUrl ||
              lead.companyLinkedinUrl ||
              lead.websiteUrl ||
              lead.facebookUrl) && (
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
                {lead.websiteUrl && (
                  <a
                    href={lead.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn h-[34px] px-3.5 text-xs"
                  >
                    Visit website ↗
                  </a>
                )}
                {lead.facebookUrl && (
                  <a
                    href={lead.facebookUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn h-[34px] px-3.5 text-xs"
                  >
                    View Facebook page ↗
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

          {/* Written only by “Enrich this lead”, and shown apart from the form
              above because it is not the same kind of fact: these are readings
              taken on a day, not fields somebody keeps up to date. */}
          {enriched && (
            <>
              <div className="mb-4 mt-8 flex items-baseline justify-between gap-4">
                <h2 className="display text-xl font-semibold">Enrichment</h2>
                <p className="num text-xs text-muted">
                  {lead.enrichedAt
                    ? `Last run ${fmtDateTime(lead.enrichedAt)} — a snapshot, not live`
                    : "From an actor run — a snapshot, not live"}
                </p>
              </div>
              <div className="card">
                {lead.metaAdsSignal && (
                  <div className="border-b border-line/60 px-6 py-4 last:border-b-0">
                    <div className="field-label mb-1">Meta ads signal</div>
                    <p className="text-sm">{lead.metaAdsSignal}</p>
                  </div>
                )}
                {lead.reviewCount !== null && (
                  <div className="border-b border-line/60 px-6 py-4 last:border-b-0">
                    <div className="field-label mb-1">Review count</div>
                    <p className="num text-sm">
                      {lead.reviewCount}
                      {/* Its own date, because a run where the Maps actor was
                          skipped or failed leaves this count older than the
                          run that sits above it. */}
                      {lead.reviewsCheckedAt && (
                        <span className="ml-2 text-xs text-muted">
                          read {fmtDateTime(lead.reviewsCheckedAt)}
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {lead.websiteNotes && (
                  <div className="border-b border-line/60 px-6 py-4 last:border-b-0">
                    <div className="field-label mb-1">Website notes</div>
                    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
                      {lead.websiteNotes}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
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
