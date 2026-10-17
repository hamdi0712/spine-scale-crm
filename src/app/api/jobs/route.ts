// What every page polls for the long-running jobs: the live runs and the
// finished ones nobody has dismissed. A route rather than a server action
// because Next runs server actions one at a time per page — a poll every
// second through that queue would hold up every other button on the page.

import { NextResponse } from "next/server";
import { readJobs } from "@/lib/jobRunner";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: await readJobs() }, { headers: { "Cache-Control": "no-store" } });
}
