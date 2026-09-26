import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  addLeadNote,
  clearConnectionRequestSent,
  convertLeadToClient,
  deleteLead,
  markConnectionRequestSent,
  moveLeadStage,
  saveIcpScorecard,
  updateLead,
} from "@/lib/actions/leads";
import { applyEnrichSelection, runLeadEnrichment } from "@/lib/actions/enrich";
import {
  clearConnectionAccepted,
  clearMessageSent,
  clearReplied,
  generateOutreachStep,
  markConnectionAccepted,
  markMessageSent,
  markReplied,
  saveMessageContent,
  setMessageMechanism,
} from "@/lib/actions/outreachSequence";
import { suggestIcpScores } from "@/lib/actions/icpAssist";
import { addLeadCall } from "@/lib/actions/calls";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import {
  ICP_SCORING_RULE,
  leadTier,
  suggestedStaffSizeScore,
} from "@/lib/icp";
import { enrichPlan } from "@/lib/leadEnrich";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { hasAssistEvidence } from "@/lib/icpAssist";
import { sequenceState, toMessageViews } from "@/lib/outreachSequenceRead";
import { salutation, salutationNote } from "@/lib/outreachSequence";
import { fmtRelative } from "@/lib/activity";
import { US_TIME_ZONES } from "@/lib/timezones";
import { fmtDateTime, toDateInput } from "@/lib/format";
import {
  IconClockHour4,
  IconSpeakerphone,
  IconStar,
  IconUsers,
} from "@tabler/icons-react";
import { IcpTierBadge, StageBadge } from "@/components/Badge";
import CallLog from "@/components/CallLog";
import ConfirmForm from "@/components/ConfirmForm";
import ConnectionRequestToggle from "@/components/ConnectionRequestToggle";
import OutreachSequencePanel from "@/components/OutreachSequencePanel";
import IcpScorecard from "@/components/IcpScorecard";
import LeadEnrichPanel from "@/components/LeadEnrichPanel";
import StatChip from "@/components/StatChip";

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
      // Every draft, not just the newest per step: the panel groups them, and
      // regenerating leaves the older ones in place rather than replacing them.
      outreach: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) notFound();

  const update = updateLead.bind(null, lead.id);
  const addNote = addLeadNote.bind(null, lead.id);
  const addCall = addLeadCall.bind(null, lead.id);
  const convert = convertLeadToClient.bind(null, lead.id);
  const remove = deleteLead.bind(null, lead.id);
  // The one-press way into the holding status, for the common case: the record
  // has been read, there is no email and no LinkedIn on it, and it should stop
  // appearing in the lists of clinics to work today. It goes through the same
  // action the board's drag does, so it is an ordinary stage change with an
  // ordinary stageChangedAt behind it — and the way back out is the stage
  // select in the form below, like any other move.
  const markNoContact = moveLeadStage.bind(null, lead.id, "NO_CONTACT");
  const saveScorecard = saveIcpScorecard.bind(null, lead.id);
  const markConnectionSent = markConnectionRequestSent.bind(null, lead.id);
  const clearConnectionSent = clearConnectionRequestSent.bind(null, lead.id);
  const runEnrichment = runLeadEnrichment.bind(null, lead.id);
  const applySelection = applyEnrichSelection.bind(null, lead.id);
  const suggestScores = suggestIcpScores.bind(null, lead.id);
  // One bound id for the whole sequence — every action below is scoped to the
  // record whose page this is, and the only id the browser ever names is a
  // message's, which each action matches against this lead's own rows.
  const sequence = {
    generate: generateOutreachStep.bind(null, lead.id),
    markSent: markMessageSent.bind(null, lead.id),
    setMechanism: setMessageMechanism.bind(null, lead.id),
    clearSent: clearMessageSent.bind(null, lead.id),
    saveContent: saveMessageContent.bind(null, lead.id),
    markAccepted: markConnectionAccepted.bind(null, lead.id),
    clearAccepted: clearConnectionAccepted.bind(null, lead.id),
    markReplied: markReplied.bind(null, lead.id),
    clearReplied: clearReplied.bind(null, lead.id),
  };
  const staffSizeSuggestion = suggestedStaffSizeScore(lead.staffCountRaw);

  // What an enrichment run would do with this lead as it stands, worked out
  // here so the panel can say which actors it is skipping before it runs
  // anything — including any step turned off in Pipeline Settings, which the
  // plan reads from the same row the run will.
  const plan = enrichPlan(lead, await loadPipelineSettings());

  // Enrichment is scraped evidence with a date on it, so it is shown as its
  // own thing rather than mixed into the editable details — a one-line summary
  // by the title for a glance, and the values in full further down.
  const enriched =
    lead.metaAdsSignal !== null ||
    lead.reviewCount !== null ||
    lead.websiteNotes !== null;

  // The ads signal is free text from the actor, and it usually opens with the
  // number that is the whole point of it — "1 active ad", "3 active ads". Split
  // where it does, so the chip can set the figure in the page's own ink and
  // leave the words around it muted like every other chip in the row; left
  // whole where it does not, because a sentence with no count in it is still
  // worth showing and is not worth guessing at.
  const adsCount = /^(\d+)\s+(\S.*)$/.exec((lead.metaAdsSignal ?? "").trim());

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/pipeline" className="text-sm text-accent hover:underline">
            ← Pipeline
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="display text-[32px] font-semibold">{lead.clinicName}</h1>
            <StageBadge stage={lead.stage} />
            <IcpTierBadge tier={leadTier(lead)} />
            {lead.archived && (
              <span className="inline-flex h-[22px] items-center rounded-full bg-line/70 px-2.5 text-xs font-medium text-muted">
                Archived
              </span>
            )}
          </div>
          {/* The last enrichment at a glance, a chip per figure. The run's date
              leads, because it is the one thing that says how much any of the
              rest is worth today. The values in full are in the card below.

              This was one muted sentence with middots in it, which read as a
              caption and scanned as nothing: three numbers, none of them louder
              than the punctuation between them. A box each, an icon to
              recognise it by, and the figure in the page's ink. */}
          {(enriched || lead.enrichedAt || lead.staffCountRaw !== null) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {lead.enrichedAt && (
                <StatChip
                  icon={<IconClockHour4 size={14} stroke={1.75} />}
                  prefix="Enriched"
                  value={fmtRelative(lead.enrichedAt)}
                  title={`Last enrichment run ${fmtDateTime(lead.enrichedAt)}`}
                />
              )}
              {lead.metaAdsSignal && (
                <StatChip
                  icon={<IconSpeakerphone size={14} stroke={1.75} />}
                  value={adsCount ? adsCount[1] : lead.metaAdsSignal}
                  label={adsCount ? adsCount[2] : undefined}
                  title={lead.metaAdsSignal}
                  className="max-w-[320px]"
                />
              )}
              {lead.reviewCount !== null && (
                <StatChip
                  icon={<IconStar size={14} stroke={1.75} />}
                  value={lead.reviewCount}
                  label={lead.reviewCount === 1 ? "review" : "reviews"}
                  title={
                    lead.reviewsCheckedAt
                      ? `Read ${fmtDateTime(lead.reviewsCheckedAt)}`
                      : undefined
                  }
                />
              )}
              {lead.staffCountRaw !== null && (
                <StatChip
                  icon={<IconUsers size={14} stroke={1.75} />}
                  value={lead.staffCountRaw}
                  label="on staff"
                />
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {/* Secondary, not destructive, and no confirmation: nothing is lost
              by pressing it — the lead keeps every field it had and one stage
              change puts it back. Hidden on a lead already in the status,
              where it would be a button that does nothing. */}
          {lead.stage !== "NO_CONTACT" && (
            <form action={markNoContact}>
              <button type="submit" className="btn">
                No Contact
              </button>
            </form>
          )}
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
            {/* Six columns, and each field takes the width its value needs
                rather than the half the form used to hand out flat. A staff
                count and a time zone in half-width boxes is a column of mostly
                empty field, and the URLs that actually need the room were
                getting the same half and truncating in it. Two columns on a
                phone, where six would be four characters wide. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-6">
              <div className="col-span-2 sm:col-span-6">
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
              <div className="col-span-2 sm:col-span-3">
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
              <div className="col-span-2 sm:col-span-3">
                <label className="field-label" htmlFor="contactTitle">
                  Contact title
                </label>
                <input
                  id="contactTitle"
                  name="contactTitle"
                  defaultValue={lead.contactTitle ?? ""}
                  placeholder="Owner, Clinic Director…"
                  className="field"
                />
              </div>
              <div className="col-span-2 sm:col-span-2">
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
              <div className="col-span-2 sm:col-span-2">
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
              <div className="col-span-2 sm:col-span-2">
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
              <div className="col-span-2 sm:col-span-3">
                <label className="field-label" htmlFor="linkedinUrl">
                  LinkedIn URL
                </label>
                <input
                  id="linkedinUrl"
                  name="linkedinUrl"
                  defaultValue={lead.linkedinUrl ?? ""}
                  placeholder="Contact's profile"
                  className="field truncate"
                />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className="field-label" htmlFor="companyLinkedinUrl">
                  Company LinkedIn URL
                </label>
                <input
                  id="companyLinkedinUrl"
                  name="companyLinkedinUrl"
                  defaultValue={lead.companyLinkedinUrl ?? ""}
                  placeholder="Clinic's company page"
                  className="field truncate"
                />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className="field-label" htmlFor="websiteUrl">
                  Website URL
                </label>
                <input
                  id="websiteUrl"
                  name="websiteUrl"
                  defaultValue={lead.websiteUrl ?? ""}
                  placeholder="Crawled for website notes"
                  className="field truncate"
                />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className="field-label" htmlFor="facebookUrl">
                  Facebook URL
                </label>
                <input
                  id="facebookUrl"
                  name="facebookUrl"
                  defaultValue={lead.facebookUrl ?? ""}
                  placeholder="Page, for the ads library check"
                  className="field truncate"
                />
              </div>
              <div className="col-span-2 sm:col-span-4">
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
              <div className="col-span-2 sm:col-span-2">
                <label className="field-label" htmlFor="timeZone">
                  Time zone
                </label>
                <select
                  id="timeZone"
                  name="timeZone"
                  defaultValue={lead.timeZone ?? ""}
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
              <div className="col-span-1 sm:col-span-2">
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
              <div className="col-span-1 sm:col-span-2">
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
              <div className="col-span-2 sm:col-span-2">
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
              <div className="col-span-2 sm:col-span-2">
                <label className="field-label" htmlFor="stage">
                  Stage
                </label>
                {/* Keyed on the stage so that a stage changed from outside
                    this form — the No Contact button above — resets it. An
                    uncontrolled select takes its defaultValue at mount and
                    ignores every render after, so without the key it would
                    still be showing the old stage next to a badge showing the
                    new one, and the next save of an unrelated field would
                    quietly move the lead back. */}
                <select
                  key={lead.stage}
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
              lead.facebookUrl ||
              // A mark outlives the URL it was made against: a profile link
              // deleted later shouldn't take the record of the outreach with it.
              lead.connectionRequestSentAt) && (
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
                {/* The one thing in this row that records rather than opens.
                    Sending the request is still done by hand on LinkedIn; this
                    is where you say you did it, so the pipeline can show it.

                    Once marked it stops being a button — the useful state is
                    the date, and a button that has already been pressed is an
                    invitation to press it again. Offered only where there is a
                    LinkedIn profile to have sent it to, but shown wherever the
                    mark exists. */}
                {(lead.connectionRequestSentAt ||
                  lead.linkedinUrl ||
                  lead.companyLinkedinUrl) && (
                  <ConnectionRequestToggle
                    sentLabel={
                      lead.connectionRequestSentAt
                        ? `Connection sent ${fmtRelative(lead.connectionRequestSentAt)}`
                        : null
                    }
                    sentTitle={
                      lead.connectionRequestSentAt
                        ? `Marked sent ${fmtDateTime(lead.connectionRequestSentAt)}`
                        : null
                    }
                    mark={markConnectionSent}
                    clear={clearConnectionSent}
                  />
                )}
              </div>
            )}

            {/* The Loom, which is step 4's one unfillable blank. It sits in the
                details form because it is a fact about the lead somebody types
                and saves, exactly like the four URLs above it — the panel below
                only reads it. */}
            <div className="border-t border-line/60 pt-5">
              <label className="field-label" htmlFor="replyText">
                What they wrote back
              </label>
              <textarea
                id="replyText"
                name="replyText"
                rows={3}
                defaultValue={lead.replyText ?? ""}
                placeholder="Paste their reply here, as they wrote it."
                className="field"
              />
              <p className="mb-5 mt-1.5 text-xs leading-relaxed text-muted">
                The audit offer in the sequence below is written from this. Its
                job is to answer what they actually said, so pasting the reply in
                is what stops it opening with a generic “appreciate that
                context”. Marking a reply without keeping the text still works;
                that step then acknowledges the reply and attributes nothing.
              </p>

              <label className="field-label" htmlFor="loomUrl">
                Loom URL — the audit recorded for this clinic
              </label>
              <input
                id="loomUrl"
                name="loomUrl"
                type="url"
                inputMode="url"
                defaultValue={lead.loomUrl ?? ""}
                placeholder="https://www.loom.com/share/…"
                spellCheck={false}
                autoComplete="off"
                className="field"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Save the lead to store it. The delivery message in the sequence
                below unlocks once there is one, and the link is dropped into it
                as written.
              </p>
            </div>
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
          {/* Empty, this is a line and a dashed rule — not a card. A lead with
              no notes on it is the common case, and the panel used to answer
              that by reserving a filled box the height of several notes that
              were not there, which is a hole in the column beside the details
              form. It grows into a card the moment there is something to
              hold. */}
          {lead.notes.length === 0 ? (
            <p className="mt-3 rounded-[10px] border border-dashed border-line px-4 py-3.5 text-center text-xs leading-relaxed text-muted">
              No activity yet. Notes are append-only and timestamped.
            </p>
          ) : (
            <div className="card mt-4">
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
            </div>
          )}

          {/* The five messages, in the order they happen. Its own section
              rather than a control in the outreach row above: it is a sequence
              with states in it, not a button, and it is the length of a card.

              In this column rather than under the details form: the form is
              the long thing on this page and the sequence is the thing you came
              to the page to work, so putting them side by side is what stops
              the sequence starting a screen and a half down — and it is what
              fills the space the activity log gave back by no longer reserving
              a card for notes that are not there.

              Outside the details form on purpose — every control in it acts on
              its own the moment it is pressed, and nesting that in a form whose
              own Save is somewhere above would make "did that save?" a fair
              question about both. */}
          <div className="mb-4 mt-8 flex items-baseline justify-between gap-4">
            <h2 className="display text-xl font-semibold">Outreach sequence</h2>
            <p className="text-xs text-muted">
              Drafts to copy — nothing here is sent
            </p>
          </div>
          <div className="card p-6">
            <OutreachSequencePanel
              messages={toMessageViews(lead.outreach)}
              state={sequenceState(lead)}
              actions={sequence}
              acceptedLabel={
                lead.connectionAcceptedAt
                  ? `Accepted ${fmtRelative(lead.connectionAcceptedAt)}`
                  : null
              }
              repliedLabel={
                lead.repliedAt ? `Replied ${fmtRelative(lead.repliedAt)}` : null
              }
              salutationNote={salutationNote(
                salutation(lead.contactName, lead.contactTitle, lead.websiteNotes),
              )}
            />
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
          // Reads the enrichment above and suggests category B and two of the
          // Automation Gap boxes. Same rule as the staff count below it: the
          // card pre-selects what comes back and stores none of it until the
          // card is saved. The same test the action applies decides whether
          // the button is offered at all.
          suggestScores={suggestScores}
          enriched={hasAssistEvidence(lead)}
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
