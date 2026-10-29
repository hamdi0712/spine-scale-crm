// Reading and writing the one email settings row.
//
// Server-only, and not a "use server" module, on the same terms as
// src/lib/pipelineSettingsStore.ts. A fresh install has no row and runs the
// starter templates, which say so wherever an email is drafted.

import { prisma } from "@/lib/prisma";
import {
  EMAIL_SETTINGS_ID,
  EmailSettingsValues,
  emailSettingsRow,
  readEmailSettings,
} from "@/lib/emailWorkflow";

export async function loadEmailSettings(): Promise<EmailSettingsValues> {
  const row = await prisma.emailSettings.findUnique({ where: { id: EMAIL_SETTINGS_ID } });
  return readEmailSettings(row);
}

export async function saveEmailSettingsRow(settings: EmailSettingsValues): Promise<void> {
  const data = emailSettingsRow(settings);
  await prisma.emailSettings.upsert({
    where: { id: EMAIL_SETTINGS_ID },
    create: { id: EMAIL_SETTINGS_ID, ...data },
    update: data,
  });
}
