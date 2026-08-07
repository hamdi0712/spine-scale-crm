// The stored reasoning behind one candidate's score, rendered.
//
// Every line is a claim with the sentence behind it and a chip saying where
// that sentence came from — arithmetic over the candidate's own data, or the
// model reading the evidence. Kept apart from the pages that show it because
// two of them do: a candidate's own record, and the rejected list, where the
// whole point is that a rejection is readable without opening anything.
//
// It renders the breakdown as it was stored, not as the framework reads today.
// A clinic rejected last month was rejected for these reasons, and re-tuning
// the bands must not quietly rewrite them.

import {
  DISCOVERY_SOURCE_LABELS,
  DiscoveryBreakdown,
  DiscoveryScoreEntry,
  DiscoveryScoreSource,
  triggeredDisqualifiers,
} from "@/lib/discovery";
import { ICP_MAX_SCORE, ICP_TIER_ACTIONS } from "@/lib/icp";
import { fmtDateTime } from "@/lib/format";
import { IcpTierBadge } from "@/components/Badge";

// Neutral for the computed half and brand-tinted for the model's, so a glance
// down the column says how much of this score was arithmetic. "No answer" is
// deliberately the quietest of the three — it is an absence, not a finding.
const SOURCE_CLS: Record<DiscoveryScoreSource, string> = {
  computed: "bg-wash text-muted",
  assist: "bg-accent/10 text-accent",
  unanswered: "bg-line/70 text-muted",
};

export function DiscoveryScoreHeader({
  breakdown,
}: {
  breakdown: DiscoveryBreakdown;
}) {
  const action = ICP_TIER_ACTIONS[breakdown.tier];
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/60 px-6 py-4">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">Score</h3>
        <p className="num mt-0.5 text-xs text-muted">
          {breakdown.scoredAt === ""
            ? "Scored automatically in Discovery"
            : `Scored automatically ${fmtDateTime(breakdown.scoredAt)}`}
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0 items-baseline gap-1 whitespace-nowrap">
          <span
            className={`num text-2xl font-semibold tracking-[-0.02em] ${
              breakdown.tier === "DISQUALIFIED" ? "text-muted" : "text-ink"
            }`}
          >
            {breakdown.total}
          </span>
          <span className="num text-sm text-muted">/ {ICP_MAX_SCORE}</span>
        </span>
        <IcpTierBadge tier={breakdown.tier} tooltip={false} />
        {action && (
          <span className="hidden text-xs leading-relaxed text-muted sm:inline">
            {action}
          </span>
        )}
      </div>
    </div>
  );
}

export default function DiscoveryBreakdownView({
  breakdown,
}: {
  breakdown: DiscoveryBreakdown;
}) {
  const triggered = triggeredDisqualifiers(breakdown);
  return (
    <div className="space-y-6 p-6">
      {triggered.length > 0 ? (
        <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
          <p className="text-sm font-medium text-bad">
            Disqualified at Layer 1 — do not proceed to scoring
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {triggered.map((d) => (
              <li key={d.key} className="text-xs leading-relaxed">
                <span className="font-medium text-ink">{d.label}</span>
                <span className="block text-muted">{d.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            The categories below were still scored and kept — a clinic that
            would otherwise have scored well is the one worth looking at again.
          </p>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-muted">
          None of the five hard disqualifiers was flagged against the evidence
          gathered.
        </p>
      )}

      <div>
        <p className="field-label">Scored categories</p>
        <ul className="divide-y divide-line/60 rounded-[10px] border border-line">
          {[...breakdown.categories, ...breakdown.gaps].map((entry) => (
            <EntryRow key={entry.key} entry={entry} />
          ))}
        </ul>
      </div>

      {breakdown.summary !== "" && (
        <div className="rounded-[10px] border border-accent/30 bg-accent/5 px-3.5 py-2.5">
          <p className="text-xs font-medium">Overall fit</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {breakdown.summary}
          </p>
        </div>
      )}

      <div className="space-y-1.5 text-xs leading-relaxed text-muted">
        <p>
          Read from{" "}
          {breakdown.evidence.length === 0
            ? "this candidate's enrichment"
            : breakdown.evidence.join(", ")}
          . These were readings taken at the time of the run, not a live feed.
        </p>
        {breakdown.notes.map((note, i) => (
          <p key={i}>{note}</p>
        ))}
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: DiscoveryScoreEntry }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium">{entry.label}</p>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className={`inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${SOURCE_CLS[entry.source]}`}
          >
            {DISCOVERY_SOURCE_LABELS[entry.source]}
          </span>
          <span
            className={`num shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              entry.points > 0 ? "bg-accent/10 text-accent" : "bg-wash text-muted"
            }`}
          >
            {entry.points} / {entry.max}
          </span>
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{entry.reason}</p>
    </li>
  );
}
