import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { promoteDiscoveryCandidate } from "@/lib/actions/discovery";
import { checkForSecondLooks } from "@/lib/actions/secondLook";
import { parseBreakdown } from "@/lib/discovery";
import { ICP_MAX_SCORE, IcpTier } from "@/lib/icp";
import { fmtDate } from "@/lib/format";
import { fmtRelative } from "@/lib/activity";
import { IcpTierBadge, SecondLookBadge } from "@/components/Badge";
import ConfirmForm from "@/components/ConfirmForm";
import DiscoveryBreakdownView from "@/components/DiscoveryBreakdown";
import SecondLookPanel from "@/components/SecondLookPanel";

export const dynamic = "force-dynamic";

// The rejected list — every candidate the queue decided against, with the
// reasoning that decided it, and a way to overrule it.
//
// Rejections are shown in full rather than summarised, because the only useful
// thing to do with this page is disagree with something on it. A row that said
// "Rejected — C-tier" and nothing else would give nobody grounds to press the
// override, which would make the override decorative.
//
// Two ways in: a disqualifier fired at Layer 1, or the clinic scored 0–4. The
// filter separates them, because they are different arguments — one is "this
// is not the kind of clinic we serve" and the other is "this one is, but not
// well enough".
type Filter = "all" | "disqualified" | "ctier";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All rejected" },
  { key: "disqualified", label: "Disqualified" },
  { key: "ctier", label: "C-tier" },
];

export default async function RejectedCandidatesPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const filter: Filter =
    searchParams.filter === "disqualified"
      ? "disqualified"
      : searchParams.filter === "ctier"
        ? "ctier"
        : "all";

  const now = new Date();

  // Flagged first, then the order this page has always used. A second-look flag
  // is exactly the signal the sort was reaching for — "where a decision worth
  // overruling would be" — and it knows something the score does not: a clinic
  // disqualified on thin reasoning can be sitting at 2/10 and still be the row
  // most worth reading. Within each group, highest score first as before.
  const [candidates, rejectedTotal, lastSwept] = await Promise.all([
    prisma.discoveryCandidate.findMany({
      where: {
        status: "REJECTED",
        ...(filter === "disqualified" ? { disqualified: true } : {}),
        ...(filter === "ctier" ? { disqualified: false } : {}),
      },
      orderBy: [
        { secondLookFlagged: "desc" },
        { icpTotal: "desc" },
        { createdAt: "desc" },
      ],
    }),
    // The whole list, not the filtered view — the sweep reads every rejection
    // regardless of which tab is open, so the button's state should not change
    // with the filter.
    prisma.discoveryCandidate.count({ where: { status: "REJECTED" } }),
    prisma.discoveryCandidate.findFirst({
      where: { status: "REJECTED", secondLookAt: { not: null } },
      orderBy: { secondLookAt: "desc" },
      select: { secondLookAt: true },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link href="/discovery" className="text-sm text-accent hover:underline">
            ← Discovery
          </Link>
          <h1 className="display mt-2 text-[32px] font-semibold">Rejected</h1>
          <p className="mt-1.5 text-sm text-muted">
            Every candidate the queue decided against, and why — highest score
            first, because that is where a decision worth overruling would be
          </p>
        </div>
        <div className="segment">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/discovery/rejected" : `/discovery/rejected?filter=${f.key}`}
              className={`segment-item ${filter === f.key ? "segment-item-on" : ""}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <SecondLookPanel
        check={checkForSecondLooks}
        rejected={rejectedTotal}
        lastRunAge={
          lastSwept?.secondLookAt
            ? fmtRelative(lastSwept.secondLookAt, now)
            : null
        }
      />

      {candidates.length === 0 ? (
        <div className="card mt-8 px-6 py-10 text-center">
          <p className="text-sm font-medium">Nothing rejected here</p>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted">
            {filter === "all"
              ? "The queue has not turned anything down yet."
              : "No rejection in this list was reached that way."}
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {candidates.map((candidate) => {
            const breakdown = parseBreakdown(candidate.icpBreakdown);
            const promote = promoteDiscoveryCandidate.bind(null, candidate.id);
            return (
              <div key={candidate.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        href={`/discovery/${candidate.id}`}
                        className="display truncate text-lg font-semibold hover:underline"
                      >
                        {candidate.clinicName}
                      </Link>
                      <IcpTierBadge
                        tier={(candidate.icpTier as IcpTier | null) ?? null}
                      />
                      {candidate.icpTotal != null && (
                        <span className="num text-sm text-muted">
                          {candidate.icpTotal} / {ICP_MAX_SCORE}
                        </span>
                      )}
                      {candidate.secondLookFlagged && (
                        <SecondLookBadge
                          reason={candidate.secondLookReason}
                          source={candidate.secondLookSource}
                        />
                      )}
                    </div>
                    <p className="mt-1 text-sm">
                      {candidate.disqualifiedReason ??
                        "Rejected, with no reason recorded."}
                    </p>
                    {/* The flag's own sentence, under the rejection it
                        disagrees with rather than beside it: the rejection is
                        still what happened, and this is a note about it. */}
                    {candidate.secondLookFlagged && candidate.secondLookReason && (
                      <p className="mt-1 text-xs leading-relaxed text-ai">
                        Worth a second look — {candidate.secondLookReason}
                      </p>
                    )}
                    <p className="num mt-0.5 text-xs text-muted">
                      {[
                        candidate.contactName,
                        candidate.location,
                        `imported ${fmtDate(candidate.createdAt)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {/* The override. Confirmed rather than instant: it is
                      overruling a scored decision whose reasoning is directly
                      below it, and that is a thing to mean. */}
                  <ConfirmForm
                    action={promote}
                    message={`Promote ${candidate.clinicName} to the pipeline anyway? The scorecard it arrives with is the one this run produced — including anything flagged against it — and it stays editable on the lead.`}
                    className="btn shrink-0"
                  >
                    Promote anyway
                  </ConfirmForm>
                </div>
                {breakdown ? (
                  <DiscoveryBreakdownView breakdown={breakdown} />
                ) : (
                  <p className="px-6 py-5 text-xs leading-relaxed text-muted">
                    No breakdown was stored for this one, so there is nothing to
                    show beyond the sentence above.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
