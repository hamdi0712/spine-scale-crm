"use client";

// The AI Copilot panel — the chat half of the feature.
//
// A docked column on the right, opened from the sidebar. It asks
// src/lib/actions/copilot.ts a question, shows what comes back, and does
// nothing else: there is no action in this file, nothing is written anywhere,
// and the copilot itself has no tool that could change a record either. The
// footer says so, because a chat box in a CRM looks like something you can
// tell to do things and it is worth being honest about the fact that you
// cannot.
//
// The conversation lives in this component's state and nowhere else. Closing
// the panel keeps it — the component stays mounted and is hidden rather than
// unmounted — and reloading the page loses it. That is deliberate for now: the
// value is in the answer, not in the transcript, and a table of stored chats
// is worth adding only if it turns out anybody wants to go back to one.
//
// What goes back to the server on each question is the prose turns above it
// and nothing more. The panel never holds, and so can never return, a lookup
// result — those are gathered server-side per question, which is what stops a
// tampered page inventing facts for the model to repeat.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { askCopilot } from "@/lib/actions/copilot";
import {
  COPILOT_QUESTION_MAX_CHARS,
  CopilotTurn,
} from "@/lib/copilot";
import AiMark from "@/components/AiMark";
import Icon from "@/components/Icons";

// What the panel shows. "error" is a bubble rather than a banner because a
// failure answers a specific question and belongs in the thread beside it —
// and it is kept out of the history sent back up, since a failure is not
// something the model said.
interface Bubble {
  id: number;
  role: "user" | "assistant" | "error";
  content: string;
  toolsUsed?: string[];
}

// Openers, for a panel nobody has typed in yet. Each is a real question the
// lookups can answer, so the first thing anybody tries works.
const SUGGESTIONS = [
  "What needs my attention today?",
  "Which clients are at risk, and why?",
  "Summarise my A-tier leads.",
  "How is the discovery queue doing?",
];

// The lookups, named the way a person would say them. The reply's receipt
// shows these rather than the function names — "Client health" says what was
// read; getClientHealthSummary says what was called.
const TOOL_LABELS: Record<string, string> = {
  getPipelineLeads: "Pipeline",
  getLeadDetail: "Lead record",
  getDiscoveryQueueStatus: "Discovery queue",
  getClientHealthSummary: "Client health",
  getClientDetail: "Client record",
  getReportingTrends: "Reporting",
  getFollowUpsDue: "Follow-ups",
  getRecentActivity: "Activity log",
};

