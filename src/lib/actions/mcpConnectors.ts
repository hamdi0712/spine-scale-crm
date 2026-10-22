"use server";

// The off-switch for the Claude connector: revoke one client's access, or
// everyone's. Revoking deletes the client's registration along with its codes
// and tokens, so the next call it makes is refused and getting back in means
// clicking Connect in Claude and typing the app password again.

import { revalidatePath } from "next/cache";
import { revokeAllConnectorAccess, revokeClient } from "@/lib/mcpOAuth";

export async function revokeConnectorClientAction(formData: FormData): Promise<void> {
  const id = formData.get("clientId");
  if (typeof id !== "string" || !id) return;
  await revokeClient(id);
  revalidatePath("/settings/connectors");
}

export async function revokeAllConnectorAccessAction(): Promise<void> {
  await revokeAllConnectorAccess();
  revalidatePath("/settings/connectors");
}
