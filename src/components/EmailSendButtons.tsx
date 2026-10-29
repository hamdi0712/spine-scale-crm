"use client";

// The three buttons that send an email by hand: open it in Gmail with the
// address, subject and body filled in, or copy it — then mark it sent once it
// has gone. Marking sent past the daily limit asks first; it is a limit you
// set for yourself, not a wall.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markEmailSent } from "@/lib/actions/emailWorkflow";
import { EmailToSend, copyText, gmailComposeUrl } from "@/lib/emailWorkflow";

export default function EmailSendButtons({
  leadId,
  toSend,
  sentToday,
  dailyLimit,
  compact = false,
}: {
  leadId: string;
  toSend: EmailToSend;
  sentToday: number;
  dailyLimit: number;
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
      sentToday >= dailyLimit &&
      !confirm(`That will be ${sentToday + 1} sent today, over your limit of ${dailyLimit}. Mark it sent anyway?`)
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const r = await markEmailSent(leadId, { step: toSend.step, subject: toSend.subject, body: toSend.body });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  const btn = compact ? "btn h-8 px-2.5 text-xs" : "btn";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={gmailComposeUrl(toSend.to, toSend.subject, toSend.body)}
          target="_blank"
          rel="noopener noreferrer"
          className={btn}
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
