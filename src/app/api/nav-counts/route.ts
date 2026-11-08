// The sidebar's counts (src/lib/navCounts.ts). A route rather than a server
// action for the same reason /api/jobs is one: it is polled, and server actions
// run one at a time per page.

import { NextResponse } from "next/server";
import { loadNavCounts } from "@/lib/navCounts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await loadNavCounts(), { headers: { "Cache-Control": "no-store" } });
}
