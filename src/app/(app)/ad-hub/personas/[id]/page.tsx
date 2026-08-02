import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { deletePersona, updatePersona } from "@/lib/actions/adhub";
import {
  AWARENESS_LEVEL_LABELS,
  AwarenessLevel,
  PERSONA_FIELDS,
  countLabel,
  personaRollupStatus,
} from "@/lib/adhub";
import { ConceptStatusBadge, PersonaRollupBadge } from "@/components/Badge";
import ConfirmForm from "@/components/ConfirmForm";

export const dynamic = "force-dynamic";

export default async function PersonaDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const persona = await prisma.persona.findUnique({
    where: { id: params.id },
    include: {
      concepts: {
        orderBy: [{ batchNumber: "asc" }, { createdAt: "asc" }],
        include: { _count: { select: { creatives: true } } },
      },
    },
  });
  if (!persona) notFound();

  const update = updatePersona.bind(null, persona.id);
  const remove = deletePersona.bind(null, persona.id);
  const creatives = persona.concepts.reduce(
    (n, c) => n + c._count.creatives,
    0,
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/ad-hub" className="text-sm text-accent hover:underline">
            ← Ad Hub
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="display text-[32px] font-semibold">
              {persona.name}
            </h1>
            <PersonaRollupBadge
              status={personaRollupStatus(persona.concepts)}
            />
          </div>
          <p className="num mt-1.5 text-sm text-muted">
            {countLabel(persona.concepts.length, "concept")} ·{" "}
            {countLabel(creatives, "creative")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/ad-hub/concepts/new" className="btn-primary">
            New concept
          </Link>
          <ConfirmForm
            action={remove}
            message={`Delete ${persona.name}? Their ${countLabel(persona.concepts.length, "concept")} and every creative underneath go with them.`}
            className="btn-danger"
          >
            Delete
          </ConfirmForm>
        </div>
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <h2 className="display mb-4 text-xl font-semibold">Persona</h2>
          <form action={update} className="card space-y-5 p-6">
            <div>
              <label className="field-label" htmlFor="name">
                Persona name
              </label>
              <input
                id="name"
                name="name"
                defaultValue={persona.name}
                required
                className="field"
              />
            </div>
            {PERSONA_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="field-label" htmlFor={f.key}>
                  {f.label}
                </label>
                <textarea
                  id={f.key}
                  name={f.key}
                  rows={2}
                  defaultValue={persona[f.key] ?? ""}
                  placeholder={f.placeholder}
                  className="field"
                />
              </div>
            ))}
            <div className="flex justify-end border-t border-line/60 pt-5">
              <button type="submit" className="btn-primary">
                Save changes
              </button>
            </div>
          </form>
        </section>

        <section className="lg:col-span-2">
          <h2 className="display mb-4 text-xl font-semibold">Concepts</h2>
          <div className="card">
            {persona.concepts.length === 0 ? (
              <p className="p-6 text-sm text-muted">
                Nothing built for this persona yet. The new-concept wizard picks
                them up at step 1.
              </p>
            ) : (
              <ul>
                {persona.concepts.map((concept) => (
                  <li
                    key={concept.id}
                    className="border-b border-line/60 last:border-b-0 hover:bg-wash/60"
                  >
                    <Link
                      href={`/ad-hub/concepts/${concept.id}`}
                      className="flex min-h-[56px] items-center gap-3 px-4 py-3"
                    >
                      <span className="num w-8 shrink-0 text-xs text-muted">
                        B{concept.batchNumber}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {concept.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {AWARENESS_LEVEL_LABELS[
                            concept.awarenessLevel as AwarenessLevel
                          ] ?? concept.awarenessLevel}{" "}
                          ·{" "}
                          <span className="num">
                            {countLabel(concept._count.creatives, "creative")}
                          </span>
                        </span>
                      </span>
                      <ConceptStatusBadge status={concept.status} />
                    </Link>
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
