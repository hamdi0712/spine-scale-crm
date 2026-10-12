"use server";

// The writes behind Settings → ICP.
//
// Everything posted is read through src/lib/icpDefinition.ts, the same module
// that reads a stored row, so a tag saved here is a tag the scorer can match:
// trimmed, lowercased, kept once.
//
// One active ICP at a time is held here, by the only two writes that can set
// isActive. Each clears every other row in the same transaction, so there is
// no moment at which two are active.
//
// None of this re-scores anything. A candidate scored last week was scored
// against the definition as it stood then, and its stored breakdown says so;
// editing the ICP changes what the next run is measured against.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  ICP_TAG_FIELDS,
  orderedSize,
  readLongText,
  readName,
  readSize,
  serializeTags,
} from "@/lib/icpDefinition";

function revalidateIcp(id?: string) {
  revalidatePath("/settings/icp");
  if (id) revalidatePath(`/settings/icp/${id}`);
  revalidatePath("/discovery");
  revalidatePath("/discovery/compare");
}

export async function saveIcpDefinition(id: string, formData: FormData) {
  const existing = await prisma.icpDefinition.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) redirect("/settings/icp");

  const tags = Object.fromEntries(
    // Each chip posts one hidden input under its list's name, so a list is
    // every value under that name, in the order the chips were added.
    ICP_TAG_FIELDS.map((field) => [field, serializeTags(formData.getAll(field) as string[])]),
  );
  const { sizeMin, sizeMax } = orderedSize(
    readSize(formData.get("sizeMin")),
    readSize(formData.get("sizeMax")),
  );

  await prisma.icpDefinition.update({
    where: { id },
    data: {
      name: readName(formData.get("name")) || "Untitled ICP",
      description: readLongText(formData.get("description")),
      ...tags,
      sizeMin,
      sizeMax,
      painPoints: readLongText(formData.get("painPoints")),
      buyingTriggers: readLongText(formData.get("buyingTriggers")),
      disqualifiers: readLongText(formData.get("disqualifiers")),
    },
  });

  revalidateIcp(id);
  redirect(`/settings/icp?saved=${encodeURIComponent(id)}`);
}

// A blank definition, inactive, and straight to its edit page. Inactive on
// purpose: creating one should never change what the queue scores against.
export async function createIcpDefinition() {
  const created = await prisma.icpDefinition.create({
    data: { name: "New ICP", isActive: false },
    select: { id: true },
  });
  revalidateIcp();
  redirect(`/settings/icp/${created.id}`);
}

// The list page's toggle. Turning one on turns every other off in the same
// transaction; turning the active one off leaves none active, which the list
// page then warns about rather than quietly picking another.
export async function setIcpDefinitionActive(id: string, active: boolean) {
  const existing = await prisma.icpDefinition.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return;

  if (active) {
    await prisma.$transaction([
      prisma.icpDefinition.updateMany({
        where: { isActive: true, NOT: { id } },
        data: { isActive: false },
      }),
      prisma.icpDefinition.update({ where: { id }, data: { isActive: true } }),
    ]);
  } else {
    await prisma.icpDefinition.update({ where: { id }, data: { isActive: false } });
  }
  revalidateIcp(id);
}

// Deleting is offered only for an inactive definition. The active one is what
// the queue would score against, and removing it should be two deliberate
// steps — switch another on, then delete — rather than one.
export async function deleteIcpDefinition(id: string) {
  const existing = await prisma.icpDefinition.findUnique({
    where: { id },
    select: { isActive: true },
  });
  if (!existing || existing.isActive) redirect(`/settings/icp/${id}`);
  await prisma.icpDefinition.delete({ where: { id } });
  revalidateIcp();
  redirect("/settings/icp");
}
