// Saved conversations with Iman — the shapes the page and the actions agree
// on, and the two pure functions between them.
//
// Nothing here touches Prisma or the network. The reads and writes live in
// src/lib/actions/copilotChat.ts; the model call is still the one in
// src/lib/actions/copilot.ts and is not changed by any of this.
//
// The rule that matters is at the bottom of the file: what comes out of the
// database goes back to the model as prose or not at all. A stored receipt is
// something to draw under an answer, never a tool result to feed back in — the
// same reason the browser was never allowed to send one.

// A saved turn as the page draws it. Same three roles the panel had, because
// it is the same thread: an error is stored so that reopening a conversation
// shows what it actually looked like.
export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  toolsUsed: string[];
}

// One row of the Chat History dropdown.
export interface ConversationSummary {
  id: string;
  title: string;
  // Serialised, because this crosses the server/client boundary and is only
  // ever used to sort and to caption.
  updatedAt: string;
}

export interface StoredConversation {
  id: string;
  title: string;
  messages: StoredMessage[];
}

// Long enough to tell two conversations apart in a dropdown, short enough not
// to wrap in one.
export const CONVERSATION_TITLE_MAX_CHARS = 60;

// The title a conversation gets from the first thing typed into it.
//
// Nobody names a chat before having it, so this is generated rather than
// asked for: newlines collapsed so a pasted paragraph does not become a
// three-line row, trimmed to a phrase, and an ellipsis only when something was
// actually cut. An empty first message cannot happen — the page will not send
// one — but "New chat" is the honest answer if it ever did.
export function conversationTitleFrom(firstMessage: string): string {
  const flat = firstMessage.replace(/\s+/g, " ").trim();
  if (flat === "") return "New chat";
  if (flat.length <= CONVERSATION_TITLE_MAX_CHARS) return flat;
  return `${flat.slice(0, CONVERSATION_TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

// The receipt, on the way in and out of a text column. SQLite has no array,
// so the lookup names travel as JSON; anything that does not read back as an
// array of strings reads back as no receipt at all, which loses a caption and
// nothing else.
export function encodeToolsUsed(tools: string[] | undefined): string {
  if (!tools || tools.length === 0) return "";
  return JSON.stringify(tools.filter((t) => typeof t === "string"));
}

export function decodeToolsUsed(stored: string): string[] {
  if (stored === "") return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}
