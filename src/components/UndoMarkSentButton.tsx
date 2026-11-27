"use client";

// "Undo mark sent", under the Sent list: takes back the latest email marked
// sent by mistake. Asks first; the server checks again that it is still the
// last one and nothing has come back since.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { undoEmailSent } from "@/lib/actions/emailWorkflow";
import { useConfirm } from "@/components/ConfirmDialog";

export default function UndoMarkSentButton({ leadId, sendId, label }: { leadId: string; sendId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ask = useConfirm();

  async function undo() {
    if (!(await ask({ title: "Undo mark sent?", body: `${label} goes back to not sent — the lead returns to where it was before.`, confirm: "Undo mark sent" }))) return;
    setError(null);
    start(async () => {
      const r = await undoEmailSent(leadId, sendId);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={() => void undo()} disabled={pending} className="btn h-8 px-2.5 text-xs disabled:opacity-50" title={`Undo ${label} marked sent`}>
        {pending ? "Undoing…" : "Undo mark sent"}
      </button>
      {error && <p className="mt-1.5 text-xs text-bad">{error}</p>}
    </div>
  );
}
