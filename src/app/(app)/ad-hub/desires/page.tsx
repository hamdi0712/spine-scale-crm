import { prisma } from "@/lib/prisma";
import {
  createBenefit,
  createDesire,
  deleteBenefit,
  deleteDesire,
  updateBenefit,
  updateDesire,
} from "@/lib/actions/adhub";
import { countLabel } from "@/lib/adhub";
import AdHubNav from "@/components/AdHubNav";
import ConfirmForm from "@/components/ConfirmForm";

export const dynamic = "force-dynamic";

export default async function DesiresPage() {
  const desires = await prisma.desire.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      benefits: {
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { concepts: true } } },
      },
      _count: { select: { concepts: true } },
    },
  });

  return (
    <div>
      <AdHubNav
        current="desires"
        blurb="Mass desires and the benefits written against them — shared across every concept"
      />

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-3">
        <section className="lg:col-span-1">
          <h2 className="mb-4 text-xl font-semibold">New desire</h2>
          <form action={createDesire} className="card space-y-5 p-6">
            <div>
              <label className="field-label" htmlFor="statement">
                Want statement
              </label>
              <textarea
                id="statement"
                name="statement"
                rows={3}
                required
                placeholder="I want to get through a full workday without my back seizing up"
                className="field"
              />
              <p className="mt-2 text-xs leading-relaxed text-muted">
                First person, as they would say it. A desire is not owned by one
                persona — the same want turns up across several of them, which
                is why it lives here rather than on a persona record.
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="notes">
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={2}
                placeholder="Where it came from — a review, a call, a comment thread"
                className="field"
              />
            </div>
            <div className="flex justify-end border-t border-line/60 pt-5">
              <button type="submit" className="btn-primary">
                Add desire
              </button>
            </div>
          </form>
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-4 text-xl font-semibold">
            Desires{" "}
            <span className="num text-sm font-normal text-muted">
              {desires.length}
            </span>
          </h2>

          {desires.length === 0 ? (
            <div className="card p-6">
              <p className="text-sm text-muted">
                No desires yet. Write the first one on the left, or let the
                new-concept wizard create one as you go.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {desires.map((desire) => {
                const inUse = desire._count.concepts > 0;
                return (
                  <div key={desire.id} className="card">
                    <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium">
                          {desire.statement}
                        </h3>
                        <p className="num mt-0.5 text-xs text-muted">
                          {countLabel(desire._count.concepts, "concept")} ·{" "}
                          {countLabel(desire.benefits.length, "benefit")}
                        </p>
                      </div>
                      {inUse ? (
                        <span
                          title="Concepts are built on this desire — they would lose the want they answer."
                          className="shrink-0 text-xs text-muted"
                        >
                          In use
                        </span>
                      ) : (
                        <ConfirmForm
                          action={deleteDesire.bind(null, desire.id)}
                          message={`Delete "${desire.statement}"? Its benefits go with it.`}
                          className="shrink-0 px-1 text-muted hover:text-bad"
                        >
                          ×
                        </ConfirmForm>
                      )}
                    </div>

                    <form
                      action={updateDesire.bind(null, desire.id)}
                      className="space-y-4 border-b border-line/60 p-6"
                    >
                      <div>
                        <label className="field-label">Want statement</label>
                        <textarea
                          name="statement"
                          rows={2}
                          defaultValue={desire.statement}
                          className="field"
                        />
                      </div>
                      <div>
                        <label className="field-label">Notes</label>
                        <textarea
                          name="notes"
                          rows={2}
                          defaultValue={desire.notes ?? ""}
                          className="field"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button type="submit" className="btn h-[34px] px-3.5 text-xs">
                          Save desire
                        </button>
                      </div>
                    </form>

                    <div className="space-y-4 p-6">
                      <h4 className="text-xs font-medium tracking-[0.02em] text-muted">
                        Benefits answering this desire
                      </h4>

                      {desire.benefits.map((benefit) => (
                        <div
                          key={benefit.id}
                          className="rounded-[10px] border border-line p-4"
                        >
                          <form
                            action={updateBenefit.bind(null, benefit.id)}
                            className="space-y-3"
                          >
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="field-label">
                                  Product / feature name
                                </label>
                                <input
                                  name="productName"
                                  defaultValue={benefit.productName}
                                  className="field"
                                />
                              </div>
                              <div>
                                <label className="field-label">
                                  The feature
                                </label>
                                <input
                                  name="feature"
                                  defaultValue={benefit.feature}
                                  className="field"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="field-label">
                                The benefit — so you can…
                              </label>
                              <input
                                name="benefit"
                                defaultValue={benefit.benefit}
                                className="field"
                              />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="num text-xs text-muted">
                                {countLabel(benefit._count.concepts, "concept")}
                              </span>
                              <button
                                type="submit"
                                className="btn h-[34px] px-3.5 text-xs"
                              >
                                Save benefit
                              </button>
                            </div>
                          </form>
                          {benefit._count.concepts === 0 && (
                            <div className="mt-2 flex justify-end border-t border-line/60 pt-2">
                              <ConfirmForm
                                action={deleteBenefit.bind(null, benefit.id)}
                                message={`Delete the benefit "${benefit.benefit}"?`}
                                className="text-xs text-muted hover:text-bad"
                              >
                                Delete benefit
                              </ConfirmForm>
                            </div>
                          )}
                        </div>
                      ))}

                      <form
                        key={desire.benefits.length}
                        action={createBenefit.bind(null, desire.id)}
                        className="space-y-3 rounded-[10px] border border-dashed border-line p-4"
                      >
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="field-label">
                              Product / feature name
                            </label>
                            <input
                              name="productName"
                              required
                              placeholder="12-Week Non-Surgical Spine Program"
                              className="field"
                            />
                          </div>
                          <div>
                            <label className="field-label">The feature</label>
                            <input
                              name="feature"
                              required
                              placeholder="What it actually is"
                              className="field"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="field-label">
                            The benefit — so you can…
                          </label>
                          <input
                            name="benefit"
                            required
                            placeholder="…get through a full day on site without planning it around the pain"
                            className="field"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            className="btn h-[34px] px-3.5 text-xs"
                          >
                            Add benefit
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
