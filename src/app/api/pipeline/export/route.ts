// The Pipeline page's "Export for review" download — see src/lib/pipelineExport.ts.

import { prisma } from "@/lib/prisma";
import { PIPELINE_DEFAULT_WHERE } from "@/lib/liveLeadWhere";
import { pipelineExportCsv } from "@/lib/pipelineExport";

export const dynamic = "force-dynamic";

export async function GET() {
  const leads = await prisma.lead.findMany({
    where: { ...PIPELINE_DEFAULT_WHERE, stage: { not: "LOST" } },
    include: {
      outreach: {
        where: { sentAt: { not: null } },
        select: { step: true, messageMechanism: true, sentAt: true },
      },
      notes: { select: { body: true, createdAt: true } },
      calls: { select: { createdAt: true } },
    },
  });

  const now = new Date();
  const filename = `pipeline-review-${now.toISOString().slice(0, 10)}.csv`;
  return new Response(pipelineExportCsv(leads, now), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
