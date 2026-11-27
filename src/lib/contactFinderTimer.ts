// The contact finder's hourly look: unknown addresses due their one retry, a
// step that failed once, and leads blocked on credits once the budgets have
// room again. Server-only; started from src/instrumentation.ts.
//
// Once per process: the handle lives on globalThis, which a dev hot reload
// keeps, so a reload never starts a second one. Never during `next build`.

import { CONTACT_FINDER_TICK_MS } from "@/lib/contactFinder";

const g = globalThis as unknown as { __contactFinderTimer?: ReturnType<typeof setInterval> };

export function contactFinderTimerRunning(): boolean {
  return g.__contactFinderTimer !== undefined;
}

export function startContactFinderTimer(): boolean {
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  if (g.__contactFinderTimer) return false;
  const tick = async () => {
    try {
      const { kickContactFinder } = await import("@/lib/actions/jobs");
      await kickContactFinder();
    } catch {
      // The next tick tries again.
    }
  };
  g.__contactFinderTimer = setInterval(() => void tick(), CONTACT_FINDER_TICK_MS);
  g.__contactFinderTimer.unref?.();
  // And once shortly after start: anything left "finding" by a restart.
  setTimeout(() => void tick(), 60_000).unref?.();
  return true;
}
