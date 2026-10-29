"use client";

// A lead's cold email, start to finish: the contact check, the opener and the
// email built around it (approve, edit, regenerate), the buttons that send it
// by hand from Gmail, the follow-ups as they come due, and what came back.
// Every rule is src/lib/emailWorkflow.ts; every write is checked again on the
// server.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveEmail,
  generateEmailOpener,
  markEmailBounced,
  markEmailReplied,
  markEmailUnsubscribed,
  resolveContact,
  saveEmailDraft,
  setEmailVersion,
  unapproveEmail,
} from "@/lib/actions/emailWorkflow";
import {
  EMAIL_REPLY_TYPES,
  EMAIL_REPLY_TYPE_LABELS,
  EMAIL_VERSIONS,
  EMAIL_VERSION_LABELS,
  EmailToSend,
  EmailVersion,
  SUPPRESSION_REASON_LABELS,
  SuppressionReason,
} from "@/lib/emailWorkflow";
import { EMAIL_LEAD_NEXT, EmailLeadStatus } from "@/lib/emailChannel";
import { EmailStatusBadge } from "@/components/Badge";
import EmailSendButtons from "@/components/EmailSendButtons";
import StarterCopyBanner from "@/components/StarterCopyBanner";
import { confirmText } from "@/lib/displayMode";

export interface EmailPanelProps {
  leadId: string;
  clinicName: string;
  status: EmailLeadStatus;
  sequence: string;
  toSend: EmailToSend | null;
  starters: string[];
  sentToday: number;
  dailyLimit: number;
  email: string | null;
  emailDetail: string | null;
  contact: { state: "confirmed" | "mismatch"; scorecardName: string | null; contactName: string | null };
  opener: string | null;
  openerNote: string | null;
  openerMechanism: string | null;
  version: EmailVersion;
  subject: string | null;
  body: string | null;
  approved: boolean;
  unfilled: string[];
  sends: { step: number; sentAt: string; subject: string; toEmail: string }[];
  reply: { at: string; type: string | null; text: string | null } | null;
  suppressed: { reason: string; at: string } | null;
}

const MECHANISM_LABELS: Record<string, string> = {
  observation: "Built on the evidence",
  curiosity_process: "Curiosity question (nothing specific to observe)",
  curiosity_pain_signal: "Curiosity question about no-shows",
};

