"use client";

// Kickoff call picker. A datetime-local input is wall-clock text with no zone
// attached, so the browser is the only side that can say which instant was
// meant: the chosen time is echoed back in both zones here and posted as an
// ISO instant in a hidden field for the server to store.

import { useEffect, useState } from "react";
import {
  KICKOFF_MINUTES,
  MEET_LIMITATION_NOTE,
  calendarEventUrl,
  kickoffCalendarDetails,
} from "@/lib/onboarding";
import {
  fmtDateTimeInZone,
  fromDateTimeLocalInput,
  sameWallClock,
  toDateTimeLocalInput,
  zoneAbbr,
  zoneLabel,
} from "@/lib/timezones";

export default function KickoffPicker({
  clinicName,
  timeZone,
  kickoffAt,
}: {
  clinicName: string;
  timeZone: string;
  kickoffAt: string | null; // ISO instant, or null if not scheduled yet
}) {
  // Converting the stored instant to a local wall-clock value needs the
  // browser's zone, so it happens after mount rather than during render.
  const [value, setValue] = useState("");
  useEffect(() => {
    setValue(
      kickoffAt ? toDateTimeLocalInput(new Date(kickoffAt)) : "",
    );
  }, [kickoffAt]);

  const picked = fromDateTimeLocalInput(value);
  const identical = picked ? sameWallClock(picked, undefined, timeZone) : false;

  return (
    <div className="space-y-5">
      <div>
        <label className="field-label" htmlFor="kickoffLocal">
          Kickoff call — date and time (your local time)
        </label>
        <input
          id="kickoffLocal"
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="field num"
        />
        {/* What the server actually stores. */}
        <input
          type="hidden"
          name="kickoffAt"
          value={picked ? picked.toISOString() : ""}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TimeCard
          heading="Your local time"
          zone={undefined}
          when={picked}
          highlight
        />
        <TimeCard
          heading={`${zoneLabel(timeZone)} — client's local time`}
          zone={timeZone}
          when={picked}
          footnote={identical ? "Same as yours" : undefined}
        />
      </div>

      <div className="rounded-[10px] border border-line bg-wash/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Schedule on Calendar</p>
            <p className="mt-0.5 text-xs text-muted">
              Opens a pre-filled Google Calendar event — you invite and save it.
            </p>
          </div>
          {picked ? (
            <a
              href={calendarEventUrl({
                title: `Kickoff call — ${clinicName}`,
                start: picked,
                minutes: KICKOFF_MINUTES,
                details: kickoffCalendarDetails(clinicName),
              })}
              target="_blank"
              rel="noreferrer"
              className="btn h-[34px] shrink-0 px-3.5 text-xs"
            >
              Schedule on Calendar ↗
            </a>
          ) : (
            <span className="btn h-[34px] shrink-0 cursor-not-allowed px-3.5 text-xs opacity-50">
              Schedule on Calendar ↗
            </span>
          )}
        </div>
        <p className="mt-3 border-t border-line/60 pt-3 text-xs leading-relaxed text-muted">
          {MEET_LIMITATION_NOTE}
        </p>
      </div>
    </div>
  );
}

function TimeCard({
  heading,
  zone,
  when,
  highlight = false,
  footnote,
}: {
  heading: string;
  zone: string | undefined;
  when: Date | null;
  highlight?: boolean;
  footnote?: string;
}) {
  // The viewer's own zone abbreviation is only knowable in the browser, so the
  // whole card waits for a picked value before it prints anything.
  return (
    <div
      className={`rounded-[10px] border px-4 py-3 ${
        highlight ? "border-accent/30 bg-accent/[0.04]" : "border-line"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium tracking-[0.02em] text-muted">
          {heading}
        </span>
        {when && (
          <span className="num shrink-0 text-[11px] text-muted">
            {zoneAbbr(when, zone)}
          </span>
        )}
      </div>
      <div className="num mt-1.5 text-sm font-medium">
        {when ? fmtDateTimeInZone(when, zone) : "Not scheduled yet"}
      </div>
      {footnote && <div className="mt-1 text-xs text-muted">{footnote}</div>}
    </div>
  );
}
