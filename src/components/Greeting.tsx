"use client";

// The dashboard's page title: one greeting out of the set that fits the moment.
//
// A fresh pick on every load. The page is force-dynamic, so the server runs
// again on every visit and refresh and rolls a new greeting each time — which
// is the behaviour: a morning of refreshes should read as a morning of
// different morning greetings, not one line repeated. (The quotation below it
// is the opposite and deliberately so — that one is chosen once a day and held.)
//
// Which greetings fit depends on the clock and the calendar in front of the
// person reading it, and only the browser knows those — the server could be in
// any zone. So the server's pick is rendered first and the browser checks it
// after hydration: if it is a greeting this moment could have produced, it
// stands, and if it is not — a server on the other side of the world saying
// "Good evening" over somebody's coffee — the browser rolls its own from the
// right bucket. The first render is the server's either way, so hydration is
// clean, and the heading only ever changes when it was actually wrong.

import { useEffect, useState } from "react";
import { greetingFits, greetingFor } from "@/lib/greeting";

// Single-user app — the one person it greets is the one person who logs in.
const NAME = "Hamdi";

export default function Greeting({ serverGreeting }: { serverGreeting: string }) {
  const [greeting, setGreeting] = useState(serverGreeting);

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    const weekday = now.getDay();
    setGreeting((current) =>
      greetingFits(current, hour, weekday)
        ? current
        : greetingFor(hour, weekday),
    );
    // Keyed on the server's pick so a client-side navigation back to the
    // dashboard — a new render, a new greeting — is re-checked rather than
    // left holding the last one this effect approved.
  }, [serverGreeting]);

  return (
    <h1 className="display text-[32px] font-semibold">
      {greeting}, {NAME}{" "}
      <span role="img" aria-label="waving hand">
        👋
      </span>
    </h1>
  );
}
