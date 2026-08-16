"use client";

// The API Keys section's rows — one per credential, each in one of two states.
//
// Resting, a row says whether a key is set, where it came from, and its last
// four characters. Pressing Edit swaps that line for an input and a Save. There
// is no "reveal": the row never held the key to reveal, and the input starts
// empty because what it takes is a replacement rather than an edit of the
// stored one. That is the honest shape of a write-only field, and it is why
// cancelling can never blank a key by accident.
//
// A client component for the two-state row and nothing else — the value goes
// out through the same server action a plain form would post to, and nothing
// comes back.

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { IconCheck, IconKey } from "@tabler/icons-react";
import { SECRET_META, SecretStatus } from "@/lib/appSecrets";

export default function ApiKeysForm({
  statuses,
  save,
}: {
  statuses: SecretStatus[];
  save: (formData: FormData) => Promise<void>;
}) {
  return (
    <ul className="card divide-y divide-line/60">
      {statuses.map((status) => (
        <SecretRow key={status.key} status={status} save={save} />
      ))}
    </ul>
  );
}

function SecretRow({
  status,
  save,
}: {
  status: SecretStatus;
  save: (formData: FormData) => Promise<void>;
}) {
  const meta = SECRET_META[status.key];
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Opening the editor should land the cursor in it — the button that opened it
  // is the only thing that ever does, so there is nowhere else the focus
  // usefully goes.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // The row re-renders from the database after a save, so a changed mask is
  // what "it saved" looks like. Closing the editor on that is what turns the
  // round trip back into the resting state.
  useEffect(() => {
    setEditing(false);
  }, [status.masked, status.source]);

  return (
    <li className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {meta.help}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn h-[34px] px-3.5 text-xs"
          >
            {status.set ? "Edit" : "Add key"}
          </button>
        )}
      </div>

      {editing ? (
        <form
          action={save}
          className="mt-4"
          // A key is not a browser-fillable field, and a password manager
          // offering to remember it would put a second copy somewhere this app
          // cannot see.
          autoComplete="off"
        >
          <input type="hidden" name="key" value={status.key} />
          <label className="field-label" htmlFor={`${status.key}-value`}>
            New {meta.label.toLowerCase()}
          </label>
          <input
            ref={inputRef}
            id={`${status.key}-value`}
            name="value"
            type="password"
            defaultValue=""
            placeholder={meta.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="field font-mono text-xs"
          />
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Saved to the database and used from the next request — no restart.
            Leaving this blank and saving clears the stored key and falls back
            to{" "}
            <code className="rounded bg-wash/70 px-1 py-0.5 font-mono text-[11px]">
              {meta.envVar}
            </code>{" "}
            in the .env file.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SaveButton />
            <CancelButton onCancel={() => setEditing(false)} />
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex h-[38px] min-w-[180px] items-center gap-2 rounded-[10px] border border-line bg-wash/50 px-3.5 font-mono text-xs ${
              status.set ? "text-ink" : "text-muted"
            }`}
          >
            <IconKey size={14} stroke={1.75} aria-hidden className="text-muted" />
            {status.masked ?? "Not set"}
          </span>
          <p className="text-xs leading-relaxed text-muted">
            {status.source === "database"
              ? "Stored in the database. This is the key in force."
              : status.source === "env"
                ? `Read from ${meta.envVar} in the .env file. Saving a key here overrides it.`
                : `Not set anywhere. Add one here, or set ${meta.envVar} in the .env file.`}
          </p>
        </div>
      )}
    </li>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary h-[38px] px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? (
        "Saving…"
      ) : (
        <>
          <IconCheck size={15} stroke={1.75} aria-hidden />
          Save key
        </>
      )}
    </button>
  );
}

// Disabled mid-save, so a cancel cannot unmount the form the action is posting
// from.
function CancelButton({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onCancel}
      disabled={pending}
      className="btn h-[38px] px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      Cancel
    </button>
  );
}
