"use client";

// The confetti burst, and the memory that stops it going off twice.
//
// The problem this component exists to solve is not the confetti, it is the
// trigger. The page is server-rendered and re-renders on every tick of a
// habit, so "every habit is done today" is true on the render that finished
// the day and on every render for the rest of it — a burst fired on the
// condition alone would go off again on every refresh until midnight, which
// turns a celebration into a nuisance within about an hour.
//
// So the server does not send a condition, it sends an occasion: a key naming
// the thing that happened (monkCelebration in src/lib/monkMode.ts). This
// remembers the keys it has already fired in localStorage and ignores a key it
// has seen, which also means a day celebrated this morning stays celebrated
// after a reload tonight.
//
// Every read and write of storage is wrapped: a private window, blocked site
// data, or a browser that throws on access must not take the dashboard down
// over a decoration. The failure mode is chosen deliberately — if storage
// cannot be read, nothing fires, because a burst on every page load is a worse
// outcome than a burst that was missed.
//
// The library is loaded on demand rather than imported at the top, so the
// ~2KB of it only reaches a browser on the render where something is actually
// being celebrated.

import { useEffect } from "react";

const STORAGE_KEY = "monk-mode:celebrated";

// How many occasions are remembered. A challenge is twenty-one days and the
// keys are small; this is simply a cap so the entry cannot grow without bound
// across a year of them.
const REMEMBER = 60;

function alreadyFired(key: string): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const seen = JSON.parse(raw);
    return Array.isArray(seen) && seen.includes(key);
  } catch {
    // Unreadable storage: treat every occasion as already celebrated. See the
    // note above on why this is the safe direction to fail in.
    return true;
  }
}

function remember(key: string): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const seen: string[] = Array.isArray(parsed) ? parsed : [];
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...seen, key].slice(-REMEMBER)),
    );
  } catch {
    // Written or not, the burst has already played. Nothing to recover.
  }
}

// The three occasions, at three sizes. Finishing a twenty-one day challenge
// should not look like finishing a Tuesday.
const BURSTS: Record<string, { count: number; spread: number; ticks: number }> =
  {
    day: { count: 70, spread: 62, ticks: 140 },
    streak: { count: 110, spread: 80, ticks: 180 },
    finish: { count: 170, spread: 100, ticks: 240 },
  };

export default function MonkCelebrate({
  occasion,
  kind,
}: {
  // The key naming what happened. Null when there is nothing to celebrate,
  // which is most renders — the component still mounts, and does nothing.
  occasion: string | null;
  kind: string;
}) {
  useEffect(() => {
    if (!occasion) return;
    if (alreadyFired(occasion)) return;
    // Recorded before the burst rather than after it. A second tab opening the
    // same moment, or a fast double render, should find the key already set;
    // the cost of recording one that then fails to draw is a missed
    // decoration, and the cost of the reverse is two bursts.
    remember(occasion);

    let cancelled = false;
    import("canvas-confetti")
      .then(({ default: confetti }) => {
        if (cancelled) return;
        const burst = BURSTS[kind] ?? BURSTS.day;
        // Fired from just under the top of the viewport rather than the
        // middle: the panels that trigger this sit low on the page, and
        // confetti that starts at the centre lands mostly off the bottom.
        confetti({
          particleCount: burst.count,
          spread: burst.spread,
          ticks: burst.ticks,
          origin: { x: 0.5, y: 0.28 },
          startVelocity: 38,
          gravity: 1.1,
          scalar: 0.9,
          disableForReducedMotion: true,
        });
      })
      .catch(() => {
        // The chunk did not load. Nothing else on the page depended on it.
      });

    return () => {
      cancelled = true;
    };
  }, [occasion, kind]);

  return null;
}
