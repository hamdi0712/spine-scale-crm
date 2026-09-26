"use server";

// Saving, listing, reopening and deleting conversations with Iman.
//
// This file is the persistence layer around the copilot. It is deliberately
// separate from src/lib/actions/copilot.ts, which is the model call and the
// tool loop and is unchanged by any of this: askIman below calls askCopilot
// exactly as the old panel did, and every guarantee that action makes — the
// fixed lookup set, no write anywhere behind it, the fenced third-party text —
// still holds word for word.
//
// Two things this arrangement is stricter about than the panel was.
//
//   The history replayed to the model is read here, from the conversation's
//   own stored turns, rather than sent up by the browser. The old panel had to
//   send it because there was nowhere else it lived; now there is, and the
//   browser no longer has a say in what the model is told was said earlier.
//
//   The assistant turn that gets stored is the one askCopilot returned, in the
//   same call. There is no action that takes an answer from the page and
//   writes it down, so a tampered page cannot put words in Iman's mouth and
//   have them read back as history tomorrow.
//
// The stored receipt (which lookups ran) is never replayed. It is a caption
// drawn under an answer; the model gets prose and nothing else, which is the
// same rule as before — see sanitiseHistory in src/lib/copilot.ts. A proposed
// action is not replayed either, for a stronger version of the same reason: the
// card is a thing the operator acts on, not a turn in the conversation, and a
// model reading "you proposed this an hour ago" back out of its own history is a
// model that will assume it went through.
//
// A proposal is attached to the assistant turn it was made in, so reopening a
// conversation draws the card back where it was with whatever became of it —
// confirmed, cancelled, or expired unconfirmed. Nothing here can execute one:
// the only things that can are the two server actions in
// src/lib/actions/copilotActions.ts, which a person's click calls.

import { prisma } from "@/lib/prisma";
import { askCopilot } from "@/lib/actions/copilot";
import {
  COPILOT_HISTORY_TURNS,
  COPILOT_QUESTION_MAX_CHARS,
  CopilotTurn,
} from "@/lib/copilot";
import { readCopilotActionViews } from "@/lib/copilotActionStore";
import {
  ConversationSummary,
  StoredConversation,
  StoredMessage,
  conversationTitleFrom,
  decodeToolsUsed,
  encodeToolsUsed,
} from "@/lib/copilotChat";

// What a question comes back as: the conversation it now belongs to (created
// on the spot if this was the first thing said), and the two turns to draw.
// The reply is an assistant turn or an error turn — a failure is a bubble in
// the thread here as it was in the panel, not a banner over it.
export interface AskImanResult {
  conversationId: string;
  title: string;
  question: StoredMessage;
  reply: StoredMessage;
  // The history list as it stands after this turn, so the dropdown reorders
  // without a second round trip.
  conversations: ConversationSummary[];
}