export default function EmailPanel(p: EmailPanelProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState(p.subject ?? "");
  const [body, setBody] = useState(p.body ?? "");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyType, setReplyType] = useState<string>("interested");
  const sentAny = p.sends.length > 0;
  const dirty = subject !== (p.subject ?? "") || body !== (p.body ?? "");
  const closed = p.status === "stopped" || p.status === "replied";

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) setError(r.error ?? "That did not work.");
      else after?.();
      router.refresh();
    });
  }

  // A fresh draft from the server replaces what is in the boxes.
  const [seen, setSeen] = useState({ subject: p.subject, body: p.body });
  if (seen.subject !== p.subject || seen.body !== p.body) {
    setSeen({ subject: p.subject, body: p.body });
    setSubject(p.subject ?? "");
    setBody(p.body ?? "");
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-5">
      {p.starters.length > 0 && !sentAny && <StarterCopyBanner remaining={p.starters} />}

      <div className="flex flex-wrap items-center gap-2.5">
        <EmailStatusBadge status={p.status} />
        <span className="text-sm text-muted">{EMAIL_LEAD_NEXT[p.status]}</span>
        <span className="num ml-auto text-xs text-muted">{p.sequence}</span>
      </div>

      {p.suppressed && (
        <div className="rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
          <p className="text-sm font-medium text-bad">On the suppression list</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {SUPPRESSION_REASON_LABELS[p.suppressed.reason as SuppressionReason] ?? p.suppressed.reason}, since{" "}
            {day(p.suppressed.at)}. Not contacted on any channel — email, LinkedIn, or a new Discovery search.
          </p>
        </div>
      )}

      {/* Who it goes to: the address, and whether the contact agrees with
          the scorecard. */}
      <div className="text-sm">
        <p>
          <span className="text-muted">To </span>
          {p.email ? <span className="break-all font-medium">{p.email}</span> : <span className="text-muted">no address yet</span>}
          {p.emailDetail && <span className="text-xs text-muted"> · {p.emailDetail}</span>}
        </p>
      </div>
      {p.contact.state === "mismatch" && !sentAny && (
        <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
          <p className="text-sm font-medium">The contact doesn&apos;t match the scorecard</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            The scorecard cites <strong>{p.contact.scorecardName}</strong> as the decision-maker; this lead&apos;s
            contact is <strong>{p.contact.contactName ?? "nobody"}</strong>. Pick one — Ready waits on it.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" disabled={pending} className="btn" onClick={() => run(() => resolveContact(p.leadId, "scorecard"))}>
              Use {p.contact.scorecardName}
            </button>
            {p.contact.contactName && (
              <button type="button" disabled={pending} className="btn" onClick={() => run(() => resolveContact(p.leadId, "keep"))}>
                Keep {p.contact.contactName}
              </button>
            )}
          </div>
        </div>
      )}

      {/* The draft: the opener, and the email built around it. */}
      {!sentAny && !closed && (
        <div className="space-y-3">
          {p.opener === null ? (
            <button type="button" disabled={pending} className="btn-primary disabled:opacity-50" onClick={() => run(() => generateEmailOpener(p.leadId))}>
              {pending ? "Drafting…" : "Draft the opener"}
            </button>
          ) : (
            <>
              <div className="rounded-[10px] bg-wash/70 px-4 py-3">
                <p className="text-xs font-medium text-muted">
                  Opener · {MECHANISM_LABELS[p.openerMechanism ?? ""] ?? "Drafted"}
                </p>
                <p className="mt-1 text-sm">{p.opener}</p>
                {p.openerNote && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-muted">What it was built on</summary>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted">{p.openerNote}</p>
                  </details>
                )}
              </div>

              <div className="segment" role="group" aria-label="Email version">
                {EMAIL_VERSIONS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={p.version === v}
                    disabled={pending}
                    onClick={() => {
                      if (v === p.version) return;
                      if (dirty && !confirm(confirmText("Switching rebuilds the email from the other template, and your edits go. Switch?", "Switch template? Your edits are lost."))) return;
                      run(() => setEmailVersion(p.leadId, v));
                    }}
                    className={`segment-item px-3 text-xs ${p.version === v ? "segment-item-on" : ""}`}
                  >
                    {EMAIL_VERSION_LABELS[v]}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="field-label">Subject</span>
                <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </label>
              <label className="block">
                <span className="field-label">Email</span>
                <textarea className="field min-h-[260px] font-[inherit] text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
              </label>
              {p.unfilled.length > 0 && !dirty && (
                <p className="text-xs text-bad">Still has {p.unfilled.join(", ")} in it — fill it in before approving.</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {dirty ? (
                  <button type="button" disabled={pending} className="btn-primary disabled:opacity-50" onClick={() => run(() => saveEmailDraft(p.leadId, { subject, body }))}>
                    Save edits
                  </button>
                ) : p.approved ? (
                  <>
                    <span className="text-sm font-medium text-ok">Approved</span>
                    <button type="button" disabled={pending} className="btn" onClick={() => run(() => unapproveEmail(p.leadId))}>
                      Unapprove
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={pending} className="btn-primary disabled:opacity-50" onClick={() => run(() => approveEmail(p.leadId))}>
                    Approve
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  className="btn"
                  onClick={() => {
                    if (!confirm(confirmText("Draft a new opener? The email is rebuilt around it and needs approving again.", "New opener? Needs approving again."))) return;
                    run(() => generateEmailOpener(p.leadId));
                  }}
                >
                  {pending ? "Working…" : "Regenerate"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* What to send now: Email 1 once Ready, or the follow-up that is due. */}
      {p.toSend && (
        <div className="rounded-[10px] border border-accent/30 bg-accent/5 px-4 py-3">
          <p className="text-sm font-medium">{p.toSend.label} is ready to send</p>
          {p.toSend.step > 0 && (
            <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed">
              <p className="font-medium">{p.toSend.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-muted">{p.toSend.body}</p>
            </div>
          )}
          <div className="mt-2.5">
            <EmailSendButtons leadId={p.leadId} toSend={p.toSend} sentToday={p.sentToday} dailyLimit={p.dailyLimit} />
          </div>
        </div>
      )}

      {sentAny && (
        <div>
          <p className="field-label">Sent</p>
          <ul className="space-y-1 text-sm">
            {p.sends.map((s) => (
              <li key={s.step} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{s.step === 0 ? "Email 1" : `Follow-up ${s.step}`}</span>
                <span className="num text-muted">{day(s.sentAt)}</span>
                <span className="truncate text-muted">· {s.subject} · to {s.toEmail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What came back. */}
      {p.reply && (
        <div className="rounded-[10px] border border-ok/30 bg-ok-soft/60 px-4 py-3">
          <p className="text-sm font-medium">
            Replied {day(p.reply.at)}
            {p.reply.type && ` · ${EMAIL_REPLY_TYPE_LABELS[p.reply.type as keyof typeof EMAIL_REPLY_TYPE_LABELS] ?? p.reply.type}`}
          </p>
          {p.reply.text && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted">{p.reply.text}</p>}
        </div>
      )}
      {sentAny && !closed && (
        <div className="space-y-3 border-t border-line/60 pt-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => setReplyOpen((o) => !o)}>
              {replyOpen ? "Cancel" : "Replied"}
            </button>
            <button
              type="button"
              disabled={pending || !p.email}
              className="btn disabled:opacity-50"
              onClick={() => {
                if (!confirm(confirmText(`Mark ${p.email} bounced? The address moves to the alternates as invalid and the lead goes back to No email. The clinic is not suppressed.`, `Mark ${p.email} bounced? Lead goes back to No email.`))) return;
                run(() => markEmailBounced(p.leadId));
              }}
            >
              Bounced
            </button>
            <button
              type="button"
              disabled={pending}
              className="btn"
              onClick={() => {
                if (!confirm(confirmText(`Mark ${p.clinicName} unsubscribed? It goes on the suppression list and is not contacted again on any channel.`, `Unsubscribe ${p.clinicName}? Never contacted again on any channel.`))) return;
                run(() => markEmailUnsubscribed(p.leadId));
              }}
            >
              Unsubscribed
            </button>
          </div>
          {replyOpen && (
            <div className="space-y-2.5 rounded-[10px] bg-wash/70 p-3">
              <textarea
                className="field min-h-[110px] text-sm"
                placeholder="Paste their reply"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <select className="field w-auto" value={replyType} onChange={(e) => setReplyType(e.target.value)}>
                  {EMAIL_REPLY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EMAIL_REPLY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pending}
                  className="btn-primary disabled:opacity-50"
                  onClick={() =>
                    run(() => markEmailReplied(p.leadId, { text: replyText, type: replyType }), () => setReplyOpen(false))
                  }
                >
                  Save reply
                </button>
              </div>
              <p className="text-xs text-muted">
                Follow-ups stop and a task is made to answer it.
                {replyType === "not_interested" && " Not interested also puts the clinic on the suppression list."}
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
