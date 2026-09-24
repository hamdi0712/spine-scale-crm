"use client";

// Which kind of opener a first message was, as a control rather than as a label.
//
// The mechanism is stamped by the model when it writes the message, and that
// stamp records what the step was asked for — not necessarily what went out. A
// draft edited in the box before it was pasted into LinkedIn can have become the
// other kind entirely, and the only person who knows that is the one who edited
// it. So everywhere a message is marked sent, the stamp is a select with the
// model's answer already in it, and correcting it is one press.
//
// Three options, and never the bump: step2_bump is what the follow-up's third
// branch writes, it is not a kind of opener, and nothing here should be able to
// set it or clear it.
//
// Saves on change. There is no Save button because there is nothing to compose —
// the value is one of three and the change is the whole edit, and a select that
// needed confirming would be a second press for no second decision.

import { useState, useTransition } from "react";
import {
  FIRST_MESSAGE_MECHANISMS,
  MESSAGE_MECHANISM_LABELS,
  MessageMechanism,
  isFirstMessageMechanism,
} from "@/lib/outreachSequence";

export default function MechanismPicker({
  value,
  set,
  label = "Opener type",
  hint,
}: {
  // As stored. Null on a message written before the column existed and on one
  // written by hand, which is exactly the case the empty option exists for.
  value: MessageMechanism | null;
  set: (mechanism: string) => Promise<void>;
  label?: string;
  // Said under the select where there is something to say — the mark-sent rule,
  // on a message that has not been tagged yet.
  hint?: string;
}) {
  // The value as the select shows it, so the control answers the press rather
  // than waiting for the server round trip and the re-render behind it.
  const [chosen, setChosen] = useState<string>(
    isFirstMessageMechanism(value) ? value : "",
  );
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* A span rather than a label: the select carries its own aria-label,
          and a <label> here would need an id on a control this renders many of
          on one page. */}
      <span className="text-xs font-medium text-muted">{label}</span>
      <select
        // Unnamed, like every control in the sequence panel: it renders inside
        // the lead's details form and a named field would be saved with it.
        value={chosen}
        disabled={pending}
        aria-label={label}
        onChange={(e) => {
          const next = e.target.value;
          setChosen(next);
          if (next === "") return;
          startTransition(async () => set(next));
        }}
        className="field w-auto text-sm disabled:opacity-50"
      >
        {/* Only offered while nothing is set. Once it is tagged, untagging it
            again is not a correction anybody needs to make. */}
        {chosen === "" && <option value="">Not tagged yet…</option>}
        {FIRST_MESSAGE_MECHANISMS.map((mechanism) => (
          <option key={mechanism} value={mechanism}>
            {MESSAGE_MECHANISM_LABELS[mechanism]}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-muted">Saving…</span>}
      {!pending && hint && chosen === "" && (
        <span className="text-xs text-muted">{hint}</span>
      )}
    </div>
  );
}
