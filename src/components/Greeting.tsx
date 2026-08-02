"use client";

// The dashboard's page title: a greeting that tracks the time of day.
//
// Which greeting is right depends on the clock in front of the person reading
// it, and only the browser knows that — the server could be in any zone. Rather
// than render a dash and pop the title in on mount (the pattern the live clocks
// use, which would be jarring on a 32px heading), this renders the server's
// reading first and re-reads it from the browser after hydration. The two agree
// on the first render, so hydration is clean, and any correction lands before
// the page is settled.

import { useEffect, useState } from "react";

// Single-user app — the one person it greets is the one person who logs in.
const NAME = "Hamdi";

// Before noon, morning; noon to 5pm, afternoon; from 5pm on, evening.
export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function Greeting({ serverHour }: { serverHour: number }) {
  const [hour, setHour] = useState(serverHour);
  useEffect(() => setHour(new Date().getHours()), []);

  return (
    <h1 className="display text-[32px] font-semibold">
      {greetingFor(hour)}, {NAME}{" "}
      <span role="img" aria-label="waving hand">
        👋
      </span>
    </h1>
  );
}
