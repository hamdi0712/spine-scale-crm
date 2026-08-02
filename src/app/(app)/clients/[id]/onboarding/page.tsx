import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  finishOnboarding,
  navigateOnboarding,
  saveOnboardingContract,
  saveOnboardingDetails,
  saveOnboardingKickoff,
  skipOnboarding,
} from "@/lib/actions/onboarding";
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  ContractStatus,
  clampStep,
  contractDraft,
  invoiceDraft,
  invoiceTotals,
  isOnboarding,
  stepMeta,
} from "@/lib/onboarding";
import { US_TIME_ZONES, zoneLabel } from "@/lib/timezones";
import { fmtMoney } from "@/lib/format";
import { KickoffTime, LocalTimeBadge } from "@/components/Clock";
import DraftEmailPanel from "@/components/DraftEmailPanel";
import InvoiceLog from "@/components/InvoiceLog";
import KickoffPicker from "@/components/KickoffPicker";
import OnboardingProgress from "@/components/OnboardingProgress";

export const dynamic = "force-dynamic";

type WizardClient = NonNullable<
  Awaited<ReturnType<typeof loadClient>>
>;

function loadClient(id: string) {
  return prisma.client.findUnique({
    where: { id },
    include: { invoices: { orderBy: { issuedOn: "desc" } } },
  });
}

export default async function OnboardingPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await loadClient(params.id);
  if (!client) notFound();
  // The wizard is only a place to be while it is running. Skipped, finished,
  // or never started all land on the normal client page.
  if (!isOnboarding(client.onboardingStep)) redirect(`/clients/${client.id}`);

  const step = clampStep(client.onboardingStep);
  const meta = stepMeta(step);
  const skip = skipOnboarding.bind(null, client.id);

  return (
    <div className="max-w-3xl">
      <Link
        href={`/clients/${client.id}`}
        className="text-sm text-accent hover:underline"
      >
        ← Client record
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="display text-[32px] font-semibold">
              {client.clinicName}
            </h1>
            <LocalTimeBadge timeZone={client.timeZone} />
          </div>
          <p className="mt-1.5 text-sm text-muted">Client onboarding</p>
        </div>
        <form action={skip} className="shrink-0">
          <button type="submit" className="btn">
            Skip onboarding wizard
          </button>
        </form>
      </div>

      <div className="mt-8">
        <OnboardingProgress current={step} />
      </div>

      <div className="card mt-6">
        <div className="border-b border-line/60 px-6 py-4">
          <h2 className="text-sm font-medium">
            <span className="num">{step}.</span> {meta.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {meta.blurb}
          </p>
        </div>
        {step === 1 && <StepDetails client={client} />}
        {step === 2 && <StepContract client={client} />}
        {step === 3 && <StepInvoice client={client} />}
        {step === 4 && <StepKickoff client={client} />}
        {step === 5 && <StepHandoff client={client} />}
      </div>
    </div>
  );
}

