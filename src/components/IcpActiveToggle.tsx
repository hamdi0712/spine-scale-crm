"use client";

// The list page's active switch for one ICP Definition. Flipping it on calls
// the action that turns every other definition off in the same transaction, so
// the list re-renders with exactly one switch on.

import { useTransition } from "react";
import Toggle from "@/components/Toggle";

export default function IcpActiveToggle({
  name,
  active,
  setActive,
}: {
  name: string;
  active: boolean;
  setActive: (active: boolean) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Toggle
      checked={active}
      disabled={pending}
      onChange={(on) => startTransition(() => setActive(on))}
      label={`${name} — ${active ? "active" : "inactive"}`}
    />
  );
}
