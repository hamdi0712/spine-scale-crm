// Bonus points — the reactive half of a day, counted rather than ticked.
//
// Four things used to be checkboxes in the checklist's Conversations group:
// replies answered, an audit offer sent, a Loom cut, a follow-up cleared. None
// of them is a thing a person can decide to do. They all wait on somebody else
// having written back first, and a day nobody wrote back on left four boxes
// empty — a routine reporting four failures for work that was never on offer.
//
// So they are scored the other way round. The checklist keeps only what is
// fully controllable and its score is out of that (checkedCount in
// src/lib/dailyChecklist.ts); everything that depends on someone else moving
// is added here as bonus, and bonus only ever goes up. There is no total to be
// short of, and nothing here is ever drawn as missing.
//
// Nothing is entered by hand and nothing is stored. Every point is read off
// the day's live counts — the same DailyNumber array the numbers panel draws
// (src/lib/dailyNumbers.ts) — so the tally and the panel above it can never
// disagree about what happened.
//
// Pure. It is handed the numbers and adds them up.

import type { DailyNumber, DailyNumberKey } from "@/lib/dailyNumbers";

export interface DailyBonusKind {
  key: DailyNumberKey;
  // What the row is called in the bonus section. Shorter than the numbers
  // panel's label, because the count is beside it and says the rest.
  label: string;
  // Points per occurrence. Weighted by how much of the work each one is: a
  // reply answered is a message, a follow-up is a message somebody had already
  // gone quiet on, and an audit offer or a Loom is an afternoon.
  points: number;
}

export const DAILY_BONUS_KINDS: DailyBonusKind[] = [
  { key: "REPLIES", label: "Replies handled", points: 1 },
  { key: "FOLLOW_UPS", label: "Follow-ups sent", points: 1 },
  { key: "AUDIT_OFFERS", label: "Audit offers sent", points: 2 },
  { key: "LOOMS", label: "Looms sent", points: 3 },
];

export interface DailyBonusRow extends DailyBonusKind {
  count: number;
  earned: number;
}

export interface DailyBonus {
  rows: DailyBonusRow[];
  total: number;
}

export function computeDailyBonus(numbers: DailyNumber[]): DailyBonus {
  const byKey = new Map(numbers.map((n) => [n.key, n.value]));
  const rows = DAILY_BONUS_KINDS.map((kind) => {
    const count = byKey.get(kind.key) ?? 0;
    return { ...kind, count, earned: count * kind.points };
  });
  return { rows, total: rows.reduce((sum, r) => sum + r.earned, 0) };
}
