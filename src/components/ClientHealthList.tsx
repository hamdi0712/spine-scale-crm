// The Client health card's rows: who they are, how the last few weeks have
// gone, and what the status is asking of you.
//
// Only live clients appear. A client still being onboarded has delivery
// progress, not health, and the clients table shows that instead.
//
// With no live clients the card is its empty state — the glyph, what the card
// will track, and the one thing there is to do about it. It used to preview the
// nearest lead in the pipeline instead, which put a row about a lead inside a
// card about clients; the pipeline has two cards of its own on this page and
// does not need a third.

import Link from "next/link";
import { ClientHealth, HEALTH_ACTIONS } from "@/lib/health";
import { HealthBadge, TrendArrow } from "@/components/Badge";
import EmptyMark from "@/components/EmptyMark";
import Sparkline from "@/components/Sparkline";

const SPARK_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = {
  HEALTHY: "green",
  NEEDS_ATTENTION: "amber",
  AT_RISK: "red",
  RAMPING: "neutral",
};

export interface HealthRow {
  id: string;
  clinicName: string;
  detail: string; // "Active · Growth Package"
  health: ClientHealth;
}

export default function ClientHealthList({ rows }: { rows: HealthRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-2 py-3 text-center">
        <EmptyMark icon="clients" tone="teal" />
        <p className="mt-2.5 text-sm font-medium">
          Your next client will show up here
        </p>
        <p className="mx-auto mt-1 max-w-[15rem] text-xs leading-relaxed text-muted">
          Track performance, campaign results and growth across all your clinic
          partners.
        </p>
        {/* Back to a text link. A 42px button is a lot of card to spend on an
            invitation that is repeated by the primary button in the page header
            two rows above, and this row of three has to fit on one screen with
            everything else. */}
        <Link
          href="/clients/new"
          className="mt-3 inline-block text-xs font-medium text-accent hover:underline"
        >
          + New client
        </Link>
      </div>
    );
  }
  return (
    <div>
      <ul className="divide-y divide-line/60">
        {rows.map((row) => (
          <li key={row.id}>
            {/* Two lines rather than one: the clinic name and the badge are
                what the card is for, and squeezing the sparkline in beside
                them at this width would truncate both. */}
            <Link
              href={`/reporting/${row.id}`}
              className="block py-3 hover:opacity-80"
              title={row.health.reason}
            >
              <span className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {row.clinicName}
                </span>
                <TrendArrow trend={row.health.trend} />
                <HealthBadge
                  status={row.health.status}
                  reason={row.health.reason}
                />
              </span>
              <span className="mt-1 flex items-center gap-2.5">
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  {row.detail}
                </span>
                <Sparkline
                  points={row.health.weeks.map((w) => w.showRate)}
                  tone={SPARK_TONE[row.health.status]}
                  label={`${row.clinicName} — ${HEALTH_ACTIONS[row.health.status]}`}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
