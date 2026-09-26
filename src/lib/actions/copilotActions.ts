"use server";

// The two things a person can do with a proposal: confirm it, or cancel it.
//
// This file is the entire execution surface of the copilot's action capability,
// and it is two functions long on purpose. Each takes one argument — the id of a
// proposal this server wrote — and nothing else. There is no action here that
// takes a kind, a record id, a stage or a title from the browser, so there is no
// request a tampered page can compose that changes something the server has not
// already written down and shown to somebody.
//
// The model cannot call either of these. It has no tool that reaches a server
// action; the only thing it can do is ask for a proposal, which stops at
// PROPOSED (src/lib/copilotActionStore.ts). Between that stop and this file sits
// a person reading a card.
//
// Both revalidate the feed as well as the record's own page: the executed change
// shows up in Recent Activity marked as an Iman action, and the point of that
// marker is that it is visible on the dashboard immediately rather than after a
// reload.

import { revalidatePath } from "next/cache";
import { CopilotActionOutcome } from "@/lib/copilotActions";
import {
  cancelCopilotActionById,
  executeCopilotActionById,
  readCopilotActionView,
} from "@/lib/copilotActionStore";

export type CopilotActionResult =
  | ({ ok: true } & CopilotActionOutcome)
  // A proposal that is not there any more, or an id that was never one. The
  // card says so and stops offering the buttons.
  | { ok: false; error: string };

/**
 * Confirm a proposal and apply it. The only path in this app by which anything
 * the copilot suggested actually happens.
 */
export async function confirmCopilotAction(
  id: unknown,
): Promise<CopilotActionResult> {
  const actionId = typeof id === "string" ? id : "";
  const outcome = await executeCopilotActionById(actionId);
  if (!outcome.ok) return { ok: false, error: outcome.message };

  // Whatever the change touched, the feed and the dashboard have moved.
  revalidatePath("/");
  revalidatePath("/activities");

  return { ok: true, action: outcome.view, message: outcome.message };
}

export async function cancelCopilotAction(
  id: unknown,
): Promise<CopilotActionResult> {
  const actionId = typeof id === "string" ? id : "";
  const outcome = await cancelCopilotActionById(actionId);
  if (!outcome.ok) return { ok: false, error: outcome.message };
  return { ok: true, action: outcome.view, message: outcome.message };
}

/**
 * Re-read one proposal. The page uses it when a card has been sitting open long
 * enough that what it says about itself may no longer be true — an hour-old
 * proposal has expired, and a card that offers a button which will refuse is
 * worse than one that says so.
 */
export async function refreshCopilotAction(
  id: unknown,
): Promise<CopilotActionResult> {
  const actionId = typeof id === "string" ? id : "";
  const view = await readCopilotActionView(actionId);
  if (!view) return { ok: false, error: "That proposal no longer exists." };
  return { ok: true, action: view, message: "" };
}