export default function CopilotPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(0);

  // Follow the conversation down as it grows, and again when the panel is
  // reopened onto an existing one.
  useEffect(() => {
    if (open) threadEnd.current?.scrollIntoView({ block: "end" });
  }, [bubbles, asking, open]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Escape closes it, as it does for anything that sits over the page.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function ask(text: string) {
    const asked = text.trim();
    if (asked === "" || asking) return;

    // The prose turns so far, which is everything the server is given besides
    // the question. Errors are dropped: they are this panel's words, not the
    // conversation's.
    const history: CopilotTurn[] = bubbles
      .filter((b): b is Bubble & { role: "user" | "assistant" } =>
        b.role !== "error",
      )
      .map((b) => ({ role: b.role, content: b.content }));

    setBubbles((prev) => [
      ...prev,
      { id: nextId.current++, role: "user", content: asked },
    ]);
    setQuestion("");
    setAsking(true);
    try {
      const result = await askCopilot(asked, history);
      setBubbles((prev) => [
        ...prev,
        result.ok
          ? {
              id: nextId.current++,
              role: "assistant",
              content: result.answer,
              toolsUsed: result.toolsUsed,
            }
          : { id: nextId.current++, role: "error", content: result.error },
      ]);
    } catch {
      // The action itself failed to run — the server is down, or the request
      // was cut off on the way. Everything inside it already reports its own
      // failures in words, so this is the one case left.
      setBubbles((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "error",
          content:
            "The copilot could not be reached. Check the server is still up and ask again.",
        },
      ]);
    } finally {
      setAsking(false);
      input.current?.focus();
    }
  }

  return (
    <aside
      // Hidden rather than unmounted: the conversation is this component's
      // state, and closing the panel is not meant to throw it away.
      className={`fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-ai/25 bg-surface shadow-[0_0_40px_rgba(28,27,39,0.12)] sm:w-[420px] ${
        open ? "" : "hidden"
      }`}
      aria-label="AI Copilot"
      aria-hidden={!open}
    >
      <header className="flex items-center gap-3 border-b border-line/70 px-5 py-4">
        <AiMark size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="display text-base font-semibold">AI Copilot</h2>
          <p className="truncate text-xs text-muted">
            Answers from your own records
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI Copilot"
          className="rounded-[10px] p-2 text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ai/40"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {bubbles.length === 0 ? (
          <div className="pt-6 text-center">
            <span className="inline-flex">
              <AiMark />
            </span>
            <p className="mt-3 text-sm font-medium">Ask about anything in here</p>
            <p className="mx-auto mt-1 max-w-[280px] text-xs leading-relaxed text-muted">
              It looks up your pipeline, clients, discovery queue and reporting
              to answer. It can read all of it and change none of it.
            </p>
            <div className="mt-5 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="block w-full rounded-[10px] border border-line bg-wash/40 px-3.5 py-2.5 text-left text-xs text-ink hover:border-ai/30 hover:bg-wash/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ai/40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          bubbles.map((bubble) => <BubbleRow key={bubble.id} bubble={bubble} />)
        )}

        {asking && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="flex gap-1" aria-hidden>
              <Dot delay="0ms" />
              <Dot delay="150ms" />
              <Dot delay="300ms" />
            </span>
            Looking it up…
          </div>
        )}
        <div ref={threadEnd} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="border-t border-line/70 px-5 py-4"
      >
        <div className="flex items-end gap-2">
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
            rows={2}
            disabled={asking}
            placeholder="Ask about a lead, a client, the queue…"
            aria-label="Ask the AI Copilot"
            className="field !min-h-0 flex-1 resize-none py-2.5 text-sm disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={asking || question.trim() === ""}
            aria-label="Send"
            title="Ask"
            className="btn-ai h-[42px] w-[42px] justify-center !px-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="arrowUp" className="h-[18px] w-[18px]" />
          </button>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted">
          Reads your records to answer. It cannot change anything — no edits, no
          messages, no scheduling.
        </p>
      </form>
    </aside>
  );
}

function BubbleRow({ bubble }: { bubble: Bubble }) {
  if (bubble.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-[14px] rounded-br-[6px] bg-accent px-3.5 py-2.5 text-sm text-white">
          {bubble.content}
        </p>
      </div>
    );
  }

  // A failure wears the same shape as an answer in the same colours the rest
  // of the app reports one in, so it reads as this question's reply rather
  // than as something wrong with the page.
  if (bubble.role === "error") {
    return (
      <div className="max-w-[92%] rounded-[14px] rounded-bl-[6px] border border-bad/30 bg-bad-soft/60 px-3.5 py-2.5">
        <p className="text-xs font-medium text-bad">No answer</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {bubble.content}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[92%]">
      {/* Answers come back as markdown, rendered on the library's own
          typographic defaults. The last-child rule drops the trailing margin
          .prose-doc puts under every paragraph and list, which inside a
          bubble is a gap under the text rather than space between blocks. */}
      <div className="prose-doc rounded-[14px] rounded-bl-[6px] border border-line bg-wash/50 px-3.5 py-2.5 text-sm [&>*:last-child]:mb-0">
        <ReactMarkdown>{bubble.content}</ReactMarkdown>
      </div>
      {bubble.toolsUsed && bubble.toolsUsed.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Read</span>
          {bubble.toolsUsed.map((tool) => (
            <span key={tool} className="chip-stat">
              {TOOL_LABELS[tool] ?? tool}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai"
      style={{ animationDelay: delay }}
    />
  );
}
