import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  deleteCreative,
  duplicateCreative,
  setCreativeStatus,
  updateCreative,
} from "@/lib/actions/adhub";
import {
  AD_HEADLINE_GUIDANCE,
  AD_HEADLINE_MAX,
  AD_HEADLINE_MIN,
  AWARENESS_LEVEL_LABELS,
  AwarenessLevel,
  CONCEPT_HEADLINE_GUIDANCE,
  CREATIVE_STATUSES,
  CREATIVE_STATUS_LABELS,
  CREATIVE_TYPES,
  CREATIVE_TYPE_LABELS,
  ITERATE_NOTE,
  compliancePassed,
  isStatusBlocked,
  sophisticationMeta,
} from "@/lib/adhub";
import { CreativeStatusBadge, CreativeTypeChip } from "@/components/Badge";
import ComplianceChecklist from "@/components/ComplianceChecklist";
import ConfirmForm from "@/components/ConfirmForm";
import PerformanceLog from "@/components/PerformanceLog";

export const dynamic = "force-dynamic";

export default async function CreativeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const creative = await prisma.creative.findUnique({
    where: { id: params.id },
    include: {
      concept: { include: { persona: true } },
      compliance: { orderBy: { sortOrder: "asc" } },
      performance: { orderBy: { loggedOn: "desc" } },
      parent: { select: { id: true, creativeNumber: true, status: true } },
      variations: {
        orderBy: { creativeNumber: "asc" },
        select: { id: true, creativeNumber: true, status: true },
      },
    },
  });
  if (!creative) notFound();

  const { concept } = creative;
  const passed = compliancePassed(creative.compliance);
  const update = updateCreative.bind(null, creative.id);
  const setStatus = setCreativeStatus.bind(null, creative.id);
  const duplicate = duplicateCreative.bind(null, creative.id);
  const remove = deleteCreative.bind(null, creative.id);
  const stage = sophisticationMeta(concept.sophisticationStage);
  const headlineLength = creative.adHeadline.trim().length;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/ad-hub/concepts/${concept.id}`}
            className="text-sm text-accent hover:underline"
          >
            ← {concept.name}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="num text-[32px] font-bold tracking-[-0.02em]">
              Creative #{creative.creativeNumber}
            </h1>
            <CreativeTypeChip type={creative.creativeType} />
            <CreativeStatusBadge status={creative.status} />
          </div>
          <p className="mt-1.5 text-sm text-muted">
            {concept.persona.name} ·{" "}
            {AWARENESS_LEVEL_LABELS[
              concept.awarenessLevel as AwarenessLevel
            ] ?? concept.awarenessLevel}{" "}
            · {stage.label}
            {creative.parent && (
              <>
                {" · "}
                <Link
                  href={`/ad-hub/creatives/${creative.parent.id}`}
                  className="text-accent hover:underline"
                >
                  Variation of #{creative.parent.creativeNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <form action={duplicate}>
            <button
              type="submit"
              title={ITERATE_NOTE}
              className="btn"
            >
              Duplicate as variation
            </button>
          </form>
          <ConfirmForm
            action={remove}
            message={`Delete creative #${creative.creativeNumber}? Its compliance checks and performance history go with it; any variations of it stay.`}
            className="btn-danger"
          >
            Delete
          </ConfirmForm>
        </div>
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-5">
        {/* ─── The copy ────────────────────────────────────────────────── */}
        <section className="lg:col-span-3">
          <h2 className="mb-4 text-xl font-semibold">The creative</h2>
          <form action={update} className="card space-y-5 p-6">
            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              <div className="col-span-2">
                <label className="field-label" htmlFor="creativeType">
                  Creative type
                </label>
                <select
                  id="creativeType"
                  name="creativeType"
                  defaultValue={creative.creativeType}
                  className="field"
                >
                  {CREATIVE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CREATIVE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="creativeNumber">
                  Number
                </label>
                <input
                  id="creativeNumber"
                  name="creativeNumber"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={creative.creativeNumber}
                  className="field num"
                />
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="conceptHeadline">
                Concept headline (hook)
              </label>
              <textarea
                id="conceptHeadline"
                name="conceptHeadline"
                rows={2}
                defaultValue={creative.conceptHeadline}
                className="field"
              />
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {CONCEPT_HEADLINE_GUIDANCE}
              </p>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-4">
                <label className="field-label mb-0" htmlFor="adHeadline">
                  Ad headline
                </label>
                <span
                  className={`num shrink-0 text-xs ${
                    headlineLength === 0
                      ? "text-muted"
                      : headlineLength >= AD_HEADLINE_MIN &&
                          headlineLength <= AD_HEADLINE_MAX
                        ? "text-ok"
                        : "text-warn"
                  }`}
                >
                  {headlineLength} / {AD_HEADLINE_MIN}–{AD_HEADLINE_MAX}
                </span>
              </div>
              <input
                id="adHeadline"
                name="adHeadline"
                defaultValue={creative.adHeadline}
                className="field mt-2"
              />
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {AD_HEADLINE_GUIDANCE}
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="adCopy">
                Ad copy body
              </label>
              <textarea
                id="adCopy"
                name="adCopy"
                rows={12}
                defaultValue={creative.adCopy}
                className="field"
              />
            </div>

            <div>
              <label className="field-label" htmlFor="cta">
                CTA
              </label>
              <input
                id="cta"
                name="cta"
                defaultValue={creative.cta}
                className="field"
              />
            </div>

            <div className="flex justify-end border-t border-line/60 pt-5">
              <button type="submit" className="btn-primary">
                Save changes
              </button>
            </div>
          </form>
        </section>

        {/* ─── Status, gate, lineage ───────────────────────────────────── */}
        <section className="space-y-8 lg:col-span-2">
          <div>
            <h2 className="mb-4 text-xl font-semibold">Status</h2>
            <form action={setStatus} className="card space-y-4 p-6">
              <div>
                <label className="field-label" htmlFor="status">
                  Creative status
                </label>
                {/* Keyed on the stored status so the control remounts when
                    something else moves it — unchecking a compliance item
                    drops a Ready creative back to review, and the dropdown has
                    to say so rather than keep showing what was last picked. */}
                <select
                  key={creative.status}
                  id="status"
                  name="status"
                  defaultValue={creative.status}
                  className="field"
                >
                  {CREATIVE_STATUSES.map((s) => {
                    const blocked = isStatusBlocked(s, creative.compliance);
                    return (
                      <option key={s} value={s} disabled={blocked}>
                        {CREATIVE_STATUS_LABELS[s]}
                        {blocked ? " — blocked by compliance" : ""}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {passed
                    ? "Compliance is clear, so Ready is available."
                    : "Ready is unavailable until every compliance item below is checked. Unchecking one later drops a Ready creative back to compliance review."}
                </p>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn">
                  Set status
                </button>
              </div>
            </form>
          </div>

          <div>
            <h2 className="mb-4 text-xl font-semibold">Compliance gate</h2>
            <ComplianceChecklist items={creative.compliance} />
          </div>

          <div>
            <h2 className="mb-4 text-xl font-semibold">Iteration</h2>
            <div className="card p-6">
              <p className="text-xs leading-relaxed text-muted">
                {ITERATE_NOTE}
              </p>
              <div className="mt-4 space-y-2">
                {creative.parent && (
                  <LineageRow
                    href={`/ad-hub/creatives/${creative.parent.id}`}
                    label={`Duplicated from #${creative.parent.creativeNumber}`}
                    status={creative.parent.status}
                  />
                )}
                {creative.variations.map((v) => (
                  <LineageRow
                    key={v.id}
                    href={`/ad-hub/creatives/${v.id}`}
                    label={`Variation #${v.creativeNumber}`}
                    status={v.status}
                  />
                ))}
                {!creative.parent && creative.variations.length === 0 && (
                  <p className="text-sm text-muted">
                    No lineage yet — this creative has not been duplicated and
                    did not come from another.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">Performance</h2>
        <div className="card p-6">
          <PerformanceLog
            creativeId={creative.id}
            logs={creative.performance}
          />
        </div>
      </section>
    </div>
  );
}

function LineageRow({
  href,
  label,
  status,
}: {
  href: string;
  label: string;
  status: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3.5 py-2.5 hover:bg-wash/70"
    >
      <span className="min-w-0 truncate text-sm font-medium">{label}</span>
      <CreativeStatusBadge status={status} />
    </Link>
  );
}
