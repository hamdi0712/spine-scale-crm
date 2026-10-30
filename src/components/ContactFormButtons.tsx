"use client";

// The lead page's contact-form launchpad, in the row beside "Visit website":
// open the clinic's contact page, copy the front-desk message to paste into
// it, and mark that it went. Nothing here sends anything.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  const [marked, setMarked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(copyText(message.subject, message.body));
      setCopied(true);
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

  // Numbered in the order they are done; the Open step only when a stored
  // link reads as the contact page.
  const step = (n: number) => (contactFormUrl ? n : n - 1);
  let host: string | null = null;
  try {
    host = contactFormUrl ? new URL(contactFormUrl).host.replace(/^www\./, "") + new URL(contactFormUrl).pathname.replace(/\/$/, "") : null;
  } catch {
    host = null;
  }

  return (
    <div className="space-y-3 rounded-xl border border-accent/25 bg-accent-soft/40 p-4">
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
      <div className="flex flex-wrap gap-2">
        {contactFormUrl && (
          <a href={contactFormUrl} target="_blank" rel="noreferrer" className="btn-primary h-9 px-3.5 text-sm">
            1 · Open the form ↗
          </a>
        )}
        <button type="button" onClick={() => void copy()} className="btn h-9 px-3.5 text-sm">
          {step(2)} · {copied ? "Copied" : "Copy message"}
        </button>
        <button
          type="button"
          onClick={mark}
          disabled={pending}
          title="Logs it in the activity feed and adds a task to call the clinic in 3 days"
          className="btn h-9 px-3.5 text-sm disabled:opacity-50"
        >
          {step(3)} · {pending ? "Marking…" : marked ? "Marked — call booked in 3 days" : "Mark form sent"}
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
