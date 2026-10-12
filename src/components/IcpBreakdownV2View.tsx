// A new-model breakdown, rendered — the gate, Fit, Signals, and every citation
// behind them.
//
// The new model's counterpart to src/components/DiscoveryBreakdown.tsx, used
// wherever a candidate scored under it is read: its own page, the Rejected and
// Held lists, and Compare scoring. Read-only; the editable version is the
// lead's card (src/components/IcpScorecardV2.tsx), which draws its rows with
// the same pieces exported here so a citation looks the same everywhere.
//
// Every quote shown here is third-party text off a clinic's site. It is
// rendered as text and nothing else, and a source that is a URL is a plain
// outbound link marked nofollow.

import {
  CRITERION_SOURCE_LABELS,
  Citation,
  CriterionEntry,
  CriterionSource,
  IcpBreakdownV2,
  PAYMENT_MODEL_LABELS,
  SOURCE_PRECHECK,
  V2VerdictKind,
} from "@/lib/icpScoring";
import { FIT_FLOOR, FIT_MAX, SIGNALS_MAX, V2_MAX_SCORE } from "@/lib/icpWeights";
import { fmtDateTime } from "@/lib/format";
import { IcpTierBadge } from "@/components/Badge";

const SOURCE_CLS: Record<CriterionSource, string> = {
  computed: "bg-wash text-muted",
  assist: "bg-accent/10 text-accent",
  override: "bg-warn-soft text-warn-on-soft",
  unanswered: "bg-line/70 text-muted",
};

export const VERDICT_CLS: Record<V2VerdictKind, string> = {
  disqualified: "border-bad/30 bg-bad-soft/60",
  not_a_fit: "border-warn/30 bg-warn-soft/60",
  below_threshold: "border-line bg-wash/60",
  held_chiro: "border-purple/30 bg-purple-soft/60",
  promoted: "border-ok/30 bg-ok-soft/60",
};

export const VERDICT_TITLES: Record<V2VerdictKind, string> = {
  disqualified: "Disqualified at the gate",
  not_a_fit: "Not a confirmed fit",
  below_threshold: "A fit, below the bar",
  held_chiro: "Held — Tier 2 chiro",
  promoted: "Qualified",
};

