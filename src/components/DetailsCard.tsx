"use client";

// The lead's details: a compact read-only summary, and the full form behind
// Edit. The form stays mounted while hidden, so a half-typed edit survives
// pressing Cancel by mistake and pressing Edit again; saving goes back to the
// summary, which the server re-renders with what was saved.

import { useState } from "react";
import { IconListDetails } from "@tabler/icons-react";

export default function DetailsCard({
  summary,
  children,
}: {
  summary: React.ReactNode;
  // The details form.
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-labelledby="details" className="card card-sheen p-6 max-md:p-4">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-line/70 text-muted" aria-hidden>
            <IconListDetails size={18} stroke={2} />
          </span>
          <h2 id="details" className="text-lg font-semibold">Details</h2>
        </div>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          aria-expanded={editing}
          className="text-sm font-medium text-accent hover:underline"
        >
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      {!editing && summary}
      <div
        className={editing ? "" : "hidden"}
        // Back to the summary once the form is submitted; the save itself is
        // the form's own server action.
        onSubmitCapture={() => setTimeout(() => setEditing(false), 0)}
      >
        {children}
      </div>
    </section>
  );
}
