"use client";

// The email templates, follow-up delay and daily limit. A template still
// holding its starter copy is marked as such, here and with a banner wherever
// an email is drafted, until it is edited.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveEmailSettings } from "@/lib/actions/emailWorkflow";
import {
  EmailSettingsValues,
  MAX_FOLLOW_UPS,
  STARTER_FOLLOW_UPS,
  SendingInboxView,
  startersRemaining,
} from "@/lib/emailWorkflow";

type InboxDraft = { id: string | null; address: string; displayName: string; dailyLimit: number };

export default function EmailSettingsForm({
  initial,
  inboxes: initialInboxes,
  starters,
}: {
  initial: EmailSettingsValues;
  inboxes: SendingInboxView[];
  starters: string[];
}) {
  const router = useRouter();
  const [v, setV] = useState<EmailSettingsValues>(initial);
  const [inboxes, setInboxes] = useState<InboxDraft[]>(initialInboxes);
  const setInbox = (i: number, patch: Partial<InboxDraft>) => {
    setInboxes((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setMessage(null);
  };
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const live = startersRemaining(v);
  const isStarter = (name: string) => live.includes(name);

  const set = <K extends keyof EmailSettingsValues>(key: K, value: EmailSettingsValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  };

  function save() {
    start(async () => {
      const r = await saveEmailSettings({ ...v, inboxes });
      setMessage(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
      router.refresh();
    });
  }

  const label = (text: string, starter: boolean) => (
    <span className="flex items-center gap-2">
      {text}
      {starter && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">Starter copy</span>}
    </span>
  );

  return (
    <div className="space-y-6">
      {starters.length > 0 && (
        <div className="rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
          <p className="text-sm font-medium">These templates are starter copy</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            They are here so the workflow can be tried end to end. Rewrite each in your own words — the banner on
            the Email view goes once every one has been edited.
          </p>
        </div>
      )}

      <div className="card space-y-4 p-6">
        <div>
          <p className="text-sm font-medium">Sending inboxes</p>
          <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
            The Gmail inboxes cold email goes from, by hand. Each lead is given one when it first becomes Ready,
            alternating so they stay balanced; Open in Gmail opens that account. The display name signs{" "}
            <code>{"{sender}"}</code> — blank uses Your name below. An inbox that has sent email cannot be removed.
          </p>
        </div>
        {inboxes.map((inbox, i) => (
          <div key={inbox.id ?? `new-${i}`} className="grid grid-cols-[2fr_1.5fr_90px_auto] items-end gap-3 max-md:grid-cols-1">
            <label className="block">
              <span className="field-label">Address</span>
              <input className="field" value={inbox.address} onChange={(e) => setInbox(i, { address: e.target.value })} />
            </label>
            <label className="block">
              <span className="field-label">Display name</span>
              <input
                className="field"
                value={inbox.displayName}
                placeholder={v.senderName || "Your name"}
                onChange={(e) => setInbox(i, { displayName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="field-label">Per day</span>
              <input
                type="number"
                min={1}
                max={500}
                className="field num"
                value={inbox.dailyLimit}
                onChange={(e) => setInbox(i, { dailyLimit: Number(e.target.value) })}
              />
            </label>
            <button
              type="button"
              className="mb-2 text-xs text-muted hover:text-bad"
              onClick={() => setInboxes((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        {inboxes.length < 10 && (
          <button
            type="button"
            className="btn"
            onClick={() => setInboxes((prev) => [...prev, { id: null, address: "", displayName: "", dailyLimit: 10 }])}
          >
            Add an inbox
          </button>
        )}
      </div>

      <div className="card space-y-5 p-6">
        <div>
          <p className="text-sm font-medium">Email 1</p>
          <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
            Placeholders: <code>{"{greeting}"}</code> “Hi Dr. Chen,” to the owner or “Hi {"{clinic}"} team,” to a
            front desk (added at the top of a template without it), <code>{"{opener}"}</code> the drafted opener,{" "}
            <code>{"{clinic}"}</code> the clinic&apos;s name, <code>{"{contact}"}</code> who the front desk is asked to
            pass it to, <code>{"{sender}"}</code> your name below. Every email ends with the opt-out line, then the
            sign-off.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <label className="block">
            <span className="field-label">{label("Subject, owner", isStarter("Owner subject"))}</span>
            <input className="field" value={v.subjectTemplate} onChange={(e) => set("subjectTemplate", e.target.value)} />
          </label>
          <label className="block">
            <span className="field-label">{label("Subject, front desk", isStarter("Front-desk subject"))}</span>
            <input
              className="field"
              value={v.frontDeskSubjectTemplate}
              onChange={(e) => set("frontDeskSubjectTemplate", e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="field-label">{label("Owner-direct email", isStarter("Owner-direct email"))}</span>
          <textarea className="field !min-h-[320px]" value={v.ownerBodyTemplate} onChange={(e) => set("ownerBodyTemplate", e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">{label("Front-desk email", isStarter("Front-desk email"))}</span>
          <textarea className="field !min-h-[360px]" value={v.frontDeskTemplate} onChange={(e) => set("frontDeskTemplate", e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">{label("Opt-out line", isStarter("Opt-out line"))}</span>
          <input className="field" value={v.optOutLine} onChange={(e) => set("optOutLine", e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">{label("Sign-off", isStarter("Sign-off"))}</span>
          <textarea className="field !min-h-[150px]" value={v.signOff} onChange={(e) => set("signOff", e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Your name, for {"{sender}"} when an inbox has no display name</span>
          <input className="field" value={v.senderName} onChange={(e) => set("senderName", e.target.value)} />
        </label>
      </div>

      <div className="card space-y-5 p-6">
        <div>
          <p className="text-sm font-medium">Follow-ups</p>
          <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
            Sent in order, in reply to Email 1, each one once the wait below has passed since the last email. The
            sequence stops after the last one, or as soon as they reply.
          </p>
        </div>
        {v.followUpTemplates.map((t, i) => (
          <label key={i} className="block">
            <span className="field-label flex items-center justify-between">
              {label(`Follow-up ${i + 1}`, isStarter(`Follow-up ${i + 1}`))}
              <button
                type="button"
                className="text-xs text-muted hover:text-bad"
                onClick={() => set("followUpTemplates", v.followUpTemplates.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </span>
            <textarea
              className="field !min-h-[110px]"
              value={t}
              onChange={(e) => set("followUpTemplates", v.followUpTemplates.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </label>
        ))}
        {v.followUpTemplates.length < MAX_FOLLOW_UPS && (
          <button
            type="button"
            className="btn"
            onClick={() => set("followUpTemplates", [...v.followUpTemplates, STARTER_FOLLOW_UPS[STARTER_FOLLOW_UPS.length - 1]])}
          >
            Add a follow-up
          </button>
        )}
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <label className="block">
            <span className="field-label">Days before each follow-up</span>
            <input
              type="number"
              min={1}
              max={60}
              className="field num"
              value={v.followUpDelayDays}
              onChange={(e) => set("followUpDelayDays", Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className="btn-primary disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        {message && <p className={`text-sm ${message.ok ? "text-muted" : "text-bad"}`}>{message.text}</p>}
      </div>
    </div>
  );
}
