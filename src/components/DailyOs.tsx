// The Daily OS view of the Tasks page: the weekday routine as four blocks of
// tasks with time estimates, a day picker for this week, and the weekly
// scoreboard and sending rules beside it. Server-rendered; every tick is a form
// posting toggleDailyOsItem, and each task's "how" is a native <details>.

import type { CSSProperties } from "react";
import Link from "next/link";
import {
  IconBrandLinkedin,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconMail,
  IconSend,
  IconSparkles,
} from "@tabler/icons-react";
import {
  OS_AFTER_CLIENT,
  OS_RULES,
  OS_SCOREBOARD,
  OS_WEEKDAYS,
  OsBlock,
  fmtMinutes,
  osItemKey,
} from "@/lib/dailyOs";
import { toggleDailyOsItem } from "@/lib/actions/dailyOs";

const TONE: Record<OsBlock["tone"], string> = {
  teal: "var(--c-teal)",
  warn: "var(--c-warn)",
  indigo: "var(--c-indigo)",
  bad: "var(--c-bad)",
};

const ICON = {
  mail: IconMail,
  spark: IconSparkles,
  linkedin: IconBrandLinkedin,
  send: IconSend,
};

export interface OsDay {
  key: string; // yyyy-mm-dd
  label: string; // Mon
  date: string; // Nov 9
  future: boolean;
  isToday: boolean;
}

function Mark({ c, children }: { c: string; children: React.ReactNode }) {
  return (
    <span
      className="kpi-mark"
      style={
        {
          width: 36,
          height: 36,
          color: `rgb(${c})`,
          background: `linear-gradient(140deg, rgb(${c} / var(--mark-wash-a)), rgb(${c} / var(--mark-wash-b)))`,
          "--mark-halo": `rgb(${c} / var(--mark-halo-a))`,
        } as CSSProperties
      }
    >
      {children}
    </span>
  );
}