export async function askIman(
  conversationId: string | null,
  question: string,
): Promise<AskImanResult | null> {
  const asked = typeof question === "string" ? question.trim() : "";
  if (asked === "") return null;

  // An id from the page is only ever used to find a row. A conversation that
  // has been deleted in another tab reads as no history rather than as an
  // error, and the turn below starts a new conversation for it.
  const existing =
    typeof conversationId === "string" && conversationId !== ""
      ? await prisma.copilotConversation.findUnique({
          where: { id: conversationId },
          select: { id: true },
        })
      : null;

  const history = existing ? await readHistory(existing.id) : [];
  const result = await askCopilot(asked, history);

  const stored = result.ok
    ? { role: "assistant" as const, content: result.answer, toolsUsed: result.toolsUsed }
    : { role: "error" as const, content: result.error, toolsUsed: [] as string[] };

  // The first message is what creates the record — a conversation nobody has
  // said anything in is not worth a row, which is why New Chat writes nothing.
  const conversation = existing
    ? await prisma.copilotConversation.update({
        where: { id: existing.id },
        // Touched even though no column changes, so the history list orders by
        // when a conversation was last used rather than when it was started.
        data: { updatedAt: new Date() },
        select: { id: true, title: true },
      })
    : await prisma.copilotConversation.create({
        data: { title: conversationTitleFrom(asked) },
        select: { id: true, title: true },
      });

  const from = await prisma.copilotMessage.count({
    where: { conversationId: conversation.id },
  });

  const questionRow = await prisma.copilotMessage.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: asked.slice(0, COPILOT_QUESTION_MAX_CHARS),
      position: from,
    },
  });
  const proposal = result.ok ? (result.proposal ?? null) : null;

  const replyRow = await prisma.copilotMessage.create({
    data: {
      conversationId: conversation.id,
      role: stored.role,
      content: stored.content,
      toolsUsed: encodeToolsUsed(stored.toolsUsed),
      position: from + 1,
      copilotActionId: proposal?.id ?? null,
    },
  });

  // The other half of the link, so the proposal knows its turn. Unique on the
  // proposal side: one row belongs to one turn, and a second turn cannot claim
  // a proposal that has already been drawn somewhere else.
  if (proposal) {
    await prisma.copilotAction.update({
      where: { id: proposal.id },
      data: { messageId: replyRow.id },
    });
  }

  return {
    conversationId: conversation.id,
    title: conversation.title,
    question: toStoredMessage(questionRow),
    reply: { ...toStoredMessage(replyRow), proposal },
    conversations: await listCopilotConversations(),
  };
}

export async function listCopilotConversations(): Promise<ConversationSummary[]> {
  const rows = await prisma.copilotConversation.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

// Reopening a conversation: the whole thread, receipts included, in the order
// it was said. A missing id is null rather than a throw — the row may have
// been deleted in another tab, and the page treats that as a new chat.
export async function loadCopilotConversation(
  id: string,
): Promise<StoredConversation | null> {
  if (typeof id !== "string" || id === "") return null;
  const row = await prisma.copilotConversation.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      messages: { orderBy: { position: "asc" } },
    },
  });
  if (!row) return null;

  // The cards for the turns that proposed something, read in one query and
  // freshly: a proposal drawn from yesterday's conversation has to show that it
  // expired rather than offering a Confirm that will refuse.
  const actions = await readCopilotActionViews(
    row.messages
      .map((message) => message.copilotActionId)
      .filter((id): id is string => typeof id === "string" && id !== ""),
  );

  return {
    id: row.id,
    title: row.title,
    messages: row.messages.map((message) => ({
      ...toStoredMessage(message),
      proposal:
        message.copilotActionId === null
          ? null
          : (actions[message.copilotActionId] ?? null),
    })),
  };
}

// Deleting one from the history list. The messages go with it on the schema's
// cascade rather than in a second statement here, so there is no path that
// leaves a thread behind its conversation.
export async function deleteCopilotConversation(
  id: string,
): Promise<ConversationSummary[]> {
  if (typeof id === "string" && id !== "") {
    // deleteMany rather than delete: deleting a row that another tab already
    // deleted is a no-op, not an error to show somebody.
    await prisma.copilotConversation.deleteMany({ where: { id } });
  }
  return listCopilotConversations();
}

// The prose turns of a conversation, newest last, as the model is given them.
// Errors are dropped — they are the app's words, not the conversation's — and
// the tail is taken here so a long thread does not grow the request forever.
// sanitiseHistory in the action below trims it again to the same ceiling.
async function readHistory(conversationId: string): Promise<CopilotTurn[]> {
  const rows = await prisma.copilotMessage.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { position: "asc" },
    select: { role: true, content: true },
  });
  return rows
    .slice(-COPILOT_HISTORY_TURNS)
    .map((row) => ({
      role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: row.content,
    }));
}

function toStoredMessage(row: {
  id: string;
  role: string;
  content: string;
  toolsUsed: string;
}): StoredMessage {
  return {
    id: row.id,
    role:
      row.role === "assistant" || row.role === "error"
        ? row.role
        : "user",
    content: row.content,
    toolsUsed: decodeToolsUsed(row.toolsUsed),
  };
}
