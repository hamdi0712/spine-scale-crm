// Reading ICP Definitions.
//
// Server-only and deliberately not a "use server" module, on the same terms as
// src/lib/pipelineSettingsStore.ts: the queue, the comparison run and the
// outreach sequence all load the active ICP on their way through, and none of
// them is an endpoint the browser may call. Every row comes back through
// readIcpDefinition, so a hand-edited one still reads as a definition.

import { prisma } from "@/lib/prisma";
import { IcpDefinitionData, readIcpDefinition } from "@/lib/icpDefinition";

// The one the scorer uses. Null when none is active — the new model then has
// nothing to judge against, and every caller says so rather than guessing.
//
// "Most recently updated" breaks a tie that the save actions never let happen,
// so a database somebody edited by hand still has one answer.
export async function loadActiveIcp(): Promise<IcpDefinitionData | null> {
  const row = await prisma.icpDefinition.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  return row ? readIcpDefinition(row) : null;
}

export async function listIcpDefinitions(): Promise<IcpDefinitionData[]> {
  const rows = await prisma.icpDefinition.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(readIcpDefinition);
}

export async function loadIcpDefinition(
  id: string,
): Promise<IcpDefinitionData | null> {
  const row = await prisma.icpDefinition.findUnique({ where: { id } });
  return row ? readIcpDefinition(row) : null;
}
