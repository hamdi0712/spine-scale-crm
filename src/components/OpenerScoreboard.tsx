// Observation against curiosity, in one line of the pipeline header.
//
// The whole question is whether an opener that points at something verified
// gets answered more often than one that asks how something is handled, and the
// honest form of that answer at this volume is three numbers a side and a
// warning. So this is a strip, not a dashboard: sent, replies, rate, and a note
// saying not to read a winner into a sample this size.
//
// It renders nothing at all until something has been sent. An empty comparison
// in a header is a permanent reminder of a question nobody can answer yet.

import Link from "next/link";
import {
  MECHANISM_SAMPLE_FLOOR,
  MESSAGE_MECHANISM_LABELS,
} from "@/lib/outreachSequence";
import {
  MechanismGroupStats,
  OpenerComparison,
} from "@/lib/outreachSequenceRead";

export default function OpenerScoreboard({
  comparison,
}: {
  comparison: OpenerComparison;
}) {
  const { observation, curiosity, untagged } = comparison;
  if (observation.sent === 0 && curiosity.sent === 0 && untagged === 0) {
    return null;
  }

  // One note, not two. Both groups are under the floor for a long time, and the
  // same sentence printed twice reads as two separate problems.
  const small =
    (observation.sent > 0 && observation.smallSample) ||
    (curiosity.sent > 0 && curiosity.smallSample);

  return (
    <div className="card mt-6 px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
        <p className="text-xs font-medium tracking-[0.02em] text-muted">
          First message replies
        </p>
        <Group
          label={MESSAGE_MECHANISM_LABELS.observation}
          stats={observation}
        />
        <Group label="Curiosity" stats={curiosity} />
        {untagged > 0 && (
          <Link
            href="/pipeline?view=untagged"
            className="text-xs text-muted hover:text-accent"
          >
            <span className="num">{untagged}</span> sent
            {untagged === 1 ? " message is" : " messages are"} untagged and in
            neither group — tag {untagged === 1 ? "it" : "them"}
          </Link>
        )}
      </div>
      {small && (
        <p className="mt-2 text-xs text-muted">
          Small sample, don&rsquo;t draw conclusions. Under{" "}
          <span className="num">{MECHANISM_SAMPLE_FLOOR}</span> sends a side, one
          or two replies move a rate by tens of points.
        </p>
      )}
    </div>
  );
}

function Group({
  label,
  stats,
}: {
  label: string;
  stats: MechanismGroupStats;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="num text-sm text-muted">
        {stats.replyRatePercent === null ? (
          "none sent yet"
        ) : (
          <>
            {stats.replyRatePercent}% — {stats.replies} of {stats.sent}
          </>
        )}
      </span>
    </div>
  );
}
