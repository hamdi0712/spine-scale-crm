// The sidebar search (⌘K): clinics across the pipeline, Discovery and clients,
// by name, contact, email or location. Read-only; at most eight of each.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  const like = { contains: q };
  const [leads, candidates, clients] = await Promise.all([
    prisma.lead.findMany({
      where: { OR: [{ clinicName: like }, { contactName: like }, { email: like }, { location: like }] },
      select: { id: true, clinicName: true, contactName: true, location: true, channel: true, archived: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.discoveryCandidate.findMany({
      where: { promotedLead: null, OR: [{ clinicName: like }, { contactName: like }, { email: like }, { location: like }] },
      select: { id: true, clinicName: true, contactName: true, location: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.client.findMany({
      where: { OR: [{ clinicName: like }, { contactName: like }, { email: like }] },
      select: { id: true, clinicName: true, contactName: true },
      take: 8,
    }),
  ]);
  const sub = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");
  return NextResponse.json(
    {
      results: [
        ...clients.map((c) => ({ kind: "Client", title: c.clinicName, sub: sub(c.contactName), href: `/clients/${c.id}` })),
        ...leads.map((l) => ({
          kind: "Lead",
          title: l.clinicName,
          sub: sub(l.contactName, l.location, l.channel === "email" ? "Email" : "LinkedIn", l.archived ? "Archived" : null),
          href: `/pipeline/${l.id}`,
        })),
        ...candidates.map((c) => ({ kind: "Discovery", title: c.clinicName, sub: sub(c.contactName, c.location), href: `/discovery/${c.id}` })),
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
