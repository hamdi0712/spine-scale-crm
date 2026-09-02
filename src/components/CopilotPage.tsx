"use client";

// Iman — the copilot's page.
//
// This is the presentation the docked panel used to be. What it asks and what
// it is allowed to know has not moved: every question still goes through
// src/lib/actions/copilot.ts, which is the fixed lookup set, the read-only
// posture and the fenced third-party text, unchanged. What is new around it is
// the page and the saving — src/lib/actions/copilotChat.ts.
//
// The one thing that changed in how a question is asked: the history replayed
// to the model is now read on the server from the conversation's own rows
// rather than sent up from here. This component no longer holds anything the
// model is told, which is a stronger version of the rule the panel had — it
// could never send a lookup result, and now it cannot send a transcript
// either.
//
// A conversation with nothing said in it is not saved. `conversationId` is
// null until the first question comes back with the row it created.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { IconSparkles, IconTrash } from "@tabler/icons-react";
import {
  askIman,
  deleteCopilotConversation,
  loadCopilotConversation,
} from "@/lib/actions/copilotChat";
import { COPILOT_QUESTION_MAX_CHARS } from "@/lib/copilot";
import { ConversationSummary, StoredMessage } from "@/lib/copilotChat";
import Icon from "@/components/Icons";
import ImanAvatar from "@/components/ImanAvatar";

// The quick starts behind the sparkle. Each is a real question the lookups can
// answer, so the first thing anybody tries works; the subtitle says what it
// will actually go and read, because "focus on today" could mean anything
// until you know it means the checklist and the follow-ups.
const SUGGESTIONS: { title: string; hint: string; prompt: string }[] = [
  {
    title: "What should I focus on today",
    hint: "The daily checklist, follow-ups due and anything overdue",
    prompt: "What should I focus on today?",
  },
  {
    title: "Show me A-tier leads not yet contacted",
    hint: "The pipeline, filtered to the best-scoring leads with no outreach",
    prompt:
      "Which A-tier leads in the pipeline have not been contacted yet? List them with their score and location.",
  },
  {
    title: "Summarise this week's client health",
    hint: "Every client's status, and what is behind the ones at risk",
    prompt:
      "Summarise this week's client health. Which clients are at risk, and why?",
  },
  {
    title: "Draft a follow-up message",
    hint: "Reads the lead's record and the library, then writes the message",
    prompt:
      "Draft a follow-up message for the lead I should chase first today. Use what is on their record and the copy in the library.",
  },
];

// The lookups, named the way a person would say them. The receipt under a
// reply shows these rather than the function names — "Client health" says what
// was read; getClientHealthSummary says what was called.
const TOOL_LABELS: Record<string, string> = {
  getPipelineLeads: "Pipeline",
  searchLeads: "Lead search",
  getLeadDetail: "Lead record",
  getDiscoveryQueueStatus: "Discovery queue",
  getClientHealthSummary: "Client health",
  getClientDetail: "Client record",
  getReportingTrends: "Reporting",
  getFollowUpsDue: "Follow-ups",
  getRecentActivity: "Activity log",
  getTasks: "Tasks",
  getDailyChecklistStatus: "Daily checklist",
  getOutreachFunnel: "Funnel",
  getDiscoveryCandidates: "Discovery",
  getDiscoveryCandidateDetail: "Candidate record",
  getCalls: "Call log",
  getAdHubResearch: "Ad Hub research",
  getAdHubConcepts: "Ad Hub concepts",
  getCreativeDetail: "Creative",
  getLibraryEntries: "Library",
  getPipelineSettings: "Pipeline settings",
  getActivityTrend: "Activity trend",
  getBusinessHoursStatus: "US business hours",
  getDailyKpiStatus: "Daily KPI",
  getLeadOutreachLog: "Outreach log",
  getOutreachFunnelSummary: "Outreach conversion",
};

