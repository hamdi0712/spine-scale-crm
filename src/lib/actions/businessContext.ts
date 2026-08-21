"use server";

// Saving the business context — the one write behind the Settings section.
//
// It takes the whole body, because that is how the page is used: one textarea,
// one Save. Everything crossing this boundary is untrusted and read through
// readBusinessContext in src/lib/businessContext.ts, which trims it and holds
// it to the character ceiling.
//
// Saving an empty page is a real thing to do and is stored as one: the copilot
// then runs on exactly the prompt it had before this feature existed.

import { revalidatePath } from "next/cache";
import { readBusinessContext } from "@/lib/businessContext";
import { saveBusinessContext } from "@/lib/businessContextStore";

export async function saveBusinessContextAction(
  formData: FormData,
): Promise<void> {
  await saveBusinessContext(readBusinessContext(formData.get("body")));

  // The page that shows the body and its timestamp. The copilot reads the row
  // live on every question, so there is nothing further to invalidate — a rule
  // typed here is in force on the next question without one.
  revalidatePath("/settings/business-context");
}
