// A seeded run for trying the progress panel without spending anything: ~20
// made-up clinics, a second or two each, with a couple of failures and a
// warning along the way. Development only — in production this is a 404.
//
//   curl -X POST -b "<session cookie>" "http://localhost:3000/api/jobs/demo?n=20&ms=1800"
//
// It goes through the real runner, so leaving the page, refreshing and the
// header pill all behave exactly as they do for a real re-crawl.

import { NextRequest, NextResponse } from "next/server";
import { launchJob } from "@/lib/jobRunner";

export const dynamic = "force-dynamic";

const CLINICS = [
  "Hands On Wellness Center", "Align Spine & Sport", "Cedar Valley Chiropractic", "Peak Performance Spine",
  "Riverbend Disc Center", "Northside Back Clinic", "Harbor Decompression", "Summit Spinal Care",
  "Willow Creek Chiropractic", "Blue Ridge Spine Institute", "Lakeshore Wellness", "Meridian Back & Neck",
  "Oak Hollow Chiropractic", "Pinecrest Spine Center", "Coastal Disc Relief", "Prairie Health Chiropractic",
  "Granite State Spine", "Evergreen Back Clinic", "Sunrise Decompression", "Maple Grove Chiropractic",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const n = Math.min(CLINICS.length, Number(req.nextUrl.searchParams.get("n") ?? CLINICS.length) || CLINICS.length);
  const pace = Number(req.nextUrl.searchParams.get("ms") ?? 1800) || 1800;
  // Shown on a real page's panel when given that panel's source — e.g.
  // ?source=pipeline-recrawl-before puts it on Pipeline's "crawled before" card.
  const source = req.nextUrl.searchParams.get("source") ?? "demo";
  const failAt = new Set([6, 14]);
  const result = await launchJob({
    kind: "demo",
    source,
    verb: "Re-crawling",
    href: "/pipeline",
    items: CLINICS.slice(0, n).map((name, i) => ({ id: `demo-${i}`, name, estimateUsd: 0.062 })),
    work: async (item) => {
      const i = Number(item.id.slice(5));
      await sleep(pace * (0.6 + ((i * 37) % 10) / 12));
      if (failAt.has(i)) return { outcome: "error", detail: "The crawl ran but read nothing — the site returned 403." };
      if (i === 10) return { outcome: "warn", detail: "1 page · only the home page was read" };
      const pages = 3 + (i % 4);
      return { outcome: "ok", detail: `${pages} pages · ${i % 3 === 0 ? "decompression page found" : `${12 + i * 3} links`}` };
    },
  });
  return NextResponse.json(result);
}
