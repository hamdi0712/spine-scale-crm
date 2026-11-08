// The one write path for Ad Hub personas. The app's form actions
// (src/lib/actions/adhub.ts) and the Claude connector's persona tools
// (src/lib/mcpWrites.ts) both call these, so a persona is never written two
// different ways.
//
// Deliberately not a "use server" file: these take plain values, and exporting
// them from one would make each a publicly callable server action.
//
// Server-only.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

// The name plus the framework's six fields, in PERSONA_FIELDS order.
export const PERSONA_WRITE_FIELDS = [
  "name",
  "demographics",
  "wantsToBeSeenAs",
  "believesAboutSelf",
  "wantsToAchieve",
  "triedAndFailed",
  "reasonForFailure",
] as const;

export type PersonaWriteField = (typeof PERSONA_WRITE_FIELDS)[number];
type FrameworkField = Exclude<PersonaWriteField, "name">;
export type PersonaFrameworkValues = Partial<Record<FrameworkField, string | null>>;

function revalidatePersona(id: string) {
  revalidatePath("/ad-hub");
  revalidatePath(`/ad-hub/personas/${id}`);
}

export async function createPersonaRecord(name: string, fields: PersonaFrameworkValues) {
  const persona = await prisma.persona.create({ data: { name, ...fields } });
  revalidatePersona(persona.id);
  return persona;
}

// Changes only the keys present in `patch`; anything left out keeps its value.
export async function updatePersonaRecord(
  id: string,
  patch: Partial<Record<PersonaWriteField, string | null>> & { name?: string },
) {
  const persona = await prisma.persona.update({ where: { id }, data: patch });
  revalidatePersona(id);
  return persona;
}
