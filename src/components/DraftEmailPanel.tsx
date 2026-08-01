"use client";

// Opens a pre-filled Gmail compose window in a new tab. Nothing is sent from
// here and nothing is stored — the draft is handed to Gmail and the user
// reviews and sends it themselves.

import { useState } from "react";
import { gmailComposeUrl } from "@/lib/onboarding";

export default function DraftEmailPanel({
  label,
  to,
  subject: initialSubject,
  body: initialBody,
}: {
  label: string;
  to: string | null;
  subject: string;
  body: string;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-[10px] border border-line bg-wash/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {to
              ? `Opens Gmail with a draft to ${to} — you send it.`
              : "No contact email on this client yet — add one in step 1 to draft the email."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="btn-ghost h-[34px] px-3 text-xs"
          >
            {editing ? "Hide template" : "Edit template"}
          </button>
          {to ? (
            <a
              href={gmailComposeUrl({ to, subject, body })}
              target="_blank"
              rel="noreferrer"
              className="btn h-[34px] px-3.5 text-xs"
            >
              {label} ↗
            </a>
          ) : (
            <span className="btn h-[34px] cursor-not-allowed px-3.5 text-xs opacity-50">
              {label} ↗
            </span>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-4 border-t border-line/60 pt-4">
          <div>
            <label className="field-label" htmlFor={`${label}-subject`}>
              Subject
            </label>
            <input
              id={`${label}-subject`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              // The panel sits inside the step's form; Enter here would
              // otherwise submit the step and move the wizard on.
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              className="field"
            />
          </div>
          <div>
            <label className="field-label" htmlFor={`${label}-body`}>
              Body
            </label>
            <textarea
              id={`${label}-body`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="field"
            />
          </div>
          <p className="text-xs text-muted">
            Edits here only change the draft this button opens — nothing is
            saved to the client record.
          </p>
        </div>
      )}
    </div>
  );
}
