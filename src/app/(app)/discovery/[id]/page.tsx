import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  deleteDiscoveryCandidate,
  promoteDiscoveryCandidate,
  updateDiscoveryCandidate,
} from "@/lib/actions/discovery";
import {
  DISCOVERY_STATUS_MEANINGS,
  DiscoveryStatus,
  parseBreakdown,
} from "@/lib/discovery";
import { MAX_BATCH_LABEL_LENGTH } from "@/lib/discoveryBatch";
import { ICP_MAX_SCORE, IcpTier } from "@/lib/icp";
import { fmtDateTime } from "@/lib/format";
import { fmtRelative } from "@/lib/activity";
import { US_TIME_ZONES } from "@/lib/timezones";
import { DiscoveryStatusBadge, IcpTierBadge } from "@/components/Badge";
import ConfirmForm from "@/components/ConfirmForm";
import DiscoveryBreakdownView, {
  DiscoveryScoreHeader,
} from "@/components/DiscoveryBreakdown";

export const dynamic = "force-dynamic";

// One candidate, whole: the fields the queue runs on, what the actors brought
// back, and the reasoning behind whatever the queue decided.
//
// The fields are editable and the verdict is not. That split is the record's
// whole shape — a candidate is evidence plus a judgement made from it, and the
// only honest way to change the judgement is to change the evidence and run
// the queue again.
export default async function DiscoveryCandidatePage({
  params,
}: {
  params: { id: string };
}) {
  const candidate = await prisma.discoveryCandidate.findUnique({
    where: { id: params.id },
    include: { promotedLead: { select: { id: true, clinicName: true } } },
  });
  if (!candidate) notFound();

  const update = updateDiscoveryCandidate.bind(null, candidate.id);
  const promote = promoteDiscoveryCandidate.bind(null, candidate.id);
  const remove = deleteDiscoveryCandidate.bind(null, candidate.id);

  const breakdown = parseBreakdown(candidate.icpBreakdown);
  const enriched =
    candidate.metaAdsSignal !== null ||
    candidate.reviewCount !== null ||
    candidate.websiteNotes !== null;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/discovery"
            className="text-sm text-accent hover:underline"
          >
            ← Discovery
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="display text-[32px] font-semibold">
              {candidate.clinicName}
            </h1>
            <DiscoveryStatusBadge status={candidate.status} />
            <IcpTierBadge tier={(candidate.icpTier as IcpTier | null) ?? null} />
            {candidate.icpTotal != null && (
              <span className="num text-sm text-muted">
                {candidate.icpTotal} / {ICP_MAX_SCORE}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {DISCOVERY_STATUS_MEANINGS[candidate.status as DiscoveryStatus] ??
              candidate.status}
            {candidate.enrichedAt && (
              <>
                {" · "}
                <span
                  className="num"
                  title={`Last enrichment run ${fmtDateTime(candidate.enrichedAt)}`}
                >
                  Enriched {fmtRelative(candidate.enrichedAt)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {candidate.promotedLead ? (
            <Link
              href={`/pipeline/${candidate.promotedLead.id}`}
              className="btn"
            >
              View the lead →
            </Link>
          ) : (
            <ConfirmForm
              action={promote}
              message={
                breakdown
                  ? `Promote ${candidate.clinicName} to the pipeline anyway? The scorecard it arrives with is the one this run produced — including anything flagged against it — and it stays editable on the lead.`
                  : `Promote ${candidate.clinicName} to the pipeline? It has never been scored, so the lead arrives with an empty ICP scorecard.`
              }
              className="btn shrink-0"
            >
              Promote anyway
            </ConfirmForm>
          )}
          <ConfirmForm
            action={remove}
            message={
              candidate.promotedLead
                ? `Delete this discovery record for "${candidate.clinicName}"? The lead it became stays in the pipeline.`
                : `Delete candidate "${candidate.clinicName}" and its scoring?`
            }
            className="btn-danger"
          >
            Delete
          </ConfirmForm>
        </div>
      </div>

      {candidate.status === "FAILED" && candidate.failureReason && (
        <div className="mt-6 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
          <p className="text-sm font-medium text-bad">
            The chain stopped before anything was scored
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {candidate.failureReason}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Nothing was scored on partial evidence, deliberately. Fix whatever
            it names below and the next “Process queue” run picks this one up
            again from the top.
          </p>
        </div>
      )}

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
                defaultValue={candidate.clinicName}
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
                  defaultValue={candidate.contactName ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="source">
                  Source
                </label>
                <input
                  id="source"
                  name="source"
                  defaultValue={candidate.source ?? ""}
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
                  defaultValue={candidate.phone ?? ""}
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
                  defaultValue={candidate.email ?? ""}
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
                  defaultValue={candidate.linkedinUrl ?? ""}
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
                  defaultValue={candidate.companyLinkedinUrl ?? ""}
                  placeholder="Runs the company lookup"
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
                  defaultValue={candidate.websiteUrl ?? ""}
                  placeholder="Filled by the company lookup if left blank"
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
                  defaultValue={candidate.facebookUrl ?? ""}
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
                  defaultValue={candidate.location ?? ""}
                  placeholder="Town or metro — narrows the Maps search"
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
                  defaultValue={candidate.timeZone ?? ""}
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
                  defaultValue={candidate.staffCountRaw ?? ""}
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
                  defaultValue={candidate.estValue ?? ""}
                  className="field num"
                />
              </div>
              {/* The run this one arrived on. Editable like the rest of the
                  record, and on purpose: a batch named after the actor that
                  produced it is often not what the run turned out to be, and
                  renaming it here renames it for this candidate only. */}
              <div className="col-span-2">
                <label className="field-label" htmlFor="batchLabel">
                  Batch
                </label>
                <input
                  id="batchLabel"
                  name="batchLabel"
                  defaultValue={candidate.batchLabel ?? ""}
                  maxLength={MAX_BATCH_LABEL_LENGTH}
                  placeholder="Which import or queue run this arrived on"
                  className="field"
                />
              </div>
            </div>
            <p className="border-t border-line/60 pt-5 text-xs leading-relaxed text-muted">
              These are the fields the chain runs on. The company page, the
              Facebook page, the website and the clinic name with its location
              are each one actor’s input — an empty one is a skipped actor, not
              a failed run. Nothing here changes a score already recorded;
              re-running the queue does.
            </p>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary">
                Save changes
              </button>
            </div>
          </form>
        </section>

        <section>
          <h2 className="display mb-4 text-xl font-semibold">Enrichment</h2>
          {enriched ? (
            <div className="card">
              <div className="border-b border-line/60 px-6 py-4">
                <p className="num text-xs text-muted">
                  {candidate.enrichedAt
                    ? `Last run ${fmtDateTime(candidate.enrichedAt)} — a snapshot, not live`
                    : "From an actor run — a snapshot, not live"}
                </p>
              </div>
              {candidate.staffCountRaw !== null && (
                <div className="border-b border-line/60 px-6 py-4 last:border-b-0">
                  <div className="field-label mb-1">Staff count</div>
                  <p className="num text-sm">{candidate.staffCountRaw}</p>
                </div>
              )}
              {candidate.metaAdsSignal && (
                <div className="border-b border-line/60 px-6 py-4 last:border-b-0">
                  <div className="field-label mb-1">Meta ads signal</div>
                  <p className="text-sm">{candidate.metaAdsSignal}</p>
                </div>
              )}
              {candidate.reviewCount !== null && (
                <div className="border-b border-line/60 px-6 py-4 last:border-b-0">
                  <div className="field-label mb-1">Review count</div>
                  <p className="num text-sm">{candidate.reviewCount}</p>
                </div>
              )}
              {candidate.websiteNotes && (
                <div className="border-b border-line/60 px-6 py-4 last:border-b-0">
                  <div className="field-label mb-1">Website notes</div>
                  <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
                    {candidate.websiteNotes}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="card px-6 py-8 text-center">
              <p className="text-sm font-medium">Nothing gathered yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
                The four actors run as the first step of “Process queue”, from
                the URLs on the left. What they bring back appears here, dated,
                and is what the scoring reads.
              </p>
            </div>
          )}
        </section>
      </div>

      <section className="mt-8">
        <h2 className="display mb-4 text-xl font-semibold">ICP Scorecard</h2>
        {breakdown ? (
          <div className="card">
            <DiscoveryScoreHeader breakdown={breakdown} />
            <DiscoveryBreakdownView breakdown={breakdown} />
            <p className="border-t border-line/60 px-6 py-4 text-xs leading-relaxed text-muted">
              This is the transcript of one automated run against the evidence
              it had that day, stored as it was written — it does not re-read
              itself when the framework changes. The editable scorecard lives on
              the lead, where every one of these answers arrives pre-filled and
              can be corrected.
            </p>
          </div>
        ) : (
          <div className="card px-6 py-8 text-center">
            <p className="text-sm font-medium">Not scored yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
              Scoring happens in “Process queue” — five hard disqualifiers,
              four categories out of {ICP_MAX_SCORE}, every answer with the
              sentence behind it. Nothing is scored by hand here, deliberately.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
