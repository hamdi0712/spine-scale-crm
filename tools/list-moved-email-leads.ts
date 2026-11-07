// One-off: every email lead the new bucket rule moved out of the Email queue —
// a usable address, and who it goes to settled by an approved email or a
// contact set or kept by hand, but never confirmed by Find owners. Before the
// fix these sat in the queue (Ready ones included); now they are in the Email
// pipeline. Read-only.
//
//   DATABASE_URL="file:/path/to/the/app.db" npx tsx tools/list-moved-email-leads.ts

import { prisma } from "../src/lib/prisma";
import { PIPELINE_DEFAULT_WHERE } from "../src/lib/liveLeadWhere";
import { leadTier } from "../src/lib/leadScore";
import { emailBucket } from "../src/lib/emailBuckets";
import { emailWorkflowStatus } from "../src/lib/emailWorkflow";
import { bucketExtras } from "../src/lib/emailBucketsRead";

async function main() {
  const leads = await prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, channel: "email", stage: { not: "LOST" } },
    include: { _count: { select: { emailSends: true } }, emailSends: { select: { step: true, sentAt: true } } },
    orderBy: { clinicName: "asc" },
  });
  const extras = await bucketExtras(leads);
  const rows = leads.flatMap((l) => {
    const x = extras.get(l.id)!;
    const now = emailBucket(l, x);
    // The old rule: the pipeline needed Find owners to have confirmed the owner.
    const before = emailBucket({ ...l, emailApprovedAt: null, contactNameByHand: false, contactConfirmedAt: null }, x);
    if (before !== "queue" || now !== "pipeline") return [];
    const status = emailWorkflowStatus(l, leadTier(l), l.emailSends);
    const why = [l.emailApprovedAt ? "approved" : null, l.contactNameByHand ? "contact set by hand" : null, l.contactConfirmedAt ? "contact kept by hand" : null]
      .filter(Boolean)
      .join(", ");
    return [{ clinic: l.clinicName, tier: leadTier(l) ?? "-", status, ready: status === "ready", approved: !!l.emailApprovedAt, why }];
  });
  console.log(`${rows.length} email lead(s) moved from the queue to the pipeline:`);
  for (const r of rows) console.log(`  ${r.clinic} · ${r.tier} · ${r.status} · ${r.why}`);
  console.log(`\nReady: ${rows.filter((r) => r.ready).length} · approved: ${rows.filter((r) => r.approved).length} · moved on a hand-set contact only: ${rows.filter((r) => !r.approved).length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
