import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ActivityFeed from "@/components/ActivityFeed";

export const dynamic = "force-dynamic";

// The whole milestone feed, behind the dashboard card's "View all". Internal
// only, most recent first — the same rows, just without the six-line ceiling.
const PAGE_SIZE = 100;

export default async function ActivityPage() {
  const now = new Date();
  const entries = await prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });

  return (
    <div>
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-[32px] font-bold tracking-[-0.02em]">Activity</h1>
      <p className="mt-1.5 text-sm text-muted">
        Milestones across every lead and client — conversions, reports,
        contracts, payments, health changes and completed onboardings.
      </p>

      <div className="card mt-8 px-6 py-2">
        <ActivityFeed
          entries={entries.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            summary: entry.summary,
            createdAt: entry.createdAt,
            href: entry.clientId
              ? `/clients/${entry.clientId}`
              : entry.leadId
                ? `/pipeline/${entry.leadId}`
                : null,
          }))}
          now={now}
        />
      </div>
    </div>
  );
}
