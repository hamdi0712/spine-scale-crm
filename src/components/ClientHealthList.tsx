// The Client health card's rows: who they are, how the last few weeks have
// gone, and what the status is asking of you.
//
// Only live clients appear. A client still being onboarded has delivery
// progress, not health, and the clients table shows that instead. Where there
// are not yet enough of them to fill the card, the spare slot goes to the
// pipeline rather than to whitespace — see HealthTeaser below.

import Link from "next/link";
import { ClientHealth, HEALTH_ACTIONS } from "@/lib/health";
import { HealthBadge, TrendArrow } from "@/components/Badge";
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

// What fills the card's spare slot when there are not yet two active clients:
// the lead closest to closing, chosen in src/app/(app)/page.tsx. A row here is
// a promise of what the card will be rather than a placeholder for it — so it
// is a real link into the pipeline, drawn dashed and muted so it is never
// mistaken for a client that already exists.
export interface HealthTeaser {
  id: string;
  clinicName: string;
  stageLabel: string; // "Proposal Sent"
}

function PipelineTeaser({ teaser, alone }: { teaser: HealthTeaser; alone: boolean }) {
  return (
    <Link
      href={`/pipeline/${teaser.id}`}
      className={`block rounded-[10px] border border-dashed border-line px-3 py-3 hover:opacity-80 ${
        alone ? "" : "mt-3"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">
          {teaser.clinicName}
        </span>
        <span className="inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full bg-line/70 px-2.5 text-xs font-medium text-muted">
          In pipeline
        </span>
      </span>
      <span className="mt-1 block truncate text-xs text-muted">
        {teaser.stageLabel} · will track health here once active.
      </span>
    </Link>
  );
}

export default function ClientHealthList({
  rows,
  teaser = null,
}: {
  rows: HealthRow[];
  teaser?: HealthTeaser | null;
}) {
  if (rows.length === 0 && !teaser) {
    return (
      <div className="py-6">
        <p className="text-sm text-muted">Your next client will show up here</p>
        <Link
          href="/clients/new"
          className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
        >
          + New client
        </Link>
      </div>
    );
  }
  return (
    <div>
      {rows.length > 0 && (
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
      )}
      {teaser && <PipelineTeaser teaser={teaser} alone={rows.length === 0} />}
    </div>
  );
}
