// Every stored result of one run, for a job with a full view of its own once
// it is done — Process queue's per-candidate step list.

import { NextRequest, NextResponse } from "next/server";
import { readJobResults } from "@/lib/jobRunner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "No run id." }, { status: 400 });
  return NextResponse.json({ results: await readJobResults(id) }, { headers: { "Cache-Control": "no-store" } });
}
