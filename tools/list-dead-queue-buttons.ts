// Every Email queue lead with nothing that would move it: its "Find this
// owner's email" button would do nothing, or it has no button and isn't
// waiting on a person (an owner to pick, an address to check). The rule in
// src/lib/emailBuckets.ts is right when this list is empty. Read-only.
//
//   DATABASE_URL="file:/path/to/the/app.db" npx tsx tools/list-dead-queue-buttons.ts

import { prisma } from "../src/lib/prisma";
import { deadQueueLeads } from "../src/lib/emailBucketsRead";

async function main() {
  const dead = await deadQueueLeads();
  console.log(`${dead.length} queue lead(s) with nothing that would move them:`);
  for (const d of dead) console.log(`  ${d.clinicName} — ${d.why}`);
  await prisma.$disconnect();
  process.exit(dead.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
