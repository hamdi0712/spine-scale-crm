"use client";

// The proposal card — Iman asking permission, and the only place in this app
// where a change it suggested can be made to happen.
//
// It is deliberately not a chat bubble. A reply is prose in a soft bubble; this
// is a bordered panel with a label on it, its own heading, the record it touches
// as a link, and two buttons. The whole point of the confirm-before-execute
// shape is that the moment Iman stops answering and starts asking to change
// something is unmistakable, and that is a visual job as much as a wording one:
// if this card could be mistaken for a paragraph, somebody would eventually
// click Confirm the way you scroll past a sentence.
//
// What this component holds is a view composed on the server and an id. It does
// not know what the action will do, cannot describe it differently from what the
// server wrote, and sends nothing back but that id — so the sentence the
// operator agreed to and the change that runs are the same row either way.

import { useState } from "react";
import Link from "next/link";
import { IconCheck, IconX } from "@tabler/icons-react";
import {
  cancelCopilotAction,
  confirmCopilotAction,
} from "@/lib/actions/copilotActions";
import {
  COPILOT_ACTION_TTL_MINUTES,
  CopilotActionView,
} from "@/lib/copilotActions";

export default function CopilotActionCard({
  action,
}: {
  action: CopilotActionView;
}) {
  // The card owns its own state from the first click: whatever comes back from
  // the server replaces what the page was given, so a confirmed card says
  // confirmed without the thread being reloaded.
  const [current, setCurrent] = useState(action);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);

  const waiting = current.status === "PROPOSED" && !current.stale;

  async function decide(choice: "confirm" | "cancel") {
    if (busy !== null) return;
    setBusy(choice);
    setFailed(null);
    try {
      const result =
        choice === "confirm"
          ? await confirmCopilotAction(current.id)
          : await cancelCopilotAction(current.id);
      if (result.ok) {
        setCurrent(result.action);
        setNote(result.message);
      } else {
        setFailed(result.error);
      }
    } catch {
      // The request never landed. Said plainly, and pointedly about the one
      // thing somebody will want to know: whether it went through.
      setFailed(
        "That did not reach the server, so nothing was changed. Check the app is still up and try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`motion-bubble-in rounded-[14px] border-2 bg-surface p-4 ${
        waiting ? "border-ai/40" : "border-line"
      }`}
    >
      {/* The label. Small, always present, and the thing that makes this card
          legible at a glance as a request rather than an answer. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-ai/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ai">
          Proposed action
        </span>
        <span className="text-xs font-medium text-muted">{current.kindLabel}</span>
        <StatusChip status={current.status} stale={current.stale} />
      </div>

      {/* What will change, in the server's own words. Plain text on purpose:
          this line is never rendered as markdown or HTML, so nothing that
          reached it through a model can draw a link or a button in it. */}
      <p className="mt-2.5 text-sm font-medium leading-relaxed text-ink">
        {current.summary}
      </p>

      {current.recordName !== null && current.recordHref !== null && (
        <p className="mt-1.5 text-xs text-muted">
          On{" "}
          <Link
            href={current.recordHref}
            className="font-medium text-accent hover:underline"
          >
            {current.recordName}
          </Link>{" "}
          — open the record in another tab if you want to look before you agree.
        </p>
      )}

      {current.askedFor !== null && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Asked for by: “{current.askedFor}”
        </p>
      )}

      {waiting && (
        <>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => decide("confirm")}
              disabled={busy !== null}
              className="btn-primary h-[34px] bg-accent px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconCheck size={15} stroke={2.2} />
              {busy === "confirm" ? "Applying…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => decide("cancel")}
              disabled={busy !== null}
              className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconX size={15} stroke={2.2} />
              Cancel
            </button>
          </div>
          {/* Said on the card rather than trusted to be understood: nothing has
              happened, and there is a clock on it. */}
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Nothing has changed yet. Confirm applies it and logs it to Recent
            Activity; Cancel discards it. Proposals expire after{" "}
            {COPILOT_ACTION_TTL_MINUTES} minutes.
          </p>
        </>
      )}

      {current.status === "PROPOSED" && current.stale && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          This proposal is more than {COPILOT_ACTION_TTL_MINUTES} minutes old, so
          it can no longer be confirmed and nothing was changed. Ask again if it
          is still what you want.
        </p>
      )}

      {note !== null && (
        <p className="mt-3 text-xs leading-relaxed text-muted">{note}</p>
      )}

      {current.error !== null && current.status === "FAILED" && (
        <p className="mt-2 text-xs leading-relaxed text-bad">{current.error}</p>
      )}

      {failed !== null && (
        <p className="mt-2 text-xs leading-relaxed text-bad">{failed}</p>
      )}
    </div>
  );
}

// Where the proposal stands, in one chip. A settled card keeps its sentence and
// loses its buttons, so a conversation reopened tomorrow reads as what actually
// happened rather than as an offer that is still open.
function StatusChip({
  status,
  stale,
}: {
  status: CopilotActionView["status"];
  stale: boolean;
}) {
  if (status === "PROPOSED") {
    return stale ? (
      <span className="chip-stat text-muted">Expired</span>
    ) : (
      <span className="inline-flex items-center rounded-md bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn-on-soft">
        Waiting on you
      </span>
    );
  }
  if (status === "CONFIRMED") {
    return (
      <span className="inline-flex items-center rounded-md bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok-on-soft">
        Confirmed and applied
      </span>
    );
  }
  if (status === "CANCELLED") {
    return <span className="chip-stat text-muted">Cancelled</span>;
  }
  return (
    <span className="inline-flex items-center rounded-md bg-bad-soft px-2 py-0.5 text-[11px] font-medium text-bad-on-soft">
      Did not run
    </span>
  );
}
