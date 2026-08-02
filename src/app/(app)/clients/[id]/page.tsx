import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  addChecklistItem,
  deleteChecklistItem,
  deleteClient,
  renameChecklistItem,
  setChecklistItemNotes,
  setChecklistItemStatus,
  toggleChecklistItemBlocking,
  updateClient,
} from "@/lib/actions/clients";
import { addClientCall } from "@/lib/actions/calls";
import { startOnboarding } from "@/lib/actions/onboarding";
import {
  CHECKLIST_STATUSES,
  CHECKLIST_STATUS_LABELS,
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  HIPAA_CHECKLIST_ITEM,
  PHI_APPROACHES,
  PHI_APPROACH_LABELS,
  clientDeleteMessage,
} from "@/lib/constants";
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  ONBOARDING_TOTAL_STEPS,
  isOnboarding,
} from "@/lib/onboarding";
import {
  HEALTH_OVERRIDE_AT_RISK,
  HEALTH_WINDOW_WEEKS,
  computeHealth,
  isHealthScored,
} from "@/lib/health";
import { US_TIME_ZONES } from "@/lib/timezones";
import { fmtDate, toDateInput } from "@/lib/format";
import { ClientStatusBadge, HealthBadge, TrendArrow } from "@/components/Badge";
import CallLog from "@/components/CallLog";
import CapsuleBar from "@/components/CapsuleBar";
import { KickoffTime, LocalTimeBadge } from "@/components/Clock";
import ConfirmForm from "@/components/ConfirmForm";
import Icon from "@/components/Icons";
import InvoiceLog from "@/components/InvoiceLog";

export const dynamic = "force-dynamic";

