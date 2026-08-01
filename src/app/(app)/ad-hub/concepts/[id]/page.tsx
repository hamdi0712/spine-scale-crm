import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { deleteConcept, updateConcept } from "@/lib/actions/adhub";
import {
  AWARENESS_LEVELS,
  AWARENESS_LEVEL_GUIDANCE,
  AWARENESS_LEVEL_LABELS,
  AwarenessLevel,
  CONCEPT_STATUSES,
  CONCEPT_STATUS_LABELS,
  ITERATE_NOTE,
  SOPHISTICATION_STAGE_META,
  countLabel,
  sophisticationMeta,
} from "@/lib/adhub";
import {
  ConceptStatusBadge,
  CreativeStatusBadge,
  CreativeTypeChip,
} from "@/components/Badge";
import ConfirmForm from "@/components/ConfirmForm";

export const dynamic = "force-dynamic";

export default async function ConceptDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const concept = await prisma.concept.findUnique({
    where: { id: params.id },
    include: {
      persona: true,
      desire: true,
      benefit: { include: { desire: true } },
      creatives: {
        orderBy: { creativeNumber: "asc" },
        include: { compliance: { select: { checked: true } } },
      },
    },
  });
  if (!concept) notFound();

  const [personas, desires, benefits] = await Promise.all([
    prisma.persona.findMany({ orderBy: { name: "asc" } }),
    prisma.desire.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.benefit.findMany({
      orderBy: { createdAt: "asc" },
      include: { desire: true },
    }),
  ]);

  const update = updateConcept.bind(null, concept.id);
  const remove = deleteConcept.bind(null, concept.id);
  const stage = sophisticationMeta(concept.sophisticationStage);
  const awareness =
    AWARENESS_LEVEL_LABELS[concept.awarenessLevel as AwarenessLevel] ??
    concept.awarenessLevel;

  // The benefit is meant to answer the concept's desire. Nothing stops them
  // being re-pointed independently, so say so rather than quietly showing a
  // benefit that belongs to a different want.
  const mismatched = concept.benefit.desireId !== concept.desireId;

  // Benefits are grouped under the desire they answer, so a re-pairing is a
  // deliberate choice rather than an accident of a flat list.
  const benefitsByDesire = desires.map((d) => ({
    desire: d,
    options: benefits.filter((b) => b.desireId === d.id),
  }));

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/ad-hub" className="text-sm text-accent hover:underline">
            ← Ad Hub
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-[32px] font-bold tracking-[-0.02em]">
              {concept.name}
            </h1>
            <ConceptStatusBadge status={concept.status} />
            <span className="num text-sm text-muted">
              Batch {concept.batchNumber}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            For{" "}
            <Link
              href={`/ad-hub/personas/${concept.persona.id}`}
              className="text-accent hover:underline"
            >
              {concept.persona.name}
            </Link>{" "}
            · {awareness} · {stage.label}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/ad-hub/concepts/${concept.id}/creatives/new`}
            className="btn-primary"
          >
            New creative
          </Link>
          <ConfirmForm
            action={remove}
            message={`Delete "${concept.name}"? Its ${countLabel(concept.creatives.length, "creative")} and their compliance checks and performance history go with it.`}
            className="btn-danger"
          >
            Delete
          </ConfirmForm>
        </div>
      </div>

      {/* ─── The four things a creative is judged against ─────────────── */}
      <section className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">The concept</h2>
        <div className="card divide-y divide-line/60">
          <Row
            label="Persona"
            href={`/ad-hub/personas/${concept.persona.id}`}
            value={concept.persona.name}
            detail={concept.persona.demographics}
          />
          <Row
            label="Desire"
            href="/ad-hub/desires"
            value={concept.desire.statement}
            detail={concept.desire.notes}
          />
          <Row
            label="Benefit"
            href="/ad-hub/desires"
            value={`${concept.benefit.productName} — ${concept.benefit.feature}`}
            detail={`So you can ${concept.benefit.benefit}`}
            warning={
              mismatched
                ? `This benefit answers a different desire — “${concept.benefit.desire.statement}”.`
                : undefined
            }
          />
        </div>
      </section>

      {/* ─── Positioning, with the guidance that goes with each choice ── */}
      <section className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">Positioning</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <p className="text-xs font-medium tracking-[0.02em] text-muted">
              Awareness level
            </p>
            <p className="mt-1 text-base font-semibold">{awareness}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {AWARENESS_LEVEL_GUIDANCE[
                concept.awarenessLevel as AwarenessLevel
              ] ?? "—"}
            </p>
          </div>
          <div className="card p-6">
            <p className="text-xs font-medium tracking-[0.02em] text-muted">
              Market sophistication
            </p>
            <p className="mt-1 text-base font-semibold">{stage.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {stage.guidance}
            </p>
          </div>
        </div>
      </section>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-5">
        {/* ─── Edit ────────────────────────────────────────────────────── */}
        <section className="lg:col-span-2">
          <h2 className="mb-4 text-xl font-semibold">Concept details</h2>
          <form action={update} className="card space-y-5 p-6">
            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              <div className="col-span-2">
                <label className="field-label" htmlFor="name">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  defaultValue={concept.name}
                  required
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="batchNumber">
                  Batch
                </label>
                <input
                  id="batchNumber"
                  name="batchNumber"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={concept.batchNumber}
                  className="field num"
                />
              </div>
              <div className="col-span-3">
                <label className="field-label" htmlFor="status">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={concept.status}
                  className="field"
                >
                  {CONCEPT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {CONCEPT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {ITERATE_NOTE}
                </p>
              </div>
              <div className="col-span-3">
                <label className="field-label" htmlFor="personaId">
                  Persona
                </label>
                <select
                  id="personaId"
                  name="personaId"
                  defaultValue={concept.personaId}
                  className="field"
                >
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label className="field-label" htmlFor="desireId">
                  Desire
                </label>
                <select
                  id="desireId"
                  name="desireId"
                  defaultValue={concept.desireId}
                  className="field"
                >
                  {desires.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.statement}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label className="field-label" htmlFor="benefitId">
                  Benefit
                </label>
                <select
                  id="benefitId"
                  name="benefitId"
                  defaultValue={concept.benefitId}
                  className="field"
                >
                  {benefitsByDesire.map((group) =>
                    group.options.length === 0 ? null : (
                      <optgroup
                        key={group.desire.id}
                        label={group.desire.statement}
                      >
                        {group.options.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.productName} — {b.feature}
                          </option>
                        ))}
                      </optgroup>
                    ),
                  )}
                </select>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Grouped by the desire each one answers. Keep it under the
                  desire above unless you mean to change what this concept
                  sells.
                </p>
              </div>
              <div className="col-span-3">
                <label className="field-label" htmlFor="awarenessLevel">
                  Awareness level
                </label>
                <select
                  id="awarenessLevel"
                  name="awarenessLevel"
                  defaultValue={concept.awarenessLevel}
                  className="field"
                >
                  {AWARENESS_LEVELS.map((a) => (
                    <option key={a} value={a}>
                      {AWARENESS_LEVEL_LABELS[a]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label className="field-label" htmlFor="sophisticationStage">
                  Market sophistication stage
                </label>
                <select
                  id="sophisticationStage"
                  name="sophisticationStage"
                  defaultValue={concept.sophisticationStage}
                  className="field"
                >
                  {SOPHISTICATION_STAGE_META.map((s) => (
                    <option key={s.stage} value={s.stage}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label className="field-label" htmlFor="notes">
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={4}
                  defaultValue={concept.notes ?? ""}
                  placeholder="Why this concept, what it is testing, what would prove it wrong"
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

        {/* ─── Creatives ───────────────────────────────────────────────── */}
        <section className="lg:col-span-3">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">
              Creatives{" "}
              <span className="num text-sm font-normal text-muted">
                {concept.creatives.length}
              </span>
            </h2>
            <Link
              href={`/ad-hub/concepts/${concept.id}/creatives/new`}
              className="btn h-[34px] px-3.5 text-xs"
            >
              New creative
            </Link>
          </div>
          <div className="card">
            {concept.creatives.length === 0 ? (
              <p className="p-6 text-sm text-muted">
                No creatives yet. The wizard walks type → hook and headline → ad
                copy → CTA, and drops the result here as a Draft.
              </p>
            ) : (
              <ul>
                {concept.creatives.map((creative) => {
                  const checked = creative.compliance.filter(
                    (c) => c.checked,
                  ).length;
                  return (
                    <li
                      key={creative.id}
                      className="border-b border-line/60 last:border-b-0 hover:bg-wash/60"
                    >
                      <Link
                        href={`/ad-hub/creatives/${creative.id}`}
                        className="flex min-h-[56px] items-center gap-3 px-4 py-3"
                      >
                        <span className="num w-8 shrink-0 text-xs text-muted">
                          #{creative.creativeNumber}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {creative.conceptHeadline.trim() === ""
                              ? "Untitled hook"
                              : creative.conceptHeadline}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {creative.parentCreativeId
                              ? "Variation · "
                              : ""}
                            <span className="num">
                              {checked}/{creative.compliance.length}
                            </span>{" "}
                            compliance
                          </span>
                        </span>
                        <CreativeTypeChip type={creative.creativeType} />
                        <CreativeStatusBadge status={creative.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({
  label,
  href,
  value,
  detail,
  warning,
}: {
  label: string;
  href: string;
  value: string;
  detail?: string | null;
  warning?: string;
}) {
  return (
    <div className="flex items-start gap-4 px-6 py-4">
      <span className="w-24 shrink-0 text-xs font-medium tracking-[0.02em] text-muted">
        {label}
      </span>
      <span className="min-w-0 flex-1">
        <Link href={href} className="text-sm font-medium hover:text-accent">
          {value}
        </Link>
        {detail && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
            {detail}
          </span>
        )}
        {warning && (
          <span className="mt-1 block text-xs leading-relaxed text-warn">
            {warning}
          </span>
        )}
      </span>
    </div>
  );
}
