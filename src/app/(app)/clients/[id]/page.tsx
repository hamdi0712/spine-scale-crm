import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  addChecklistItem,
  deleteChecklistItem,
  renameChecklistItem,
  setChecklistItemNotes,
  setChecklistItemStatus,
  updateClient,
} from "@/lib/actions/clients";
import {
  CHECKLIST_STATUSES,
  CHECKLIST_STATUS_LABELS,
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
} from "@/lib/constants";
import { fmtDate, toDateInput } from "@/lib/format";
import { ClientStatusBadge } from "@/components/Badge";
import CapsuleBar from "@/components/CapsuleBar";
import ConfirmForm from "@/components/ConfirmForm";

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
    include: { checklist: { orderBy: { sortOrder: "asc" } }, lead: true },
  });
  if (!client) notFound();

  const update = updateClient.bind(null, client.id);
  const addItem = addChecklistItem.bind(null, client.id);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <Link href="/clients" className="text-sm text-accent hover:underline">
            ← Clients
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-[32px] font-bold tracking-[-0.02em]">
              {client.clinicName}
            </h1>
            <ClientStatusBadge status={client.status} />
          </div>
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
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Delivery progress</h2>
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
          <h2 className="mb-4 text-xl font-semibold">Client details</h2>
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
          <h2 className="mb-4 text-xl font-semibold">
            Onboarding / delivery checklist
          </h2>
          <div className="card">
            <ul>
              {client.checklist.map((item) => {
                const rename = renameChecklistItem.bind(null, item.id);
                const setNotes = setChecklistItemNotes.bind(null, item.id);
                const remove = deleteChecklistItem.bind(null, item.id);
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
    </div>
  );
}
