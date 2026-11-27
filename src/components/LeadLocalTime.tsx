"use client";

// The lead's own clock — "9:07 AM" — on the lead page header, in its time
// zone, kept current. The zone's name is in the tooltip.

import { useEffect, useState } from "react";

export default function LeadLocalTime({ timeZone, label }: { timeZone: string; label: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  // Drawn on the client only, so the server's clock never shows.
  const text = now ? now.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" }) : "";
  return (
    <span className="num" title={`${label} time`}>
      {text}
    </span>
  );
}
