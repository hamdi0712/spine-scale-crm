// The addresses to check, as a CSV: every live email-channel lead whose
// current address has never been checked. Behind the session like every other
// route (src/middleware.ts).

import { prisma } from "@/lib/prisma";
import { PIPELINE_DEFAULT_WHERE } from "@/lib/liveLeadWhere";
import { checkExportCsv } from "@/lib/emailWorkflow";

export const dynamic = "force-dynamic";

export async function GET() {
  const leads = await prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, channel: "email", email: { not: null }, NOT: { email: "" }, emailStatus: null },
    select: { id: true, clinicName: true, email: true },
    orderBy: { clinicName: "asc" },
  });
  const csv = checkExportCsv(leads.map((l) => ({ id: l.id, clinicName: l.clinicName, email: (l.email ?? "").trim() })));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="emails-to-check-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
