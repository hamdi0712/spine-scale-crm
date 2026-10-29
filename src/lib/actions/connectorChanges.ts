"use server";

// The Undo button on a change Claude made through the connector. Takes the
// change's id and nothing else; what is restored is read off the stored row.

import { revalidatePath } from "next/cache";
import { UndoOutcome, undoConnectorChangeById } from "@/lib/mcpWrites";

export async function undoConnectorChange(id: unknown): Promise<UndoOutcome> {
  const outcome = await undoConnectorChangeById(typeof id === "string" ? id : "");
  for (const path of ["/", "/activity", "/pipeline", "/activities", "/tasks"]) revalidatePath(path);
  return outcome;
}
