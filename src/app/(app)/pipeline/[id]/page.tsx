import PageActions from "@/components/PageActions";
import UnflagLeadButton from "@/components/UnflagLeadButton";
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
  setLeadChannel,
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
import {
  saveIcpScorecardV2,
  suggestIcpScoresV2,
} from "@/lib/actions/icpScorecardV2";
import { addLeadCall } from "@/lib/actions/calls";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import { leadBreakdownV2, leadScore, leadTier } from "@/lib/leadScore";
import { FIT_MAX, SIGNALS_MAX, V2_MAX_SCORE } from "@/lib/icpWeights";
import {
  EMAIL_SOURCE_LABELS,
  EMAIL_STATUS_LABELS,
  EMAIL_TYPE_LABELS,
  effectiveEmailSource,
  parseAlternates,
  readEmailStatus,
  readEmailType,
} from "@/lib/emailFind";
import { loadActiveIcp } from "@/lib/icpDefinitionStore";
import { emptyBreakdownV2 } from "@/lib/icpScoring";
import { enrichPlan } from "@/lib/leadEnrich";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { hasAssistEvidence } from "@/lib/icpAssist";
import { sequenceState, toMessageViews } from "@/lib/outreachSequenceRead";
import { salutation, salutationNote } from "@/lib/outreachSequence";
import { fmtRelative } from "@/lib/activity";
import { US_TIME_ZONES, isUsTimeZone, zoneLabel } from "@/lib/timezones";
import { fmtDate, fmtDateTime, toDateInput } from "@/lib/format";
import {
  IconBrandFacebookFilled,
  IconBrandLinkedin,
  IconClockHour4,
  IconMail,
  IconMapPin,
  IconSend,
  IconSpeakerphone,
  IconStarFilled,
  IconUsers,
  IconWorld,
  IconHistory,
} from "@tabler/icons-react";
import { FactTile, ScoreRingCard, SectionTitle, Timeline, scoreTip } from "@/components/LeadVisuals";
import { EmailStatusBadge } from "@/components/Badge";
import CallLog from "@/components/CallLog";
import ConfirmForm from "@/components/ConfirmForm";
import ConnectionRequestToggle from "@/components/ConnectionRequestToggle";
import OutreachSequencePanel from "@/components/OutreachSequencePanel";
import EmailPanel from "@/components/EmailPanel";
import { contactFormProps, emailPanelProps } from "@/lib/emailWorkflowRead";
import ContactFormButtons from "@/components/ContactFormButtons";
import { OPEN_TASK_STATUSES } from "@/lib/tasks";
import { moveTaskStatus } from "@/lib/actions/tasks";
import StageSelect from "@/components/StageSelect";
import DetailsCard from "@/components/DetailsCard";
import DropdownMenu, { MENU_ITEM } from "@/components/DropdownMenu";
import IcpScorecardV2 from "@/components/IcpScorecardV2";
import OldModelScorecard from "@/components/OldModelScorecard";
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
      // Every draft, not just the newest per step: the panel groups them, and
      // regenerating leaves the older ones in place rather than replacing them.
      outreach: { orderBy: { createdAt: "desc" } },
      emailSends: { orderBy: { step: "asc" } },
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
  const moveChannel = setLeadChannel.bind(
    null,
    lead.id,
    lead.channel === "email" ? "linkedin" : "email",
  );
  const saveScorecard = saveIcpScorecardV2.bind(null, lead.id);
  const markConnectionSent = markConnectionRequestSent.bind(null, lead.id);
  const clearConnectionSent = clearConnectionRequestSent.bind(null, lead.id);
  const runEnrichment = runLeadEnrichment.bind(null, lead.id);
  const applySelection = applyEnrichSelection.bind(null, lead.id);
  const suggestScores = suggestIcpScoresV2.bind(null, lead.id);
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
  // What an enrichment run would do with this lead as it stands, worked out
  // here so the panel can say which actors it is skipping before it runs
  // anything — including any step turned off in Pipeline Settings, which the
  // plan reads from the same row the run will.
  const settings = await loadPipelineSettings();
  const plan = enrichPlan(lead, settings);
  // The task to do next on this lead: the open one due soonest.
  const nextTask = await prisma.task.findFirst({
    where: { leadId: lead.id, status: { in: OPEN_TASK_STATUSES } },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: { id: true, title: true, description: true, dueDate: true },
  });
  // The ads signal usually opens with its count: "6 active ads".
  const scoreNow = leadScore(lead);
  const adsCount = /(\d+)/.exec(lead.metaAdsSignal ?? "");
  const completeNextTask = nextTask ? moveTaskStatus.bind(null, nextTask.id, "DONE") : undefined;

  // The email panel's props, worked out once: the header's status pill reads
  // them too.
  const emailProps = lead.channel === "email" ? await emailPanelProps(lead) : null;

  // The side column's timeline: what happened to the lead (the activity feed)
  // and what was written on it (notes), newest first.
  const events = await prisma.activityLog.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, kind: true, summary: true, createdAt: true },
  });
  const timeline = [
    ...events.map((e) => ({ id: `a-${e.id}`, kind: e.kind, text: e.summary, at: e.createdAt })),
    ...lead.notes.map((n) => ({ id: `n-${n.id}`, kind: "NOTE", text: n.body, at: n.createdAt })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const overdue = nextTask?.dueDate ? nextTask.dueDate.getTime() < Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) : false;

  // Email leads only: the message is the front-desk email.
  const contactForm = lead.channel === "email" ? await contactFormProps(lead) : null;

  // The scorecard. The ICP model's card where the lead has one; a blank card
  // against the active ICP where it does not, to score by hand or with the
  // assist. The old A–D answers are shown under it, read-only, for any lead
  // that was scored that way.
  const storedV2 = leadBreakdownV2(lead);
  const activeIcp = await loadActiveIcp();
  const blankV2 = activeIcp
    ? emptyBreakdownV2(activeIcp, settings.promotionThresholdV2, new Date())
    : null;


  return (
    <div>
      {lead.scoringRejectedAt && (
        <div className="card mb-4 border-bad/40 px-5 py-3 text-xs leading-relaxed max-md:px-3">
          <p className="font-medium text-bad">Rejected by new scoring</p>
          <p className="text-muted">
            {lead.scoringRejectedReason ?? "No reason recorded."} Hidden from the
            default Pipeline view, Outreach and the dashboard until the apply is
            reverted in Settings → Pipeline.
          </p>
          <UnflagLeadButton leadId={lead.id} />
        </div>
      )}
      <Link href="/pipeline" className="text-sm text-muted hover:text-ink">
        ← Pipeline{lead.channel === "email" ? " · Email" : ""}
      </Link>

      {/* The header: tier, name, who and where; the status, the stage and the
          rarer actions on the right. */}
      <div className={`card card-sheen relative z-10 mt-3 space-y-5 overflow-visible bg-gradient-to-r p-6 max-md:p-4 ${HEADER_TINT[leadTier(lead) ?? ""] ?? "from-surface"} via-surface to-surface`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <TierTile tier={leadTier(lead)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-[28px] font-semibold leading-tight">{lead.clinicName}</h1>
              {lead.archived && (
                <span className="inline-flex h-[22px] items-center rounded-full bg-line/70 px-2.5 text-xs font-medium text-muted">
                  Archived
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {[lead.contactName ?? "No contact yet", lead.location, isUsTimeZone(lead.timeZone) ? `${zoneLabel(lead.timeZone)} time` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {emailProps && <EmailStatusBadge status={emailProps.status} />}
          <StageSelect leadId={lead.id} stage={lead.stage} />
          <PageActions className="flex flex-wrap items-center gap-2">
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
            {/* The rarer moves, behind ⋯: which Pipeline view the lead sits in
                (undone by the same item), No Contact (nothing is lost — one
                stage change puts it back), and Delete, which asks first. */}
            <DropdownMenu label="More actions" icon>
              <form action={moveChannel}>
                <button type="submit" className={MENU_ITEM}>
                  {lead.channel === "email" ? "Move to LinkedIn" : "Move to email"}
                  <span className="text-xs font-normal text-muted">Changes which Pipeline view it is in</span>
                </button>
              </form>
              {lead.stage !== "NO_CONTACT" && (
                <form action={markNoContact}>
                  <button type="submit" className={MENU_ITEM}>
                    No Contact
                    <span className="text-xs font-normal text-muted">Off today&apos;s lists; the stage select brings it back</span>
                  </button>
                </form>
              )}
              <div className="my-1 border-t border-line/60" />
              <div className="[&>form]:block">
                <ConfirmForm
                  action={remove}
                  message={`Delete lead "${lead.clinicName}" and its activity log?`}
                  className={`${MENU_ITEM} text-bad`}
                >
                  Delete lead
                </ConfirmForm>
              </div>
            </DropdownMenu>
          </PageActions>
        </div>
      </div>
      {/* The facts worth a glance, a tile each: the last enrichment's readings. */}
      {(lead.reviewCount !== null || lead.staffCountRaw !== null || lead.metaAdsSignal || lead.enrichedAt) && (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {lead.reviewCount !== null && (
            <FactTile icon={<IconStarFilled size={16} />} tone="amber" value={lead.reviewCount} label="Google reviews"
              title={lead.reviewsCheckedAt ? `Read ${fmtDateTime(lead.reviewsCheckedAt)}` : undefined} />
          )}
          {lead.staffCountRaw !== null && <FactTile icon={<IconUsers size={16} stroke={2} />} tone="blue" value={lead.staffCountRaw} label="on staff" />}
          {lead.metaAdsSignal && (
            <FactTile icon={<IconSpeakerphone size={16} stroke={2} />} tone="pink"
              value={adsCount ? `${adsCount[1]} ad${adsCount[1] === "1" ? "" : "s"}` : "Ads"} label={adsCount ? "on Meta" : lead.metaAdsSignal} title={lead.metaAdsSignal} />
          )}
          {lead.enrichedAt && (
            <FactTile icon={<IconClockHour4 size={16} stroke={2} />} tone="neutral" value={fmtRelative(lead.enrichedAt)} label="last enriched"
              title={fmtDateTime(lead.enrichedAt)} />
          )}
        </div>
      )}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ─── The main column: reach out, the message, the details ────── */}
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="reach-out" className="card card-sheen space-y-4 p-6 max-md:p-4">
            <SectionTitle
              id="reach-out"
              tone="blue"
              icon={<IconSend size={18} stroke={2} />}
              aside={
                lead.channel === "email" && !(lead.email ?? "").trim() ? (
                  <p className="text-sm text-muted">
                    {lead.facebookEmailAt ? "No email found on Maps, the website or Facebook" : "No email yet"}
                  </p>
                ) : undefined
              }
            >
              Reach out
            </SectionTitle>
            <div className="flex flex-wrap items-center gap-2">
              {lead.websiteUrl && (
                <a href={lead.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-wash px-3 text-sm font-medium text-ink transition-colors hover:bg-line/60">
                  <IconWorld size={16} stroke={1.75} aria-hidden className="text-muted" />
                  Website
                </a>
              )}
              {lead.facebookUrl && (
                <a href={lead.facebookUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#1877F2]/35 bg-[#1877F2]/10 px-3 text-sm font-medium text-[#1462D4] transition-colors hover:bg-[#1877F2]/15 dark:text-[#8DB8FF]">
                  <IconBrandFacebookFilled size={16} aria-hidden className="text-[#1877F2] dark:text-[#4C8DFF]" />
                  Facebook
                </a>
              )}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([lead.clinicName, lead.location].filter(Boolean).join(" "))}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-ok/35 bg-ok-soft px-3 text-sm font-medium text-ok-on-soft transition-colors hover:bg-ok/15"
              >
                <IconMapPin size={16} stroke={2} aria-hidden className="text-ok" />
                Google Maps
              </a>
              {lead.linkedinUrl && (
                <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-wash px-3 text-sm font-medium text-ink transition-colors hover:bg-line/60">
                  <IconBrandLinkedin size={16} stroke={1.75} aria-hidden className="text-muted" />
                  LinkedIn profile
                </a>
              )}
              {lead.companyLinkedinUrl && (
                <a href={lead.companyLinkedinUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-wash px-3 text-sm font-medium text-ink transition-colors hover:bg-line/60">
                  <IconBrandLinkedin size={16} stroke={1.75} aria-hidden className="text-muted" />
                  Company page
                </a>
              )}
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
            {/* The clinic's own contact form, for a front-desk message sent
                by hand: open it, paste the message, mark it sent. */}
            {contactForm && <ContactFormButtons {...contactForm} />}
          </section>

          {/* The message: the email and its send buttons on the email
              channel, the five-message sequence on LinkedIn. Outside the
              details form on purpose — every control in it acts on its own. */}
          {emailProps ? (
            <section aria-labelledby="the-message" className="card card-sheen space-y-4 p-6 max-md:p-4">
              <SectionTitle id="the-message" tone="indigo" icon={<IconMail size={18} stroke={2} />}>
                The message
              </SectionTitle>
              <EmailPanel {...emailProps} />
            </section>
          ) : (
            <section aria-labelledby="the-message" className="space-y-4">
            {lead.suppressedAt && (
              // On the suppression list: drafting and marking sent are refused
              // on the server too.
              <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
                <p className="text-sm font-medium text-bad">On the suppression list</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  This clinic said no to email. It is not contacted on any channel, LinkedIn included.
                </p>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="the-message" className="text-lg font-semibold">Outreach sequence</h2>
              <p className="helper-text text-xs text-muted">
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
          )}

          <DetailsCard
            summary={
              <>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                  <SummaryItem label="Contact">
                    {lead.contactName ? (
                      <>
                        {lead.contactName}
                        {lead.contactTitle && <span className="block text-xs text-muted">{lead.contactTitle}</span>}
                      </>
                    ) : null}
                  </SummaryItem>
                  <SummaryItem label="Phone" num>{lead.phone}</SummaryItem>
                  <SummaryItem label="Reviews" num>{lead.reviewCount}</SummaryItem>
                  <SummaryItem label="Staff" num>{lead.staffCountRaw}</SummaryItem>
                  <SummaryItem label="Meta ads">{lead.metaAdsSignal}</SummaryItem>
                  <SummaryItem label="Enriched">{lead.enrichedAt ? fmtDate(lead.enrichedAt) : null}</SummaryItem>
                </dl>
                {lead.websiteNotes && (
                  <details className="mt-5 border-t border-line/60 pt-4">
                    <summary className="cursor-pointer text-sm font-medium text-accent">Website notes</summary>
                    <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {lead.websiteNotes}
                    </p>
                  </details>
                )}
              </>
            }
          >
          <form action={update} className="space-y-5">
            {/* Six columns, and each field takes the width its value needs
                rather than the half the form used to hand out flat. A staff
                count and a time zone in half-width boxes is a column of mostly
                empty field, and the URLs that actually need the room were
                getting the same half and truncating in it. Two columns on a
                phone, where six would be four characters wide. */}
            <div className="m-form-stack grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-6">
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
              <div className="col-span-2 -mt-2 empty:hidden sm:col-span-6">
                <EmailFacts lead={lead} />
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
              <p className="helper-text mb-5 mt-1.5 text-xs leading-relaxed text-muted">
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
              <p className="helper-text mt-1.5 text-xs leading-relaxed text-muted">
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
          </DetailsCard>
        </div>

        {/* ─── The side column: next step, score, activity ─────────────── */}
        <aside className="min-w-0 space-y-6">
          {nextTask && (
            <section aria-labelledby="next-step" className="rounded-2xl bg-hero p-6 text-white shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-hero-ink">Next step</p>
              <h2 id="next-step" className="mt-2 text-lg font-semibold leading-snug">
                {nextTask.title}
                {nextTask.dueDate && <> on {fmtDayMonth(nextTask.dueDate)}</>}
              </h2>
              <p className={`mt-1.5 text-sm ${overdue ? "font-medium text-[#FFB4AB]" : "text-hero-ink"}`}>
                {overdue ? `Overdue — was due ${fmtDate(nextTask.dueDate)}. ` : ""}
                {nextTask.description}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <a href="#calls" className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] bg-teal text-sm font-semibold text-hero transition-opacity hover:opacity-90">
                  Log the call
                </a>
                <form action={completeNextTask}>
                  <button type="submit" className="h-10 rounded-[10px] border border-white/25 px-3 text-sm font-medium text-white transition-colors hover:bg-white/10">
                    Done
                  </button>
                </form>
              </div>
            </section>
          )}

          <ScoreRingCard
            total={scoreNow?.total ?? null}
            max={scoreNow?.max ?? V2_MAX_SCORE}
            tier={scoreNow?.tier ?? null}
            parts={
              storedV2
                ? [
                    { label: "Fit", value: storedV2.fitTotal, max: FIT_MAX, dot: "bg-teal" },
                    { label: "Signals", value: storedV2.signalsTotal, max: SIGNALS_MAX, dot: "bg-accent" },
                    { label: "Not earned", value: Math.max(0, FIT_MAX - storedV2.fitTotal) + Math.max(0, SIGNALS_MAX - storedV2.signalsTotal), dot: "bg-line" },
                  ]
                : []
            }
            tip={storedV2 ? scoreTip(storedV2.fitTotal, FIT_MAX, storedV2.signalsTotal, SIGNALS_MAX) : null}
          />

          <section aria-labelledby="activity" className="card card-sheen space-y-4 p-5">
            <SectionTitle id="activity" tone="purple" icon={<IconHistory size={18} stroke={2} />}>
              Activity
            </SectionTitle>
            <form action={addNote} className="flex gap-2">
              <label className="sr-only" htmlFor="note-body">Add a note</label>
              <input id="note-body" name="body" placeholder="Add a note…" required className="field h-9 text-sm" />
              <button type="submit" className="btn h-9 shrink-0 px-3 text-sm">Log</button>
            </form>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet. Notes and what happens to this lead show here.</p>
            ) : (
              <Timeline items={timeline} />
            )}
          </section>
        </aside>
      </div>


      <section id="calls" className="mt-8 scroll-mt-6">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-xl font-semibold">Calls</h2>
          <p className="helper-text text-sm text-muted">
            Alongside the next follow-up date, not instead of it
          </p>
        </div>
        <CallLog calls={lead.calls} addAction={addCall} />
      </section>

      <section id="scorecard" className="mt-8 scroll-mt-6">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-xl font-semibold">ICP Scorecard</h2>
          <p className="helper-text max-w-xl text-right text-sm text-muted">
            Fit is judged first; signals only rank fits against each other
          </p>
        </div>
        <div className="space-y-4">
          <IcpScorecardV2
            // Keyed on what is stored, so a save re-seeds the card from the
            // saved breakdown rather than keeping the pre-save state.
            key={lead.icpBreakdownAt?.toISOString() ?? "unscored"}
            stored={storedV2}
            blank={blankV2}
            action={saveScorecard}
            suggest={activeIcp ? suggestScores : null}
            enriched={hasAssistEvidence(lead)}
            activeIcpName={activeIcp?.name ?? null}
          />
          {lead.icpScoredAt && (
            <OldModelScorecard
              answers={lead}
              notes={lead.icpNotes}
              inForce={storedV2 === null}
            />
          )}
        </div>
      </section>
    </div>
  );
}

// What is known about the address above it: what kind it is, whether
// it verified, where it came from and when, and every other address found.
// Nothing at all for a lead nobody has run it on and nobody typed into.
function EmailFacts({
  lead,
}: {
  lead: {
    email: string | null;
    emailType: string | null;
    emailStatus: string | null;
    emailSource: string | null;
    emailCheckedAt: Date | null;
    emailAlternates: string | null;
  };
}) {
  const source = effectiveEmailSource(lead);
  const type = readEmailType(lead.emailType);
  const status = readEmailStatus(lead.emailStatus);
  const alternates = parseAlternates(lead.emailAlternates);
  if (!source && !type && !lead.emailCheckedAt && alternates.length === 0) return null;
  const facts = [
    type ? EMAIL_TYPE_LABELS[type] : null,
    lead.email ? EMAIL_STATUS_LABELS[status ?? "unchecked"] : null,
    source ? EMAIL_SOURCE_LABELS[source] : null,
    lead.emailCheckedAt
      ? `checked ${lead.emailCheckedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
      : null,
  ].filter(Boolean);
  return (
    <div className="text-xs leading-relaxed text-muted">
      {facts.length > 0 && <p>Email: {facts.join(" · ")}</p>}
      {alternates.length > 0 && (
        <p className="break-words">
          Also found:{" "}
          {alternates
            .map(
              (a) =>
                `${a.address} (${EMAIL_STATUS_LABELS[a.status ?? "unchecked"].toLowerCase()}, ${EMAIL_SOURCE_LABELS[a.source].toLowerCase()})`,
            )
            .join(", ")}
        </p>
      )}
    </div>
  );
}

// One fact in the details summary. An empty one reads as a dash, so the grid
// keeps its shape and a missing value is visible as missing.
function SummaryItem({
  label,
  children,
  num = false,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  num?: boolean;
  wide?: boolean;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 text-sm text-ink ${num ? "num" : ""}`}>{empty ? <span className="text-muted">—</span> : children}</dd>
    </div>
  );
}

// The header's tint, from the tier's own colour into the card.
const HEADER_TINT: Record<string, string> = {
  A: "from-teal-soft/60",
  B: "from-accent-soft/60",
  C: "from-warn-soft/50",
};

// "Nov 2": a due date is a day, stored at UTC midnight.
function fmtDayMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// The tier as a tile beside the clinic's name: the letter on its own colour,
// a dash where nobody has scored it.
function TierTile({ tier }: { tier: string | null }) {
  const tone =
    tier === "A" ? "bg-teal-soft text-teal" : tier === "B" ? "bg-accent-soft text-accent" : tier ? "bg-warn-soft text-warn-on-soft" : "bg-line/70 text-muted";
  return (
    <div
      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold ${tone}`}
      title={tier ? `${tier}-tier` : "Not scored"}
    >
      {tier ?? "—"}
    </div>
  );
}
