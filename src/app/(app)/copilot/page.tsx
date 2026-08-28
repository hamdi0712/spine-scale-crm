// Iman's page.
//
// The server half is one read: the saved conversations, newest first, so the
// Chat History dropdown is populated on first paint rather than after a
// round trip. Everything else — the thread, the composer, the asking — is the
// client component, because a conversation is state and not a document.
//
// Landing here always starts a fresh, unsaved chat. Reopening the last one
// would be a guess about why somebody came, and the history dropdown is one
// click away.

import CopilotPage from "@/components/CopilotPage";
import { listCopilotConversations } from "@/lib/actions/copilotChat";

export const metadata = { title: "Iman" };

// The conversation list changes on every question asked, so there is nothing
// here worth caching between visits.
export const dynamic = "force-dynamic";

export default async function Page() {
  const conversations = await listCopilotConversations();
  return <CopilotPage initialConversations={conversations} />;
}
