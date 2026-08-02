"use client";

// The month grid and the agenda beside it. Read-only: every row links through
// to the record the date actually lives on, and nothing is edited here.
//
// Two things arrive from the server as a first guess and are corrected on
// mount — which day it is, and which day a call falls on — because both depend
// on the viewer's zone and only the browser knows it. The initial render uses
// the server's reading so hydration matches, then an effect switches to the
// browser's. The same reason every clock in the app waits for mount.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildMonth,
  CALENDAR_KINDS,
  CALENDAR_KIND_STYLES,
  CalendarEvent,
  cellDots,
  fmtDayKey,
  groupByDay,
  localDayKey,
  parseDayKey,
  PlacedEvent,
  placeEvents,
  shiftMonth,
  WEEKDAYS,
} from "@/lib/calendar";
import { fmtTimeInZone } from "@/lib/timezones";
import Icon from "@/components/Icons";

// How many dots a cell shows before the rest fold into a "+n". Four keeps the
// row on one line at every cell width the grid takes.
const MAX_DOTS = 4;

export default function CalendarMonth({
  events,
  serverToday,
  serverNow,
}: {
  events: CalendarEvent[];
  serverToday: string; // "YYYY-MM-DD" as the server reads it
  serverNow: string; // ISO instant, captured with it
}) {
  const [mounted, setMounted] = useState(false);
  const [todayKey, setTodayKey] = useState(serverToday);
  const [now, setNow] = useState(() => new Date(serverNow));
  // Null means "wherever today is" / "today", so a correction on mount carries
  // both of them along without any state to keep in step.
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const browserNow = new Date();
    setNow(browserNow);
    setTodayKey(localDayKey(browserNow));
    setMounted(true);
  }, []);

  const placed = useMemo(
    () => placeEvents(events, { now, todayKey, local: mounted }),
    [events, now, todayKey, mounted],
  );
  const byDay = useMemo(() => groupByDay(placed), [placed]);

  const { year, month } = cursor ?? parseDayKey(todayKey);
  const view = useMemo(() => buildMonth(year, month), [year, month]);
  const selectedKey = selected ?? todayKey;
  const agenda = byDay.get(selectedKey) ?? [];

  const go = (delta: number) => setCursor(shiftMonth(year, month, delta));
  const goToday = () => {
    setCursor(null);
    setSelected(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="card">
        <div className="flex items-center justify-between gap-4 border-b border-line/60 px-5 py-4">
          <h2 className="display text-lg font-semibold">{view.label}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToday}
              className="h-8 rounded-[10px] px-3 text-xs font-medium text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              Today
            </button>
            <div className="flex overflow-hidden rounded-[10px] border border-line">
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous month"
                className="flex h-8 w-8 items-center justify-center text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
              >
                <Icon name="chevronLeft" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next month"
                className="flex h-8 w-8 items-center justify-center border-l border-line text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
              >
                <Icon name="chevronRight" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-line/60 bg-wash/50">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-xs font-medium tracking-[0.02em] text-muted"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {view.cells.map((cell) => (
            <DayCell
              key={cell.key}
              dayKey={cell.key}
              day={cell.day}
              inMonth={cell.inMonth}
              isToday={cell.key === todayKey}
              isSelected={cell.key === selectedKey}
              events={byDay.get(cell.key) ?? []}
              onSelect={() => {
                setSelected(cell.key);
                if (!cell.inMonth) setCursor(parseDayKey(cell.key));
              }}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/60 bg-wash/50 px-5 py-3">
          {CALENDAR_KINDS.map((kind) => (
            <span
              key={kind}
              className="inline-flex items-center gap-2 text-xs text-muted"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${CALENDAR_KIND_STYLES[kind].dot}`}
              />
              {CALENDAR_KIND_STYLES[kind].label}
            </span>
          ))}
        </div>
      </div>

      <Agenda dayKey={selectedKey} events={agenda} mounted={mounted} />
    </div>
  );
}

// ─── A day in the grid ─────────────────────────────────────────────────────

// Cells stay deliberately quiet: the date, and a dot per thing happening. What
// those things are is the agenda's job — cramming the text in here would make
// the month unreadable at exactly the moment it has something to say.
function DayCell({
  dayKey,
  day,
  inMonth,
  isToday,
  isSelected,
  events,
  onSelect,
}: {
  dayKey: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  events: PlacedEvent[];
  onSelect: () => void;
}) {
  const { dots, extra } = cellDots(events, MAX_DOTS);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-label={`${fmtDayKey(dayKey)} — ${
        events.length === 1 ? "1 item" : `${events.length} items`
      }`}
      className={`flex h-[92px] flex-col items-start gap-1.5 border-b border-r border-line/60 p-2 text-left transition-colors last:border-r-0 [&:nth-child(7n)]:border-r-0 ${
        isSelected ? "bg-accent/[0.05]" : inMonth ? "hover:bg-wash/60" : "bg-wash/30 hover:bg-wash/50"
      }`}
    >
      <span
        className={`num flex h-6 w-6 items-center justify-center rounded-full text-xs ${
          isToday
            ? "bg-accent font-medium text-white"
            : inMonth
              ? "font-medium text-ink"
              : "text-muted/60"
        }`}
      >
        {day}
      </span>
      {events.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          {dots.map((event) => (
            <span
              key={event.id}
              title={`${event.title} — ${event.detail}`}
              className={`h-1.5 w-1.5 rounded-full ${CALENDAR_KIND_STYLES[event.kind].dot} ${
                inMonth ? "" : "opacity-50"
              }`}
            />
          ))}
          {extra > 0 && (
            <span className="num text-[10px] leading-none text-muted">
              +{extra}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

// ─── The agenda ────────────────────────────────────────────────────────────

function Agenda({
  dayKey,
  events,
  mounted,
}: {
  dayKey: string;
  events: PlacedEvent[];
  mounted: boolean;
}) {
  const overdue = events.filter((e) => e.overdue).length;
  return (
    <div className="card px-5 py-4">
      <h2 className="display text-base font-semibold">{fmtDayKey(dayKey)}</h2>
      <p className="mt-1 text-xs text-muted">
        {events.length === 0
          ? "Nothing on this day"
          : `${events.length === 1 ? "1 item" : `${events.length} items`}${
              overdue > 0 ? ` · ${overdue} overdue` : ""
            }`}
      </p>
      {events.length > 0 && (
        <ul className="-mx-2 mt-3">
          {events.map((event) => (
            <AgendaRow key={event.id} event={event} mounted={mounted} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgendaRow({
  event,
  mounted,
}: {
  event: PlacedEvent;
  mounted: boolean;
}) {
  const style = CALENDAR_KIND_STYLES[event.kind];
  // A call's wall-clock reading belongs to whoever is looking, so it arrives
  // after mount like every other time in the app.
  const time = event.at ? (mounted ? fmtTimeInZone(new Date(event.at)) : "—") : null;
  return (
    <li>
      <Link
        href={event.href}
        className="flex items-start gap-3 rounded-[10px] px-2 py-2.5 hover:bg-wash/70"
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.soft} ${style.text}`}
        >
          <Icon name={style.icon} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {event.title}
            </span>
            {time && (
              <span
                className={`num shrink-0 text-xs ${event.overdue ? "text-bad" : "text-muted"}`}
              >
                {time}
              </span>
            )}
          </span>
          <span
            className={`mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs ${
              event.overdue ? "text-bad" : "text-muted"
            }`}
          >
            <span>{event.detail}</span>
            {event.meta && <span>· {event.meta}</span>}
            {event.overdue && (
              <span className="inline-flex h-[18px] items-center rounded-full bg-bad-soft px-2 text-[11px] font-medium text-bad">
                Overdue
              </span>
            )}
          </span>
        </span>
        <Icon name="chevronRight" className="mt-1 h-4 w-4 shrink-0 text-muted/70" />
      </Link>
    </li>
  );
}