export function SourceChip({ source }: { source: CriterionSource }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${SOURCE_CLS[source]}`}
    >
      {CRITERION_SOURCE_LABELS[source]}
    </span>
  );
}

export function PointsChip({ points, max }: { points: number; max: number }) {
  return (
    <span
      className={`num shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        points > 0 ? "bg-accent/10 text-accent" : "bg-wash text-muted"
      }`}
    >
      {points} / {max}
    </span>
  );
}

// A quote and where it came from. A URL source is a link to the page itself.
export function CitationLine({ citation }: { citation: Citation }) {
  const isUrl = /^https?:\/\//i.test(citation.source);
  return (
    <p className="mt-1.5 border-l-2 border-line pl-2.5 text-xs leading-relaxed">
      <span className="text-ink-soft">“{citation.quote}”</span>{" "}
      <span className="break-all text-muted">
        —{" "}
        {isUrl ? (
          <a
            href={citation.source}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent hover:underline"
          >
            {shortUrl(citation.source)}
          </a>
        ) : (
          citation.source
        )}
      </span>
    </p>
  );
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

export function CriterionRow({ entry }: { entry: CriterionEntry }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium">{entry.label}</p>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SourceChip source={entry.scoredPoints !== undefined ? "override" : entry.source} />
          <PointsChip points={entry.points} max={entry.max} />
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{entry.reason}</p>
      {entry.scoredPoints !== undefined && (
        <p className="num mt-1 text-xs text-muted">
          Overridden by hand — the run scored {entry.scoredPoints} / {entry.max}.
        </p>
      )}
      {entry.parts && entry.parts.length > 0 ? (
        <ul className="mt-1.5 space-y-1.5">
          {entry.parts.map((part, i) => (
            <li key={i} className="text-xs leading-relaxed">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-ink-soft">{part.label}</span>
                <span className="num shrink-0 text-muted">
                  {part.points} / {part.max}
                </span>
              </span>
              {part.reason && <span className="block text-muted">{part.reason}</span>}
              {part.citation && part.citation.source !== SOURCE_PRECHECK && (
                <CitationLine citation={part.citation} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        entry.citations.map((c, i) => <CitationLine key={i} citation={c} />)
      )}
    </li>
  );
}

export function IcpBreakdownV2Header({ breakdown }: { breakdown: IcpBreakdownV2 }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/60 px-6 py-4 max-md:flex-col max-md:items-start max-md:gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">Score — ICP model</h3>
        <p className="helper-text num mt-0.5 text-xs text-muted">
          Against “{breakdown.icp.name}”
          {breakdown.scoredAt ? ` · ${fmtDateTime(breakdown.scoredAt)}` : ""}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="flex shrink-0 items-baseline gap-1 whitespace-nowrap">
          <span
            className={`num text-2xl font-semibold tracking-[-0.02em] ${
              breakdown.tier === "DISQUALIFIED" ? "text-muted" : "text-ink"
            }`}
          >
            {breakdown.total}
          </span>
          <span className="num text-sm text-muted">/ {V2_MAX_SCORE}</span>
        </span>
        <IcpTierBadge tier={breakdown.tier} tooltip={false} />
      </div>
    </div>
  );
}

export default function IcpBreakdownV2View({
  breakdown,
  compact = false,
}: {
  breakdown: IcpBreakdownV2;
  // The lists show the verdict and the gate in full and fold the rows away.
  compact?: boolean;
}) {
  const triggered = breakdown.disqualifiers.filter((d) => d.triggered);
  const discarded = breakdown.disqualifiers.filter((d) => !d.triggered && d.discarded);
  const kind = breakdown.verdict.kind;

  const rows = (
    <>
      <Section
        title="Fit"
        meta={`${breakdown.fitTotal} / ${FIT_MAX} · floor ${FIT_FLOOR}`}
        entries={breakdown.fit}
      />
      <Section
        title="Signals"
        meta={`${breakdown.signalsTotal} / ${SIGNALS_MAX}`}
        entries={breakdown.signals}
      />
      <PrimaryAndPayment breakdown={breakdown} />
      {breakdown.summary !== "" && (
        <div className="rounded-[10px] border border-accent/30 bg-accent/5 px-3.5 py-2.5">
          <p className="text-xs font-medium">Overall fit</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{breakdown.summary}</p>
        </div>
      )}
      <div className="space-y-1.5 text-xs leading-relaxed text-muted">
        <p className="helper-text">
          Read from{" "}
          {breakdown.evidence.length === 0
            ? "this record's stored enrichment"
            : breakdown.evidence.join(", ")}
          . Every quote above was checked word for word against that evidence
          before it earned anything.
        </p>
        {breakdown.notes.map((note, i) => (
          <p key={i}>{note}</p>
        ))}
      </div>
    </>
  );

  return (
    <div className="space-y-6 p-6 max-md:p-4">
      <div className={`rounded-[10px] border px-4 py-3 ${VERDICT_CLS[kind]}`}>
        <p className="text-sm font-medium">{VERDICT_TITLES[kind]}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{breakdown.verdict.reason}</p>
        {kind === "disqualified" && breakdown.ungatedTotal > 0 && (
          <p className="helper-text num mt-1 text-xs text-muted">
            Before the gate it came to {breakdown.ungatedTotal} / {V2_MAX_SCORE} (fit{" "}
            {breakdown.fitTotal} / {FIT_MAX}).
          </p>
        )}
      </div>

      <div>
        <p className="field-label">Disqualifier gate</p>
        {triggered.length > 0 ? (
          <ul className="space-y-2.5">
            {triggered.map((d) => (
              <li
                key={d.id}
                className="rounded-[10px] border border-bad/30 bg-bad-soft/40 px-3.5 py-2.5"
              >
                <p className="text-sm font-medium text-bad">{d.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {d.scoredTriggered === false && !d.id.startsWith("manual")
                    ? "Ticked by hand on the lead."
                    : d.reason}
                </p>
                {d.citation && <CitationLine citation={d.citation} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-relaxed text-muted">
            None of the {breakdown.disqualifiers.length} disqualifiers had a cited,
            positive statement behind it.
          </p>
        )}
        {discarded.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">
              {discarded.length} flag{discarded.length === 1 ? "" : "s"} discarded by the
              evidence rules
            </summary>
            <ul className="mt-2 space-y-1.5">
              {discarded.map((d) => (
                <li key={d.id} className="text-xs leading-relaxed">
                  <span className="font-medium text-ink-soft">{d.label}</span>
                  <span className="block text-muted">{d.discarded}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {compact ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-accent hover:underline">
            Fit {breakdown.fitTotal}/{FIT_MAX} · Signals {breakdown.signalsTotal}/{SIGNALS_MAX} —
            show the breakdown
          </summary>
          <div className="mt-4 space-y-6">{rows}</div>
        </details>
      ) : (
        rows
      )}
    </div>
  );
}

function Section({
  title,
  meta,
  entries,
}: {
  title: string;
  meta: string;
  entries: CriterionEntry[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="field-label mb-0">{title}</p>
        <span className="num text-xs text-muted">{meta}</span>
      </div>
      <ul className="divide-y divide-line/60 rounded-[10px] border border-line">
        {entries.map((entry) => (
          <CriterionRow key={entry.key} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

export function PrimaryAndPayment({ breakdown }: { breakdown: IcpBreakdownV2 }) {
  const { primaryService } = breakdown;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-[10px] border border-line px-3.5 py-2.5">
        <p className="text-xs font-medium">
          Primary service:{" "}
          <span className={primaryService.chiropractic ? "text-purple" : "text-ink-soft"}>
            {primaryService.service ?? "not cited"}
          </span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{primaryService.reason}</p>
        {primaryService.citation && <CitationLine citation={primaryService.citation} />}
      </div>
      <PaymentModelCard breakdown={breakdown} />
    </div>
  );
}

export function PaymentModelCard({ breakdown }: { breakdown: IcpBreakdownV2 }) {
  const { paymentModel } = breakdown;
  return (
    <div className="rounded-[10px] border border-line px-3.5 py-2.5">
      <p className="text-xs font-medium">
        Payment model:{" "}
        <span className="text-ink-soft">{PAYMENT_MODEL_LABELS[paymentModel.model]}</span>
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{paymentModel.reason}</p>
      {paymentModel.citation && <CitationLine citation={paymentModel.citation} />}
    </div>
  );
}
