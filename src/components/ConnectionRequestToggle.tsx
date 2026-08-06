"use client";

// "Mark connection request sent", and the way back from it.
//
// A button rather than a form, because this sits inside the lead's details
// form and a form cannot be nested in another one — the browser drops the
// inner one and the press submits the outer. So the action is called
// imperatively, the same way the Kanban board moves a stage.
//
// Nothing here sends a connection request. LinkedIn is opened by the link
// beside this and the request is made by hand; this records that it was.
//
// The date is formatted by the server and passed in already written, so this
// renders the same string on both sides of hydration — "just now" turning into
// "1m ago" between the server and the browser is a mismatch, and this is a
// stamp that is often seconds old.

import { useTransition } from "react";

export default function ConnectionRequestToggle({
  sentLabel,
  sentTitle,
  mark,
  clear,
}: {
  // Null until a request has been marked sent.
  sentLabel: string | null;
  sentTitle: string | null;
  mark: () => Promise<void>;
  clear: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  if (sentLabel !== null) {
    return (
      <span className="inline-flex h-[34px] items-center gap-1 rounded-[10px] border border-ok/30 bg-ok-soft/60 pl-3 pr-1.5 text-xs font-medium text-ok">
        <span className="num" title={sentTitle ?? undefined}>
          ✓ {sentLabel}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => clear())}
          title="Clear this mark — nothing on LinkedIn changes"
          className="rounded-[6px] px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
        >
          {pending ? "…" : "Undo"}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => mark())}
      className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Marking…" : "Mark connection request sent"}
    </button>
  );
}