const STATUS_GLYPH: Record<string, string> = {
  NOT_STARTED: "○",
  IN_PROGRESS: "◐",
  DONE: "●",
};

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      checklist: { orderBy: { sortOrder: "asc" } },
      invoices: { orderBy: { issuedOn: "desc" } },
      calls: { orderBy: { scheduledAt: "asc" } },
      reports: { orderBy: { weekStart: "desc" }, take: HEALTH_WINDOW_WEEKS },
      lead: true,
    },
  });
  if (!client) notFound();

  const health = isHealthScored(client.status)
    ? computeHealth(client, client.reports)
    : null;

  const update = updateClient.bind(null, client.id);
  const addItem = addChecklistItem.bind(null, client.id);
  const addCall = addClientCall.bind(null, client.id);
  const remove = deleteClient.bind(null, client.id);
  const startWizard = startOnboarding.bind(null, client.id);
  const wizardRunning = isOnboarding(client.onboardingStep);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <Link href="/clients" className="text-sm text-accent hover:underline">
            ← Clients
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="display text-[32px] font-semibold">
              {client.clinicName}
            </h1>
            <ClientStatusBadge status={client.status} />
            {health && (
              <span className="flex items-center gap-1.5">
                <HealthBadge status={health.status} reason={health.reason} />
                <TrendArrow trend={health.trend} />
              </span>
            )}
            <LocalTimeBadge timeZone={client.timeZone} />
          </div>
          {health && (
            <p className="mt-1.5 text-sm text-muted">{health.reason}</p>
          )}
          {client.kickoffAt && (
            <p className="mt-1.5 text-sm text-muted">
              Kickoff call —{" "}
              <KickoffTime
                at={client.kickoffAt.toISOString()}
                timeZone={client.timeZone}
              />
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/reporting/${client.id}`} className="btn">
            Weekly reporting →
          </Link>
          {client.lead && (
            <Link href={`/pipeline/${client.lead.id}`} className="btn">
              Original lead
            </Link>
          )}
          <ConfirmForm
            action={remove}
            message={clientDeleteMessage(client.clinicName)}
            className="btn-danger"
          >
            Delete
          </ConfirmForm>
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="display text-xl font-semibold">Delivery progress</h2>
          {wizardRunning ? (
            <Link
              href={`/clients/${client.id}/onboarding`}
              className="btn-primary h-[34px] shrink-0 px-3.5 text-xs"
            >
              Resume onboarding · step {client.onboardingStep} of{" "}
              {ONBOARDING_TOTAL_STEPS}
            </Link>
          ) : (
            <form action={startWizard} className="shrink-0">
              <button type="submit" className="btn h-[34px] px-3.5 text-xs">
                Onboarding wizard
              </button>
            </form>
          )}
        </div>
        <div className="card p-6">
          <CapsuleBar
            size="lg"
            items={client.checklist.map((i) => ({
              title: i.title,
              status: i.status,
            }))}
          />
        </div>
      </section>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <h2 className="display mb-4 text-xl font-semibold">Client details</h2>
          <form action={update} className="card space-y-5 p-6">
            <div>
              <label className="field-label" htmlFor="clinicName">
                Clinic name
              </label>
              <input
                id="clinicName"
                name="clinicName"
                defaultValue={client.clinicName}
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
                  defaultValue={client.contactName ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="status">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={client.status}
                  className="field"
                >
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
                <input
                  id="phone"
                  name="phone"
                  defaultValue={client.phone ?? ""}
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
                  defaultValue={client.email ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="packageName">
                  Package / plan
                </label>
                <input
                  id="packageName"
                  name="packageName"
                  defaultValue={client.packageName ?? ""}
                  className="field"
                />
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
                  defaultValue={client.monthlyFee ?? ""}
                  className="field num"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="timeZone">
                  Time zone
                </label>
                <select
                  id="timeZone"
                  name="timeZone"
                  defaultValue={client.timeZone}
                  className="field"
                >
                  {US_TIME_ZONES.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="contractStatus">
                  Contract status
                </label>
                <select
                  id="contractStatus"
                  name="contractStatus"
                  defaultValue={client.contractStatus}
                  className="field"
                >
                  {CONTRACT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {CONTRACT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="field-label" htmlFor="phiApproach">
                  PHI / HIPAA approach
                </label>
                <select
                  id="phiApproach"
                  name="phiApproach"
                  defaultValue={client.phiApproach}
                  className="field"
                >
                  {PHI_APPROACHES.map((p) => (
                    <option key={p} value={p}>
                      {PHI_APPROACH_LABELS[p]}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-muted">
                  Path A keeps every form and automation symptom-agnostic, so no
                  patient health information is ever collected. Switching to Path
                  B adds &ldquo;{HIPAA_CHECKLIST_ITEM}&rdquo; to the checklist
                  below as a launch-blocking item.
                </p>
              </div>
              <div className="col-span-2">
                <label className="field-label" htmlFor="healthOverride">
                  Health override
                </label>
                <select
                  id="healthOverride"
                  name="healthOverride"
                  defaultValue={client.healthOverride ?? ""}
                  className="field"
                >
                  <option value="">Auto — read from the weekly reports</option>
                  <option value={HEALTH_OVERRIDE_AT_RISK}>
                    Force At risk — operational break
                  </option>
                </select>
                <p className="mt-2 text-xs text-muted">
                  For when something is broken that the numbers have not caught
                  up with — ad account down, tracking dead, access revoked.
                  While it is set, health reads At risk whatever the metrics
                  say.
                </p>
              </div>
              <div className="col-span-2">
                <label className="field-label" htmlFor="contractStart">
                  Contract start
                </label>
                <input
                  id="contractStart"
                  name="contractStart"
                  type="date"
                  defaultValue={toDateInput(client.contractStart)}
                  className="field num"
                />
              </div>
              <div className="col-span-2">
                <label className="field-label" htmlFor="contractRef">
                  Signed contract (link or ref)
                </label>
                <input
                  id="contractRef"
                  name="contractRef"
                  defaultValue={client.contractRef ?? ""}
                  className="field text-xs"
                />
              </div>
              <div className="col-span-2">
                <label className="field-label" htmlFor="ghlRef">
                  GHL sub-account (link or ref)
                </label>
                <input
                  id="ghlRef"
                  name="ghlRef"
                  defaultValue={client.ghlRef ?? ""}
                  className="field text-xs"
                />
              </div>
              <div className="col-span-2">
                <label className="field-label" htmlFor="metaRef">
                  Meta Ads account (link or ref)
                </label>
                <input
                  id="metaRef"
                  name="metaRef"
                  defaultValue={client.metaRef ?? ""}
                  className="field text-xs"
                />
              </div>
              <div className="col-span-2">
                <label className="field-label" htmlFor="notes">
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={4}
                  defaultValue={client.notes ?? ""}
                  className="field"
                />
              </div>
            </div>
            <div className="flex justify-end border-t border-line/60 pt-5">
              <button type="submit" className="btn-primary">
                Save changes
              </button>
            </div>
          </form>
        </section>

        <section className="lg:col-span-3">
          <h2 className="display mb-4 text-xl font-semibold">
            Onboarding / delivery checklist
          </h2>
          <div className="card">
            <ul>
              {client.checklist.map((item) => {
                const rename = renameChecklistItem.bind(null, item.id);
                const setNotes = setChecklistItemNotes.bind(null, item.id);
                const remove = deleteChecklistItem.bind(null, item.id);
                const toggleBlocking = toggleChecklistItemBlocking.bind(
                  null,
                  item.id,
                );
                return (
                  <li
                    key={item.id}
                    className="min-h-[56px] border-b border-line/60 px-4 py-3 last:border-b-0 hover:bg-wash/60"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex shrink-0 overflow-hidden rounded-full border border-line">
                        {CHECKLIST_STATUSES.map((s) => {
                          const setStatus = setChecklistItemStatus.bind(
                            null,
                            item.id,
                            s
                          );
                          const active = item.status === s;
                          return (
                            <form action={setStatus} key={s}>
                              <button
                                type="submit"
                                title={CHECKLIST_STATUS_LABELS[s]}
                                className={`flex h-7 w-8 items-center justify-center text-xs ${
                                  active
                                    ? s === "DONE"
                                      ? "bg-ok-soft text-ok"
                                      : s === "IN_PROGRESS"
                                        ? "bg-warn-soft text-warn"
                                        : "bg-line/70 text-ink"
                                    : "text-muted/70 hover:bg-wash/70 hover:text-ink"
                                }`}
                              >
                                {STATUS_GLYPH[s]}
                              </button>
                            </form>
                          );
                        })}
                      </div>
                      <form action={rename} className="min-w-0 flex-1">
                        <input
                          name="title"
                          defaultValue={item.title}
                          required
                          title="Rename and press Enter"
                          className={`w-full border-b border-transparent bg-transparent text-sm focus:border-accent focus:outline-none ${
                            item.status === "DONE" ? "text-muted" : ""
                          }`}
                        />
                      </form>
                      {item.completedAt && (
                        <span className="num shrink-0 text-xs text-muted">
                          {fmtDate(item.completedAt)}
                        </span>
                      )}
                      {/* Blocking items are what the dashboard lifts to the
                          top of Today's focus while a client is onboarding. */}
                      <form action={toggleBlocking} className="shrink-0">
                        <button
                          type="submit"
                          title={
                            item.blocking
                              ? "Blocks going live — click to unflag"
                              : "Does not block going live — click to flag"
                          }
                          className={`flex h-6 w-6 items-center justify-center rounded-[7px] ${
                            item.blocking
                              ? "bg-warn-soft text-warn"
                              : "text-muted/40 hover:bg-wash hover:text-muted"
                          }`}
                        >
                          <Icon name="flag" className="h-3.5 w-3.5" />
                          <span className="sr-only">
                            {item.blocking ? "Blocking" : "Not blocking"}
                          </span>
                        </button>
                      </form>
                      <ConfirmForm
                        action={remove}
                        message={`Remove "${item.title}" from this checklist?`}
                        className="shrink-0 px-1 text-muted hover:text-bad"
                      >
                        ×
                      </ConfirmForm>
                    </div>
                    <form action={setNotes} className="mt-1 pl-[110px]">
                      <input
                        name="notes"
                        defaultValue={item.notes ?? ""}
                        placeholder="Notes — press Enter to save"
                        className="w-full border-b border-transparent bg-transparent text-xs text-muted placeholder:text-muted/50 focus:border-accent focus:outline-none"
                      />
                    </form>
                  </li>
                );
              })}
            </ul>
            <form
              action={addItem}
              className="flex gap-3 border-t border-line/60 p-4"
            >
              <input
                name="title"
                placeholder="Add checklist item…"
                required
                className="field"
              />
              <button type="submit" className="btn shrink-0">
                Add
              </button>
            </form>
          </div>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="display mb-4 text-xl font-semibold">Calls</h2>
        <CallLog calls={client.calls} addAction={addCall} />
      </section>

      <section className="mt-8">
        <h2 className="display mb-4 text-xl font-semibold">Invoices</h2>
        <div className="card p-6">
          <InvoiceLog
            clientId={client.id}
            invoices={client.invoices}
            defaultAmount={client.monthlyFee}
          />
        </div>
      </section>
    </div>
  );
}
