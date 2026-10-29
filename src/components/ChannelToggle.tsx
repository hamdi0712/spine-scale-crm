"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconBrandLinkedin, IconMail, IconPhone } from "@tabler/icons-react";
import { PIPELINE_CHANNEL_COOKIE, PipelineChannel } from "@/lib/emailChannel";

// The channel toggle beside the Pipeline and Discovery titles: Email,
// LinkedIn, and Call greyed out until it is built. Each page remembers its
// own choice, in its own cookie.
//
// The choice goes in a cookie rather than localStorage so the server reads it
// and renders the right view on first paint — no flash of the other channel.
// A year, per browser; nothing about it is stored on the server.
export default function ChannelToggle({
  channel,
  cookie = PIPELINE_CHANNEL_COOKIE,
  label = "Pipeline channel",
}: {
  channel: PipelineChannel;
  cookie?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState(channel);
  // The Call tooltip, drawn by hand rather than as a title so a tap shows it
  // on a phone too. Outside the segment, which clips on a phone.
  const [tip, setTip] = useState(false);

  function choose(next: PipelineChannel) {
    if (next === shown) return;
    setShown(next);
    document.cookie = `${cookie}=${next}; path=/; max-age=31536000; samesite=lax`;
    // A page opened with its channel in the URL (?channel=, from a link that
    // names one) would read that again on a refresh, so it is dropped.
    const url = new URL(window.location.href);
    if (url.searchParams.has("channel")) {
      url.searchParams.delete("channel");
      startTransition(() => router.replace(url.pathname + url.search));
    } else {
      startTransition(() => router.refresh());
    }
  }

  const item = (on: boolean) =>
    `segment-item px-2.5 ${on ? "segment-item-on" : ""} ${pending ? "cursor-progress" : ""}`;

  return (
    <div className="relative">
      <div className="segment" role="group" aria-label={label}>
        <button
          type="button"
          onClick={() => choose("email")}
          aria-pressed={shown === "email"}
          aria-label="Email"
          title="Email"
          className={item(shown === "email")}
        >
          <IconMail size={18} stroke={1.75} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => choose("linkedin")}
          aria-pressed={shown === "linkedin"}
          aria-label="LinkedIn"
          title="LinkedIn"
          className={item(shown === "linkedin")}
        >
          <IconBrandLinkedin size={18} stroke={1.75} aria-hidden />
        </button>
        <button
          type="button"
          aria-disabled
          aria-label="Call — coming in December"
          onMouseEnter={() => setTip(true)}
          onMouseLeave={() => setTip(false)}
          onFocus={() => setTip(true)}
          onBlur={() => setTip(false)}
          onClick={() => setTip((t) => !t)}
          className="segment-item cursor-not-allowed px-2.5 opacity-40 hover:text-muted"
        >
          <IconPhone size={18} stroke={1.75} aria-hidden />
        </button>
      </div>
      {tip && (
        <span
          role="tooltip"
          className="absolute right-0 top-full z-30 mt-1.5 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-surface shadow-card-hover"
        >
          Coming in December
        </span>
      )}
    </div>
  );
}