export default function DailyOs({
  blocks,
  days,
  day,
  checked,
}: {
  blocks: OsBlock[];
  days: OsDay[];
  day: OsDay;
  checked: Set<string>;
}) {
  const all = blocks.flatMap((b) => b.tasks.map((t) => ({ b, t, key: osItemKey(b, t) })));
  const done = all.filter((x) => checked.has(x.key)).length;
  const minutesTotal = all.reduce((a, x) => a + x.t.minutes, 0);
  const minutesLeft = all.filter((x) => !checked.has(x.key)).reduce((a, x) => a + x.t.minutes, 0);
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-12 wide:gap-4">
      <div className="space-y-4 lg:col-span-8">
        {/* The day: which weekday, how far through, how long is left. */}
        <section className="glass-panel !rounded-[18px] border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="segment" role="group" aria-label="Day">
              {days.map((d) => (
                <Link
                  key={d.key}
                  href={`/activities?view=os&date=${d.key}`}
                  className={`segment-item gap-1.5 ${d.key === day.key ? "segment-item-on" : ""}`}
                >
                  {d.label}
                  {d.isToday && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="today" />}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-4 text-[13px]">
              <span className="text-muted">
                <b className="num font-semibold text-ink">{done}</b> of {all.length} done
              </span>
              <span className="flex items-center gap-1.5 text-muted">
                <IconClock size={15} stroke={1.75} aria-hidden />
                <span className="num">
                  {minutesLeft === 0 ? "All done" : `${fmtMinutes(minutesLeft)} left of ${fmtMinutes(minutesTotal)}`}
                </span>
              </span>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface/70 shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          {day.future && (
            <p className="mt-3 text-xs text-muted">{day.date} hasn&rsquo;t started yet — you can read it, and tick it on the day.</p>
          )}
        </section>

        {blocks.map((block, i) => (
          <div key={block.key}>
            {/* The gap before the US window: prep is done in the morning, the
                sending happens when the US is awake. */}
            {i === 3 && (
              <div className="mb-4 flex items-center gap-3 text-[11px] font-medium text-muted">
                <span className="h-px flex-1 bg-line" />
                Break · then the US window
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <Block block={block} day={day} checked={checked} />
          </div>
        ))}
      </div>

      <aside className="space-y-4 lg:col-span-4">
        <section className="card p-5">
          <h2 className="text-[15px] font-semibold">Weekly scoreboard</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {OS_SCOREBOARD.map((s) => (
              <div key={s.label} className="rounded-xl border border-line bg-gradient-to-b from-surface to-wash/40 p-3">
                <div className="num text-[22px] font-semibold leading-tight tracking-[-0.02em]">{s.value}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-[15px] font-semibold">Sending rules</h2>
          <ul className="mt-3 space-y-2.5">
            {OS_RULES.map((r) => (
              <li key={r.lead} className="flex gap-2.5 text-[13px] leading-relaxed text-muted">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span>
                  <b className="font-semibold text-ink">{r.lead}</b> {r.rest}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass-panel flex items-center gap-4 !rounded-[18px] border p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--glass-chip-strong)] text-accent shadow-[0_1px_2px_rgba(28,27,39,0.07)]">
            <IconSparkles size={18} stroke={1.75} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">After client #1</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">{OS_AFTER_CLIENT}</span>
          </span>
        </section>
      </aside>
    </div>
  );
}

function Block({ block, day, checked }: { block: OsBlock; day: OsDay; checked: Set<string> }) {
  const c = TONE[block.tone];
  const Glyph = ICON[block.icon];
  const total = block.tasks.reduce((a, t) => a + t.minutes, 0);
  const doneHere = block.tasks.filter((t) => checked.has(osItemKey(block, t))).length;
  const complete = doneHere === block.tasks.length;

  return (
    <section
      className="card p-5"
      style={complete ? { borderColor: `rgb(${c} / 0.35)` } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Mark c={c}>
            <Glyph size={17} stroke={1.75} aria-hidden />
          </Mark>
          <div className="min-w-0">
            <div className="text-[11px] font-medium" style={{ color: `rgb(${c})` }}>
              {block.tag}
            </div>
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] wide:text-[15px]">{block.name}</h2>
          </div>
        </div>
        <span className="num inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-wash px-2 text-[11px] font-semibold text-muted">
          {doneHere}/{block.tasks.length} · ≈ {fmtMinutes(total)}
        </span>
      </div>

      <ul className="mt-4 space-y-1.5">
        {block.tasks.map((t) => {
          const key = osItemKey(block, t);
          const on = checked.has(key);
          const check = (
            <form action={toggleDailyOsItem.bind(null, day.key, key)}>
              <button
                type="submit"
                disabled={day.future}
                aria-label={`${t.label}: ${on ? "done" : "not done"}`}
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                  on ? "text-white" : "border-[1.5px] border-line hover:border-muted"
                }`}
                style={
                  on
                    ? {
                        background: `linear-gradient(180deg, rgb(${c} / 0.85), rgb(${c}))`,
                        boxShadow: `0 0 0 2px rgb(var(--c-surface)), 0 0 0 3px rgb(${c} / 0.25), 0 2px 6px rgb(${c} / 0.3)`,
                      }
                    : undefined
                }
              >
                {on && <IconCheck size={13} stroke={2.75} aria-hidden />}
              </button>
            </form>
          );
          const row = (
            <>
              <span className={`min-w-0 flex-1 text-[14px] wide:text-[13px] ${on ? "text-muted line-through decoration-muted/60" : "text-ink"}`}>
                {t.label}
              </span>
              <span className="num shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
                {fmtMinutes(t.minutes)}
              </span>
            </>
          );
          return (
            <li key={key} className="flex items-start gap-3 rounded-xl border border-line/70 bg-surface px-3 py-2.5">
              <span className="pt-px">{check}</span>
              {t.how ? (
                <details className="group min-w-0 flex-1">
                  <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                    {row}
                    <IconChevronDown
                      size={15}
                      stroke={1.75}
                      aria-hidden
                      className="shrink-0 text-muted transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{t.how}</p>
                </details>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {row}
                  <span className="w-[15px] shrink-0" aria-hidden />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
