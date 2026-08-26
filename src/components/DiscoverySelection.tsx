"use client";

// The Discovery selection, shared by the two things that act on it.
//
// The checkboxes live on the list; the Process queue button lives in the page
// header, three levels of layout away from them. Both need the same set of
// ids — the list to delete and to draw a row as chosen, the queue to know it
// is being asked for five candidates rather than for all forty — so the set
// lives here, above both, rather than in either.
//
// It is state and nothing else: no URL, no storage. A refresh or a navigation
// starts with nothing selected, which is the only safe default for a set of
// rows with a delete button and a run that spends model calls pointed at them.
//
// `queueable` is the subset of ids the queue would actually take — the
// candidates in a queue status, decided on the server where the statuses are.
// A selection of three rejected candidates is a selection with nothing to
// process in it, and the button says so by staying the way it was.

import { createContext, useContext, useMemo, useState } from "react";

interface DiscoverySelection {
  selected: ReadonlySet<string>;
  setSelected: (
    update:
      | ReadonlySet<string>
      | ((prev: ReadonlySet<string>) => ReadonlySet<string>),
  ) => void;
  // Selected *and* processable, in the list's own order. What the queue runs.
  selectedQueueable: string[];
}

const EMPTY: DiscoverySelection = {
  selected: new Set(),
  setSelected: () => {},
  selectedQueueable: [],
};

const Ctx = createContext<DiscoverySelection>(EMPTY);

export function useDiscoverySelection() {
  return useContext(Ctx);
}

export default function DiscoverySelectionProvider({
  queueable,
  children,
}: {
  queueable: string[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const value = useMemo<DiscoverySelection>(
    () => ({
      selected,
      setSelected,
      selectedQueueable: queueable.filter((id) => selected.has(id)),
    }),
    [selected, queueable],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
