// The Daily OS view of the Tasks page: the weekday routine as four blocks of
// tasks with time estimates, a day picker for this week, and the weekly
// scoreboard and sending rules beside it. Server-rendered; every tick is a form
// posting toggleDailyOsItem, and each task's "how" is a native <details>.

import type { CSSProperties } from "react";
import Link from "next/link";
import {
  IconAlertTriangle,
  IconBrandLinkedin,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconForms,
  IconMail,
  IconPhoneCall,
  IconPuzzle,
  IconSend,
  IconShieldCheck,
  IconSparkles,
  IconTrophy,
} from "@tabler/icons-react";
import { MonkGlassRing } from "@/components/MonkToday";
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
  progress,
}: {
  blocks: OsBlock[];
  days: OsDay[];
  day: OsDay;
  checked: Set<string>;
  // Share of each weekday's tasks ticked, by day key.
  progress: Record<string, number>;
}) {
  const all = blocks.flatMap((b) => b.tasks.map((t) => ({ b, t, key: osItemKey(b, t) })));
  const done = all.filter((x) => checked.has(x.key)).length;
  const minutesTotal = all.reduce((a, x) => a + x.t.minutes, 0);
  const minutesLeft = all.filter((x) => !checked.has(x.key)).reduce((a, x) => a + x.t.minutes, 0);
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-12 wide:gap-4">
      <div className="space-y-4 lg:col-span-8">
        {/* The day: a ring for how far through, the week's days with their
            own progress, and a bar split into the four blocks by how long each
            takes, each filling in its own colour. */}
        <section className="card card-sheen p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <MonkGlassRing done={done} partial={0} total={all.length} size={96} caption={`${done} of ${all.length}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[20px] font-semibold tracking-[-0.02em] wide:text-[18px]">
                  {FULL_DAY[day.label]}
                </h2>
                <span className="num text-[13px] text-muted">{day.date}</span>
                {day.isToday && (
                  <span className="inline-flex h-[20px] items-center gap-1.5 rounded-full bg-accent-soft px-2 text-[11px] font-semibold text-accent">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
                    Today
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
                <span className="flex items-center gap-1.5">
                  <IconClock size={15} stroke={1.75} aria-hidden />
                  <span className="num">
                    {minutesLeft === 0 ? "All done for the day" : `${fmtMinutes(minutesLeft)} left of ${fmtMinutes(minutesTotal)}`}
                  </span>
                </span>
                {day.future && <span>Starts on the day — read it now, tick it then.</span>}
              </div>
              <BlockBar blocks={blocks} checked={checked} total={minutesTotal} />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-5 gap-2">
            {days.map((d) => {
              const on = d.key === day.key;
              const p = progress[d.key] ?? 0;
              return (
                <Link
                  key={d.key}
                  href={`/activities?view=os&date=${d.key}`}
                  aria-current={on ? "date" : undefined}
                  className={`rounded-xl border px-3 py-2 transition-[background-color,border-color,box-shadow] ${
                    on
                      ? "border-accent/35 bg-accent-soft/60 shadow-[0_0_0_3px_rgb(var(--c-accent)/0.08)]"
                      : "border-line/70 bg-wash/40 hover:border-line hover:bg-wash/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[13px] font-semibold ${on ? "text-accent" : "text-ink"}`}>{d.label}</span>
                    {d.isToday && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="today" />}
                  </div>
                  <div className="num text-[11px] text-muted">{d.date.replace(/,\s*\d{4}$/, "")}</div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line/70">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(p * 100)}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
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
          <CardHead c="var(--c-warn)" title="Weekly scoreboard" sub="What a good week looks like">
            <IconTrophy size={16} stroke={1.75} aria-hidden />
          </CardHead>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {OS_SCOREBOARD.map((s, i) => {
              const look = SCORE_LOOK[i] ?? SCORE_LOOK[0];
              const Glyph = look.icon;
              return (
                <div
                  key={s.label}
                  className="relative overflow-hidden rounded-xl border border-line p-3"
                  style={{ background: `linear-gradient(150deg, rgb(${look.c} / 0.09), transparent 60%)` }}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ color: `rgb(${look.c})`, background: `rgb(${look.c} / 0.14)` }}>
                    <Glyph size={13} stroke={1.9} aria-hidden />
                  </span>
                  <div className="num mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{s.value}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{s.label}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card p-5">
          <CardHead c="var(--c-accent)" title="Sending rules" sub="Keep the inboxes healthy">
            <IconShieldCheck size={16} stroke={1.75} aria-hidden />
          </CardHead>
          <ol className="mt-4 space-y-2">
            {OS_RULES.map((r, i) => (
              <li key={r.lead} className="flex gap-3 rounded-xl border border-line/70 bg-gradient-to-b from-surface to-wash/30 p-3 text-[13px] leading-relaxed text-muted">
                <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                  {i + 1}
                </span>
                <span>
                  <b className="font-semibold text-ink">{r.lead}</b> {r.rest}
                </span>
              </li>
            ))}
          </ol>
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
                className={`flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                  on ? "text-white" : "border-[1.5px] border-line hover:border-muted"
                }`}
                style={
                  on
                    ? {
                        background: `linear-gradient(180deg, rgb(${c} / 0.85), rgb(${c}))`,
                        boxShadow: `0 0 0 3px rgb(var(--c-surface)), 0 0 0 4px rgb(${c} / 0.25), 0 3px 8px rgb(${c} / 0.35)`,
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
              <span className="min-w-0 flex-1 text-[14px] text-ink wide:text-[13px]">{t.label}</span>
              {on ? (
                <span
                  className="num shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ color: `rgb(${c})`, background: `rgb(${c} / 0.14)` }}
                >
                  Done · {fmtMinutes(t.minutes)}
                </span>
              ) : (
                <span className="num shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
                  {fmtMinutes(t.minutes)}
                </span>
              )}
            </>
          );
          return (
            <li
              key={key}
              className="flex items-start gap-3 rounded-xl border border-line/70 bg-surface px-3 py-2.5 transition-[background-color,border-color]"
              style={
                on
                  ? {
                      background: `linear-gradient(140deg, rgb(${c} / 0.13), rgb(${c} / 0.05))`,
                      borderColor: `rgb(${c} / 0.3)`,
                    }
                  : undefined
              }
            >
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

const FULL_DAY: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };

// One tone and glyph per scoreboard line, in OS_SCOREBOARD's order.
const SCORE_LOOK = [
  { c: "var(--c-teal)", icon: IconMail },
  { c: "var(--c-bad)", icon: IconAlertTriangle },
  { c: "var(--c-warn)", icon: IconForms },
  { c: "var(--c-ok)", icon: IconPhoneCall },
  { c: "var(--c-indigo)", icon: IconBrandLinkedin },
  { c: "var(--c-purple)", icon: IconPuzzle },
];

function CardHead({ c, title, sub, children }: { c: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="kpi-mark"
        style={
          {
            width: 32,
            height: 32,
            color: `rgb(${c})`,
            background: `linear-gradient(140deg, rgb(${c} / var(--mark-wash-a)), rgb(${c} / var(--mark-wash-b)))`,
            "--mark-halo": `rgb(${c} / var(--mark-halo-a))`,
          } as CSSProperties
        }
      >
        {children}
      </span>
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        <div className="text-xs text-muted">{sub}</div>
      </div>
    </div>
  );
}

// The day as one bar, split into the four blocks by how long each takes; each
// segment fills in its block's colour as its tasks are ticked.
function BlockBar({ blocks, checked, total }: { blocks: OsBlock[]; checked: Set<string>; total: number }) {
  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        {blocks.map((b) => {
          const mins = b.tasks.reduce((a, t) => a + t.minutes, 0);
          const doneMins = b.tasks.filter((t) => checked.has(osItemKey(b, t))).reduce((a, t) => a + t.minutes, 0);
          const c = TONE[b.tone];
          return (
            <div key={b.key} className="min-w-0" style={{ flex: `${mins} 1 0` }} title={`${b.name}: ${fmtMinutes(doneMins)} of ${fmtMinutes(mins)}`}>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: `rgb(${c} / 0.15)` }}>
                <div className="h-full rounded-full" style={{ width: `${mins ? (doneMins / mins) * 100 : 0}%`, background: `rgb(${c})` }} />
              </div>
              <div className="mt-1.5 truncate text-[11px] text-muted">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: `rgb(${c})` }} />
                {b.name}
              </div>
            </div>
          );
        })}
      </div>
      <span className="sr-only">{fmtMinutes(total)} in all</span>
    </div>
  );
}
