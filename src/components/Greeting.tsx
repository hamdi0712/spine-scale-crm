"use client";

// The dashboard's page title: one greeting out of a set, picked for the day.
//
// Which greeting is right depends on the clock and the calendar in front of the
// person reading it, and only the browser knows those — the server could be in
// any zone. Rather than render a dash and pop the title in on mount (the
// pattern the live clocks use, which would be jarring on a 32px heading), this
// renders the server's reading first and re-reads it from the browser after
// hydration. The two agree on the first render, so hydration is clean, and any
// correction lands before the page is settled.
//
// The pick is pseudo-random rather than random: it is seeded off the day, so
// the greeting is the same all day and different tomorrow. A greeting that
// reshuffled on every navigation would be a flicker on the largest text on the
// page, and one that never changed is the fixed line this replaced.

import { useEffect, useState } from "react";
import { daySeed, greetingFor } from "@/lib/greeting";

// Single-user app — the one person it greets is the one person who logs in.
const NAME = "Hamdi";

export default function Greeting({
  serverHour,
  serverWeekday,
  serverSeed,
}: {
  serverHour: number;
  serverWeekday: number;
  serverSeed: number;
}) {
  const [clock, setClock] = useState({
    hour: serverHour,
    weekday: serverWeekday,
    seed: serverSeed,
  });
  useEffect(() => {
    const now = new Date();
    setClock({
      hour: now.getHours(),
      weekday: now.getDay(),
      seed: daySeed(now),
    });
  }, []);

  return (
    <h1 className="display text-[32px] font-semibold">
      {greetingFor(clock.hour, clock.weekday, clock.seed)}, {NAME}{" "}
      <span role="img" aria-label="waving hand">
        👋
      </span>
    </h1>
  );
}
