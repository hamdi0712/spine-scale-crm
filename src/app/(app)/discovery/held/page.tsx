import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  promoteDiscoveryCandidate,
  rejectHeldCandidate,
} from "@/lib/actions/discovery";
import { IcpTier } from "@/lib/icp";
import { PAYMENT_MODELS, PAYMENT_MODEL_LABELS, PaymentModel } from "@/lib/icpScoring";
import { V2_MAX_SCORE } from "@/lib/icpWeights";
import { parseStoredBreakdown } from "@/lib/storedBreakdown";
import { fmtDate } from "@/lib/format";
import { IcpTierBadge } from "@/components/Badge";
import ConfirmForm from "@/components/ConfirmForm";
import IcpBreakdownV2View, {
  CitationLine,
  PaymentModelCard,
} from "@/components/IcpBreakdownV2View";

export const dynamic = "force-dynamic";

// Held — Tier 2 chiro. Clinics the ICP model found to be a confirmed fit and
// over the bar, whose primary service is chiropractic, so they were held for a
// person rather than promoted automatically.
//
// The review is the point of the page, and the payment model is what it turns
// on: a cash-pay chiro with a disc program and an insurance-billed adjustment
// mill score alike on fit, and are not alike at all. So every card leads with
// how the clinic is paid and the quote that says so, and the list filters by
// it. Promote and Reject are the only two ways out.
type Filter = "all" | PaymentModel;

export default async function HeldCandidatesPage({
  searchParams,
}: {
  searchParams: { payment?: string };
}) {
  const filter: Filter = (PAYMENT_MODELS as readonly string[]).includes(
    searchParams.payment ?? "",
  )
    ? (searchParams.payment as PaymentModel)
    : "all";

  const rows = await prisma.discoveryCandidate.findMany({
    where: { status: "HELD_CHIRO" },
    orderBy: [{ icpTotal: "desc" }, { createdAt: "desc" }],
  });
  const held = rows.flatMap((row) => {
    const stored = parseStoredBreakdown(row.icpBreakdown);
    return stored?.model === "v2" ? [{ row, breakdown: stored.breakdown }] : [];
  });
  const counts = Object.fromEntries(
    PAYMENT_MODELS.map((m) => [m, held.filter((h) => h.breakdown.paymentModel.model === m).length]),
  ) as Record<PaymentModel, number>;
  const shown =
    filter === "all" ? held : held.filter((h) => h.breakdown.paymentModel.model === filter);

  return (
    <div className="max-w-4xl">
      <div className="flex items-end justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-4">
        <div>
          <Link href="/discovery" className="text-sm text-accent hover:underline">
            ← Discovery
          </Link>
          <h1 className="display mt-2 text-[32px] font-semibold">Held — Tier 2 chiro</h1>
          <p className="helper-text mt-1.5 text-sm text-muted">
            Qualified chiropractic-first clinics, held for you to promote or
            reject — grouped by how they are paid
          </p>
        </div>
        <div className="segment">
          <Link
            href="/discovery/held"
            className={`segment-item ${filter === "all" ? "segment-item-on" : ""}`}
          >
            All <span className="num">({held.length})</span>
          </Link>
          {PAYMENT_MODELS.map((m) => (
            <Link
              key={m}
              href={`/discovery/held?payment=${m}`}
              className={`segment-item ${filter === m ? "segment-item-on" : ""}`}
            >
              {m === "unknown" ? "Not stated" : PAYMENT_MODEL_LABELS[m].split(" (")[0]}{" "}
              <span className="num">({counts[m]})</span>
            </Link>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card mt-8 px-6 py-10 text-center">
          <p className="text-sm font-medium">Nothing held here</p>
          <p className="helper-text mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted">
            {held.length === 0
              ? "Only the ICP model holds clinics, and only once it has been applied from Compare scoring."
              : "No held clinic has this payment model."}
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {shown.map(({ row, breakdown }) => {
            const promote = promoteDiscoveryCandidate.bind(null, row.id);
            const reject = rejectHeldCandidate.bind(null, row.id);
            return (
              <div key={row.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line/60 px-6 py-4 max-md:px-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        href={`/discovery/${row.id}`}
                        className="display truncate text-lg font-semibold hover:underline"
                      >
                        {row.clinicName}
                      </Link>
                      <IcpTierBadge tier={(row.icpTier as IcpTier | null) ?? null} />
                      <span className="num text-sm text-muted">
                        {breakdown.total} / {V2_MAX_SCORE}
                      </span>
                    </div>
                    <p className="num mt-0.5 text-xs text-muted">
                      {[row.contactName, row.location, `imported ${fmtDate(row.createdAt)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <ConfirmForm
                      action={promote}
                      message={`Promote ${row.clinicName} to the pipeline? Its scorecard comes with it and stays editable on the lead.`}
                      className="btn-primary"
                    >
                      Promote
                    </ConfirmForm>
                    <ConfirmForm
                      action={reject}
                      message={`Reject ${row.clinicName}? It moves to the Rejected list with its scoring kept.`}
                      className="btn"
                    >
                      Reject
                    </ConfirmForm>
                  </div>
                </div>
                <div className="grid gap-3 px-6 pt-5 max-md:px-4 sm:grid-cols-2">
                  <PaymentModelCard breakdown={breakdown} />
                  <div className="rounded-[10px] border border-line px-3.5 py-2.5">
                    <p className="text-xs font-medium">
                      Why it is held:{" "}
                      <span className="text-purple">primary service is chiropractic</span>
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                      {breakdown.primaryService.reason}
                    </p>
                    {breakdown.primaryService.citation && (
                      <CitationLine citation={breakdown.primaryService.citation} />
                    )}
                  </div>
                </div>
                <IcpBreakdownV2View breakdown={breakdown} compact />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