// Shared footer. Both buttons submit the step's own form, so moving back keeps
// whatever was typed rather than throwing it away.
function StepFooter({
  back,
  nextLabel = "Save & continue",
}: {
  back: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/60 px-6 py-4">
      {back ? (
        <button type="submit" name="direction" value="back" className="btn">
          ← Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="submit"
        name="direction"
        value="next"
        className="btn-primary"
      >
        {nextLabel}
      </button>
    </div>
  );
}

// ─── Step 1 — confirm details ──────────────────────────────────────────────

function StepDetails({ client }: { client: WizardClient }) {
  const save = saveOnboardingDetails.bind(null, client.id);
  return (
    <form action={save}>
      <div className="space-y-5 p-6">
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
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Pre-filled from the lead where there was something to carry over. The
          time zone drives the local-time badges and the kickoff-call
          comparison in step 4.
        </p>
      </div>
      <StepFooter back={false} />
    </form>
  );
}

// ─── Step 2 — contract ─────────────────────────────────────────────────────

function StepContract({ client }: { client: WizardClient }) {
  const save = saveOnboardingContract.bind(null, client.id);
  const draft = contractDraft(client);
  return (
    <form action={save}>
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
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
          <div>
            <label className="field-label" htmlFor="contractRef">
              Signed document (link or ref)
            </label>
            <input
              id="contractRef"
              name="contractRef"
              defaultValue={client.contractRef ?? ""}
              placeholder="Drive link, e-sign URL, or where to find it"
              className="field text-xs"
            />
          </div>
        </div>
        <DraftEmailPanel
          label="Draft contract email"
          to={client.email}
          subject={draft.subject}
          body={draft.body}
        />
      </div>
      <StepFooter back />
    </form>
  );
}

// ─── Step 3 — invoices ─────────────────────────────────────────────────────

function StepInvoice({ client }: { client: WizardClient }) {
  const navigate = navigateOnboarding.bind(null, client.id, 3);
  const draft = invoiceDraft(client, client.monthlyFee);

  return (
    <>
      <div className="space-y-5 p-6">
        <InvoiceLog
          clientId={client.id}
          invoices={client.invoices}
          defaultAmount={client.monthlyFee}
        />
        <DraftEmailPanel
          label="Draft invoice email"
          to={client.email}
          subject={draft.subject}
          body={draft.body}
        />
      </div>
      {/* Its own form: the invoice log already contains forms of its own, and
          forms cannot nest. */}
      <form action={navigate}>
        <StepFooter back nextLabel="Continue" />
      </form>
    </>
  );
}

// ─── Step 4 — kickoff call ─────────────────────────────────────────────────

function StepKickoff({ client }: { client: WizardClient }) {
  const save = saveOnboardingKickoff.bind(null, client.id);
  return (
    <form action={save}>
      <div className="p-6">
        <KickoffPicker
          clinicName={client.clinicName}
          timeZone={client.timeZone}
          kickoffAt={client.kickoffAt ? client.kickoffAt.toISOString() : null}
        />
      </div>
      <StepFooter back />
    </form>
  );
}

// ─── Step 5 — handoff ──────────────────────────────────────────────────────

function StepHandoff({ client }: { client: WizardClient }) {
  const navigate = navigateOnboarding.bind(null, client.id, 5);
  const finish = finishOnboarding.bind(null, client.id);
  const totals = invoiceTotals(client.invoices);

  const rows: { label: string; value: React.ReactNode; done: boolean }[] = [
    {
      label: "Details confirmed",
      value: `${client.packageName ?? "No package set"} · ${fmtMoney(client.monthlyFee)} · ${zoneLabel(client.timeZone)}`,
      done: client.packageName != null && client.monthlyFee != null,
    },
    {
      label: "Contract",
      value:
        CONTRACT_STATUS_LABELS[client.contractStatus as ContractStatus] ??
        client.contractStatus,
      done: client.contractStatus === "SIGNED",
    },
    {
      label: "Invoices",
      value: `${client.invoices.length} logged · ${fmtMoney(totals.collected)} collected`,
      done: totals.collected > 0,
    },
    {
      label: "Kickoff call",
      value: client.kickoffAt ? (
        <KickoffTime
          at={client.kickoffAt.toISOString()}
          timeZone={client.timeZone}
        />
      ) : (
        "Not scheduled"
      ),
      done: client.kickoffAt != null,
    },
  ];

  return (
    <>
      <div className="space-y-5 p-6">
        <ul className="overflow-hidden rounded-[10px] border border-line">
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-center gap-3 border-b border-line/60 px-4 py-3 last:border-b-0"
            >
              <span
                className={`text-xs ${row.done ? "text-ok" : "text-muted/60"}`}
                aria-hidden
              >
                {row.done ? "●" : "○"}
              </span>
              <span className="w-36 shrink-0 text-sm font-medium">
                {row.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted">
                {row.value}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-muted">
          Anything still open is fine to finish later — nothing above blocks the
          handoff. Finishing closes the wizard and drops you on the client
          record, where the delivery checklist takes over.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line/60 px-6 py-4">
        <form action={navigate}>
          <button type="submit" name="direction" value="back" className="btn">
            ← Back
          </button>
        </form>
        <form action={finish}>
          <button type="submit" className="btn-primary">
            Finish onboarding →
          </button>
        </form>
      </div>
    </>
  );
}
