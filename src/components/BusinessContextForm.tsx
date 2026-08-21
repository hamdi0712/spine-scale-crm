"use client";

// The Business context section — one textarea, one Save.
//
// A client component for two small things a plain form cannot do: a live
// character count against the ceiling, and a line that says whether what is on
// screen is what is stored. The value itself goes out through the same server
// action a plain form would post to, and nothing comes back.
//
// An unwritten page opens on the template rather than on nothing. That is the
// only reason this needs an initial value at all — and the template counts as
// empty everywhere it matters (hasBusinessContext), so saving it untouched
// leaves the copilot's prompt exactly as it was.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  BUSINESS_CONTEXT_MAX_CHARS,
  BUSINESS_CONTEXT_TEMPLATE,
  BusinessContextState,
  hasBusinessContext,
  normaliseBody,
} from "@/lib/businessContext";
import { fmtDateTime } from "@/lib/format";

export default function BusinessContextForm({
  state,
  save,
}: {
  state: BusinessContextState;
  save: (formData: FormData) => Promise<void>;
}) {
  const stored = state.body;
  const [draft, setDraft] = useState(
    stored === "" ? BUSINESS_CONTEXT_TEMPLATE : stored,
  );

  return (
    <form action={save} className="card p-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <label className="field-label !mb-0" htmlFor="business-context">
          What the copilot should know before it answers anything
        </label>
        <span className="num text-xs text-muted">
          {draft.length.toLocaleString()} / {BUSINESS_CONTEXT_MAX_CHARS.toLocaleString()}
        </span>
      </div>
      <textarea
        id="business-context"
        name="body"
        value={draft}
        onChange={(e) =>
          setDraft(e.target.value.slice(0, BUSINESS_CONTEXT_MAX_CHARS))
        }
        rows={22}
        spellCheck
        className="field font-mono text-[13px] leading-relaxed"
      />
      <SaveBar draft={draft} stored={stored} updatedAt={state.updatedAt} />
    </form>
  );
}

function SaveBar({
  draft,
  stored,
  updatedAt,
}: {
  draft: string;
  stored: string;
  updatedAt: Date | null;
}) {
  const { pending } = useFormStatus();
  // Normalised on both sides: what a textarea posts is CRLF and what it holds
  // is LF, so a saved page would otherwise go on reporting itself as unsaved.
  const changed = normaliseBody(draft).trim() !== normaliseBody(stored).trim();

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line/60 pt-5">
      <button
        type="submit"
        disabled={pending}
        className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save business context"}
      </button>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
        {changed
          ? "Unsaved changes — the copilot answers on the stored version until you save."
          : status(stored, updatedAt)}
      </p>
    </div>
  );
}

// The resting line: whether anything is actually in force, and when it was
// written. The template on its own is reported as nothing rather than as
// context, because that is how the copilot treats it.
function status(stored: string, updatedAt: Date | null): string {
  if (!hasBusinessContext(stored)) {
    return updatedAt
      ? "Nothing in force — the page is empty, so the copilot runs on its own instructions alone."
      : "Nothing saved yet. Replace the headings with your own, or leave the page empty and the copilot runs on its own instructions alone.";
  }
  return `In force on every conversation. Last saved ${fmtDateTime(updatedAt as Date)}.`;
}
