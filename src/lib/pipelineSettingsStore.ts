// Reading and writing the one settings row.
//
// Server-only, and deliberately not a "use server" module: the enrichment run
// and the discovery queue both load settings on their way through, and neither
// is an endpoint the browser is allowed to call. The form's save action lives
// in src/lib/actions/pipelineSettings.ts and comes through here too.
//
// Every read goes through readPipelineSettings, so a row written by an older
// build, hand-edited, or missing entirely lands on a working chain rather than
// on an exception. A fresh install has no row and runs the defaults.

import { prisma } from "@/lib/prisma";
import {
  PIPELINE_SETTINGS_ID,
  PipelineSettings,
  pipelineSettingsRow,
  readPipelineSettings,
} from "@/lib/pipelineSettings";

export async function loadPipelineSettings(): Promise<PipelineSettings> {
  const row = await prisma.pipelineSettings.findUnique({
    where: { id: PIPELINE_SETTINGS_ID },
  });
  return readPipelineSettings(row);
}

// An upsert on the fixed id, so saving from a fresh install creates the row
// and saving again updates it. There is no other write path and no delete: the
// way back to the defaults is the Reset button on the form, which saves the
// defaults rather than removing the row.
export async function savePipelineSettings(
  settings: PipelineSettings,
): Promise<void> {
  const data = pipelineSettingsRow(settings);
  await prisma.pipelineSettings.upsert({
    where: { id: PIPELINE_SETTINGS_ID },
    create: { id: PIPELINE_SETTINGS_ID, ...data },
    update: data,
  });
}
