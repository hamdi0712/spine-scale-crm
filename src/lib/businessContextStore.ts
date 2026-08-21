// Reading and writing the one business-context row.
//
// Server-only, and deliberately not a "use server" module — the same shape
// src/lib/pipelineSettingsStore.ts and src/lib/appSecretsStore.ts have, for the
// same reason: the copilot reads this on its way out to the model, and that is
// not an endpoint the browser is allowed to call. The form's save action lives
// in src/lib/actions/businessContext.ts and comes through here too.
//
// Nothing is cached. A cached body would survive the save that replaced it,
// and the point of the page is that a rule typed there applies to the next
// question asked.

import { prisma } from "@/lib/prisma";
import {
  BUSINESS_CONTEXT_ID,
  BusinessContextState,
} from "@/lib/businessContext";

// A missing row is the normal state of a fresh install, so it reads as an empty
// body rather than as an error — which is what makes the copilot's prompt
// identical to what it was before this table existed.
export async function loadBusinessContext(): Promise<BusinessContextState> {
  const row = await prisma.businessContext.findUnique({
    where: { id: BUSINESS_CONTEXT_ID },
    select: { body: true, updatedAt: true },
  });
  return { body: row?.body ?? "", updatedAt: row?.updatedAt ?? null };
}

// Just the text, for the one caller that only needs to know what to prepend.
export async function readBusinessContextBody(): Promise<string> {
  const { body } = await loadBusinessContext();
  return body;
}

// An upsert on the fixed id, so saving from a fresh install creates the row and
// saving again updates it. There is no delete: clearing the page saves an empty
// body, which is the same thing to every reader and keeps the updatedAt that
// says when it was cleared.
export async function saveBusinessContext(body: string): Promise<void> {
  await prisma.businessContext.upsert({
    where: { id: BUSINESS_CONTEXT_ID },
    create: { id: BUSINESS_CONTEXT_ID, body },
    update: { body },
  });
}