export default function CopilotPage({
  initialConversations,
}: {
  initialConversations: ConversationSummary[];
}) {
  // The list owns itself from here: every action that changes it hands back
  // the whole list, so the dropdown never has to guess at the new order.
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(initialConversations);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const threadEnd = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // Bubbles the page itself puts in the thread — the one case a failure has
  // nothing stored behind it, because the request never reached the server.
  const localId = useRef(0);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, asking]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Escape closes whichever overlay is open, in the order they sit above the
  // page: the popover first, then the dropdown.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (suggestionsOpen) setSuggestionsOpen(false);
      else if (historyOpen) setHistoryOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [suggestionsOpen, historyOpen]);

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setQuestion("");
    setHistoryOpen(false);
    setSuggestionsOpen(false);
    input.current?.focus();
  }

  async function openConversation(id: string) {
    setHistoryOpen(false);
    setSuggestionsOpen(false);
    setLoading(true);
    try {
      const loaded = await loadCopilotConversation(id);
      if (loaded) {
        setConversationId(loaded.id);
        setMessages(loaded.messages);
      } else {
        // Deleted somewhere else since the list was drawn. Nothing to reopen,
        // so this is a fresh chat rather than an error.
        setConversations((prev) => prev.filter((c) => c.id !== id));
        newChat();
      }
    } catch {
      setConversations((prev) => prev);
    } finally {
      setLoading(false);
      input.current?.focus();
    }
  }

  async function remove(summary: ConversationSummary) {
    if (
      !window.confirm(
        `Delete “${summary.title}”? The whole conversation goes with it, and this cannot be undone.`,
      )
    ) {
      return;
    }
    const next = await deleteCopilotConversation(summary.id);
    setConversations(next);
    // The open conversation was the one deleted: there is nothing left to show
    // and nothing to append to, so the page goes back to a fresh chat.
    if (conversationId === summary.id) newChat();
  }

  async function ask(text: string) {
    const asked = text.trim();
    if (asked === "" || asking) return;

    setSuggestionsOpen(false);
    setQuestion("");
    setAsking(true);
    // Shown immediately under its own local id, then replaced by the stored
    // row when the answer lands — the wait is the length of a model call and
    // watching your own question appear after it is the wrong way round.
    const pendingId = `pending-${localId.current++}`;
    setMessages((prev) => [
      ...prev,
      { id: pendingId, role: "user", content: asked, toolsUsed: [] },
    ]);

    try {
      const result = await askIman(conversationId, asked);
      if (!result) {
        setMessages((prev) => prev.filter((m) => m.id !== pendingId));
        return;
      }
      setConversationId(result.conversationId);
      setConversations(result.conversations);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== pendingId),
        result.question,
        result.reply,
      ]);
    } catch {
      // The action itself failed to run — the server is down, or the request
      // was cut off on the way. Everything inside it reports its own failures
      // in words, so this is the one case left, and the one bubble on this
      // page with no row behind it.
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${localId.current++}`,
          role: "error",
          content:
            "Iman could not be reached. Check the server is still up and ask again.",
          toolsUsed: [],
        },
      ]);
    } finally {
      setAsking(false);
      input.current?.focus();
    }
  }

  const empty = messages.length === 0 && !asking && !loading;

  return (
    // The page is a column the height of the viewport inside the shell's
    // padding (py-10, so 5rem of it), because the thread scrolls and the input
    // is pinned under it rather than at the bottom of a growing document.
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-line/70 pb-4">
        <ImanAvatar size="sm" />
        <h1 className="display text-base font-semibold text-ink">Iman</h1>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen((o) => !o);
              setSuggestionsOpen(false);
            }}
            aria-expanded={historyOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            Chat History
            <Icon
              name="chevronDown"
              className={`h-4 w-4 ${historyOpen ? "rotate-180" : ""}`}
            />
          </button>
          {historyOpen && (
            <>
              {/* Click-away. A transparent sheet under the menu and over
                  everything else is what closes it, so the next click goes to
                  dismissing rather than to whatever was behind it. */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setHistoryOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div
                role="menu"
                className="absolute left-0 top-full z-40 mt-1.5 max-h-[60vh] w-[320px] overflow-y-auto rounded-[14px] border border-line bg-surface p-1.5 shadow-[var(--shadow-card-hover)]"
              >
                {conversations.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted">
                    No saved conversations yet. The first question you ask saves
                    one.
                  </p>
                ) : (
                  conversations.map((c) => (
                    <div
                      key={c.id}
                      className={`group flex items-center gap-1 rounded-[10px] ${
                        c.id === conversationId ? "bg-wash" : "hover:bg-wash/70"
                      }`}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void openConversation(c.id)}
                        className="min-w-0 flex-1 px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                      >
                        <span className="block truncate text-sm text-ink">
                          {c.title}
                        </span>
                        <span className="block text-xs text-muted">
                          {relativeDay(c.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c)}
                        aria-label={`Delete ${c.title}`}
                        title="Delete conversation"
                        className="mr-1.5 rounded-[8px] p-1.5 text-muted hover:bg-bad-soft hover:text-bad focus:outline-none focus-visible:ring-2 focus-visible:ring-bad/40"
                      >
                        <IconTrash size={16} stroke={1.75} aria-hidden />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={newChat}
          className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          <Icon name="plus" className="h-4 w-4" />
          New Chat
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-6">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ImanAvatar size="hero" />
            <h2 className="display mt-5 text-2xl font-semibold text-ink">
              Ask Iman
            </h2>
            <p className="mt-2 max-w-[440px] text-sm leading-relaxed text-muted">
              Ask me anything about your pipeline, clients, or what to focus on
              today.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {loading ? (
              <p className="text-center text-xs text-muted">
                Opening that conversation…
              </p>
            ) : (
              messages.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))
            )}
            {asking && (
              <div className="motion-bubble-in flex items-start gap-3">
                <ImanAvatar size="sm" className="mt-0.5" />
                <div className="flex items-center gap-2 pt-1.5 text-xs text-muted">
                  <span className="flex gap-1" aria-hidden>
                    <Dot delay="0ms" />
                    <Dot delay="150ms" />
                    <Dot delay="300ms" />
                  </span>
                  Looking it up…
                </div>
              </div>
            )}
            <div ref={threadEnd} />
          </div>
        )}
      </div>

      {/* The composer, pinned under the thread. Sticky rather than fixed so it
          stays inside the shell's column and moves with the sidebar. */}
      <div className="sticky bottom-0 bg-bg pb-1 pt-2">
        <div className="relative mx-auto max-w-3xl">
          {suggestionsOpen && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setSuggestionsOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div className="absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-[16px] border border-line bg-surface p-1.5 shadow-[var(--shadow-card-hover)]">
                <p className="px-3 pb-1.5 pt-2 text-[11px] font-medium tracking-[0.06em] text-muted/80">
                  SUGGESTED ACTIONS
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => void ask(s.prompt)}
                    className="block w-full rounded-[10px] px-3 py-2.5 text-left hover:bg-wash focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                  >
                    <span className="block text-sm font-medium text-ink">
                      {s.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {s.hint}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
            className="rounded-[22px] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)]"
          >
            <textarea
              ref={input}
              value={question}
              onChange={(e) =>
                setQuestion(e.target.value.slice(0, COPILOT_QUESTION_MAX_CHARS))
              }
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — the arrangement
                // every chat box has, and the one people's hands expect.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              rows={1}
              disabled={asking}
              placeholder="Ask Iman anything…"
              aria-label="Ask Iman"
              className="block max-h-40 w-full resize-none border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-muted disabled:opacity-60"
            />
            <div className="mt-3 flex items-center gap-2">
              {/* Placeholder. There is no attachment feature — nothing in this
                  app takes an upload — and the control is drawn disabled
                  rather than left out so the bar is the shape it will be if
                  one ever arrives. */}
              <button
                type="button"
                disabled
                aria-label="Attach (not available)"
                title="Attachments aren't supported yet"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="plus" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSuggestionsOpen((o) => !o)}
                aria-expanded={suggestionsOpen}
                aria-label="Suggested actions"
                title="Suggested actions"
                className={`flex h-8 w-8 items-center justify-center rounded-full border focus:outline-none focus-visible:ring-2 focus-visible:ring-ai/40 ${
                  suggestionsOpen
                    ? "border-ai/40 bg-ai-soft text-ai"
                    : "border-line text-muted hover:bg-wash hover:text-ink"
                }`}
              >
                <IconSparkles size={16} stroke={1.75} aria-hidden />
              </button>
              <div className="flex-1" />
              <button
                type="submit"
                disabled={asking || question.trim() === ""}
                aria-label="Send"
                title="Ask"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="arrowUp" className="h-[18px] w-[18px]" />
              </button>
            </div>
          </form>
          {/* Said here for the same reason the panel said it: a chat box in a
              CRM looks like something you can tell to do things, and it is
              worth being honest that you cannot. */}
          <p className="px-2 pb-2 pt-2 text-center text-xs text-muted">
            Iman reads your records to answer. It cannot change anything — no
            edits, no messages, no scheduling.
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: StoredMessage }) {
  if (message.role === "user") {
    return (
      <div className="motion-bubble-in flex justify-end">
        <p className="max-w-[75%] whitespace-pre-wrap rounded-[16px] rounded-br-[6px] bg-accent px-4 py-2.5 text-sm text-white">
          {message.content}
        </p>
      </div>
    );
  }

  // A failure wears the same shape as an answer in the same colours the rest
  // of the app reports one in, so it reads as this question's reply rather
  // than as something wrong with the page.
  if (message.role === "error") {
    return (
      <div className="motion-bubble-in flex items-start gap-3">
        <ImanAvatar size="sm" className="mt-0.5" />
        <div className="max-w-[80%] rounded-[16px] rounded-tl-[6px] border border-bad/30 bg-bad-soft/60 px-4 py-2.5">
          <p className="text-xs font-medium text-bad">No answer</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="motion-bubble-in flex items-start gap-3">
      <ImanAvatar size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {/* Answers come back as markdown, rendered on the library's own
            typographic defaults. The last-child rule drops the trailing margin
            .prose-doc puts under every paragraph and list, which inside a
            bubble is a gap under the text rather than space between blocks. */}
        <div className="prose-doc rounded-[16px] rounded-tl-[6px] border border-line bg-wash/50 px-4 py-3 text-sm [&>*:last-child]:mb-0">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        {message.toolsUsed.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">Read</span>
            {message.toolsUsed.map((tool) => (
              <span key={tool} className="chip-stat">
                {TOOL_LABELS[tool] ?? tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// When a conversation was last used, said the way the history list wants it:
// close enough to place it, short enough to sit under a title.
function relativeDay(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// One dot of the thinking indicator. The three of them run the same 1.1s cycle
// offset in thirds, so the group reads as a wave rather than as three things
// blinking. The keyframes are in globals.css beside the rest of the motion;
// what is here is only the stagger.
function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="thinking-dot h-1.5 w-1.5 rounded-full bg-ai"
      style={{ animationDelay: delay }}
    />
  );
}
