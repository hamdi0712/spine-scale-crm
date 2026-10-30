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

  return (
    <>
      {contactFormUrl && (
        <a href={contactFormUrl} target="_blank" rel="noreferrer" className="btn h-[34px] px-3.5 text-xs">
          Contact form ↗
        </a>
      )}
      <button type="button" onClick={() => void copy()} className="btn h-[34px] px-3.5 text-xs">
        {copied ? "Copied" : "Copy message"}
      </button>
      <button
        type="button"
        onClick={mark}
        disabled={pending}
        title="Logs it in the activity feed and adds a task to call the clinic in 3 days"
        className="btn h-[34px] px-3.5 text-xs disabled:opacity-50"
      >
        {pending ? "Marking…" : marked ? "Marked — call booked in 3 days" : "Mark form sent"}
      </button>
      {lastSentLabel && <span className="text-xs text-muted">{lastSentLabel}</span>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </>
  );
}
