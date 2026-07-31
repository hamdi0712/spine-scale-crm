import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  addLeadNote,
  convertLeadToClient,
  deleteLead,
  updateLead,
} from "@/lib/actions/leads";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import { fmtDateTime, toDateInput } from "@/lib/format";
import { StageBadge } from "@/components/Badge";
import ConfirmForm from "@/components/ConfirmForm";

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
      client: true,
    },
  });
  if (!lead) notFound();

  const update = updateLead.bind(null, lead.id);
  const addNote = addLeadNote.bind(null, lead.id);
  const convert = convertLeadToClient.bind(null, lead.id);
  const remove = deleteLead.bind(null, lead.id);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <Link href="/pipeline" className="text-sm text-accent hover:underline">
            ← Pipeline
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">{lead.clinicName}</h1>
            <StageBadge stage={lead.stage} />
            {lead.archived && (
              <span className="rounded-full bg-line/70 px-2 py-0.5 text-[11px] font-medium text-muted">
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

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Details</h2>
          <form action={update} className="card space-y-4 p-5">
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
            <div className="grid grid-cols-2 gap-4">
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
                  defaultValue={toDateInput(lead.nextFollowUp)}
                  className="field font-mono"
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
            <div className="flex justify-end border-t border-line pt-4">
              <button type="submit" className="btn-primary">
                Save changes
              </button>
            </div>
          </form>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Activity log</h2>
          <form action={addNote} className="card flex gap-2 p-3">
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
          <div className="card mt-px">
            {lead.notes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                No activity yet. Notes are append-only and timestamped.
              </p>
            ) : (
              <ul>
                {lead.notes.map((note) => (
                  <li key={note.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                    <div className="font-mono text-[11px] text-muted">
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
    </div>
  );
}
