"use client";

// "Undo" beside a change Claude made through the connector: puts the lead back
// as it was before that change. src/lib/mcpWrites.ts does the work.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoConnectorChange } from "@/lib/actions/connectorChanges";

export default function UndoConnectorChangeButton({ changeId }: { changeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 items-center gap-2">
      {error && <span className="max-w-[16rem] truncate text-xs text-bad" title={error}>{error}</span>}
      <button
        type="button"
        className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await undoConnectorChange(changeId);
            if (!r.ok) setError(r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
    </span>
  );
}
