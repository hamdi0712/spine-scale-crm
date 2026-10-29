"use client";

// The three buttons that send an email by hand: open it in Gmail — on the
// lead's sending inbox, whichever account is first in the browser — with the
// address, subject and body filled in, or copy it; then mark it sent once it
// has gone. Marking sent past that inbox's daily limit asks first; it is a
// limit you set for yourself, not a wall.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markEmailSent } from "@/lib/actions/emailWorkflow";
import { EmailToSend, copyText, gmailComposeUrl, inboxShort } from "@/lib/emailWorkflow";
import { confirmText } from "@/lib/displayMode";

export default function EmailSendButtons({
  leadId,
  toSend,
  inboxSentToday,
  inboxLimit,
  compact = false,
}: {
  leadId: string;
  toSend: EmailToSend;
  // What the sending inbox has sent today, and its own limit.
  inboxSentToday: number;
  inboxLimit: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText(toSend.subject, toSend.body));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("The clipboard is not available here — open it in Gmail instead.");
    }
  }

  function markSent() {
    if (
      inboxSentToday >= inboxLimit &&
      !confirm(
        confirmText(
          `That will be ${inboxSentToday + 1} sent today from ${toSend.from}, over its limit of ${inboxLimit}. Mark it sent anyway?`,
          `${inboxShort(toSend.from)} over its limit: ${inboxSentToday + 1} of ${inboxLimit} today. Mark sent?`,
        ),
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const r = await markEmailSent(leadId, { step: toSend.step, subject: toSend.subject, body: toSend.body, inboxId: toSend.inboxId });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  const btn = compact ? "btn h-8 px-2.5 text-xs" : "btn";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={gmailComposeUrl(toSend.from, toSend.to, toSend.subject, toSend.body)}
          target="_blank"
          rel="noopener noreferrer"
          className={btn}
          title={`Opens Gmail as ${toSend.from}`}
        >
          Open in Gmail
        </a>
        <button type="button" onClick={() => void copy()} className={btn}>
          {copied ? "Copied" : "Copy email"}
        </button>
        <button type="button" onClick={markSent} disabled={pending} className={`${compact ? "btn-primary h-8 px-2.5 text-xs" : "btn-primary"} disabled:opacity-50`}>
          {pending ? "Saving…" : `Mark ${toSend.label} sent`}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-bad">{error}</p>}
    </div>
  );
}
