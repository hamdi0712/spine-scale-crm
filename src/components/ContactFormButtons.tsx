"use client";

// The lead page's contact-form launchpad, in the row beside "Visit website":
// open the clinic's contact page, copy the front-desk message to paste into
// it, and mark that it went. Nothing here sends anything.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconCheck } from "@tabler/icons-react";
import { copyText } from "@/lib/emailWorkflow";
import { markContactFormSent } from "@/lib/actions/emailWorkflow";

export default function ContactFormButtons({
  leadId,
  contactFormUrl,
  message,
  lastSentLabel,
}: {
  leadId: string;
  // Null hides the Contact form button: no stored link reads as one.
  contactFormUrl: string | null;
  message: { subject: string; body: string };
  // "Form sent Oct 30, 2026", or null when it never has been.
  lastSentLabel: string | null;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  // Done this visit: the form opened, the message copied. Marking it sent is
  // the one step the record keeps, and once it has, every step reads done.
  const [opened, setOpened] = useState(false);
  const [copiedOnce, setCopiedOnce] = useState(false);
  const [marked, setMarked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(copyText(message.subject, message.body));
      setCopied(true);
      setCopiedOnce(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("The clipboard is not available here.");
    }
  }

  function mark() {
    setError(null);
    start(async () => {
      const r = await markContactFormSent(leadId).catch(() => ({ ok: false as const, error: "It could not be marked." }));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setMarked(true);
      setTimeout(() => setMarked(false), 2500);
      router.refresh();
    });
  }

  let host: string | null = null;
  try {
    host = contactFormUrl ? new URL(contactFormUrl).host.replace(/^www\./, "") + new URL(contactFormUrl).pathname.replace(/\/$/, "") : null;
  } catch {
    host = null;
  }

  const sent = lastSentLabel !== null;
  const steps: { key: string; done: boolean; control: React.ReactNode; note: string }[] = [
    ...(contactFormUrl
      ? [
          {
            key: "open",
            done: sent || opened,
            control: (
              <a href={contactFormUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)} className="text-sm font-semibold text-ink hover:underline">
                Open the form ↗
              </a>
            ),
            note: sent || opened ? "Opened" : "On the clinic's site",
          },
        ]
      : []),
    {
      key: "copy",
      done: sent || copiedOnce,
      control: (
        <button type="button" onClick={() => void copy()} className="text-left text-sm font-semibold text-ink hover:underline">
          {copied ? "Copied" : "Copy message"}
        </button>
      ),
      note: sent || copiedOnce ? "Copied" : "Subject and body",
    },
    {
      key: "mark",
      done: sent,
      control: (
        <button
          type="button"
          onClick={mark}
          disabled={pending}
          title="Logs it in the activity feed and adds a task to call the clinic in 3 days"
          className={sent ? "text-left text-sm font-semibold text-ink hover:underline disabled:opacity-50" : "btn-primary h-8 px-3 text-sm disabled:opacity-50"}
        >
          {pending ? "Marking…" : marked ? "Marked" : sent ? "Mark sent again" : "Mark form sent"}
        </button>
      ),
      note: sent ? "Call booked" : "Books a call in 3 days",
    },
  ];
  // The step to do now: the first one not done.
  const current = steps.findIndex((st) => !st.done);

  return (
    <div className="space-y-4 rounded-xl border border-accent/25 bg-accent-soft/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Contact form</p>
          <p className="truncate text-xs text-muted">
            {host ? `${host} · the front-desk message` : "No contact page found on the site · the front-desk message"}
          </p>
        </div>
        {lastSentLabel && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok-on-soft">
            {lastSentLabel}
          </span>
        )}
      </div>
      <ol className="grid gap-4 sm:gap-0" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((st, i) => {
          const isCurrent = i === current;
          const last = i === steps.length - 1;
          return (
            <li key={st.key} className="flex min-w-0 flex-col items-start gap-2">
              <div className="flex w-full items-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    st.done ? "bg-ok text-white" : isCurrent ? "bg-accent text-white ring-4 ring-accent/20" : "border border-line bg-surface text-muted"
                  }`}
                  aria-hidden
                >
                  {st.done ? <IconCheck size={15} stroke={3} /> : i + 1}
                </span>
                {!last && <span className={`mx-2 h-0.5 flex-1 rounded-full ${st.done ? "bg-ok" : "bg-line"}`} aria-hidden />}
              </div>
              <span className="sr-only">{`Step ${i + 1}${st.done ? ", done" : ""}`}</span>
              {st.control}
              <span className="text-xs text-muted">{st.note}</span>
            </li>
          );
        })}
      </ol>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
