// Monk Mode's Today page, in the app's own card language: white (or dark)
// cards, the Dashboard's 3D icon discs, its blue glass, and nothing painted.
// One design for light and dark, laptop and big monitor — the old photograph
// banner and illustrated habit tiles are gone.
//
// Server components throughout. Every control is a form posting to the same
// actions the old grid used (bumpMonkHabit, setMonkHabitProgress), so the
// page works before hydration exactly as after it.

import type { CSSProperties, ReactNode } from "react";
import {
  IconBook2,
  IconBrain,
  IconCheck,
  IconDeviceLaptop,
  IconDroplet,
  IconHeartbeat,
  IconLeaf,
  IconMoonStars,
  IconPlus,
  IconSparkles,
} from "@tabler/icons-react";
import Link from "next/link";
import {
  ChallengeProgress,
  MonkDayCell,
  MonkHabitDay,
  MonkMonth,
  monkAccent,
} from "@/lib/monkMode";
import { bumpMonkHabit, setMonkHabitProgress } from "@/lib/actions/monkMode";
import MonkIcon from "@/components/MonkIcon";

// ─── Habit colours and glyphs ─────────────────────────────────────────────
//
// The seven default habits each get their own hue, none of them blue (blue is
// the card headings' colour) and none of them the green of "done". Keyed off
// the habit's icon key, as the old artwork was, so renaming a habit keeps its
// look. Any other habit falls back to its chosen accent and icon.
type Look = { rgb: string; Glyph?: typeof IconBrain };
const LOOKS: Record<string, Look> = {
  ban: { rgb: "124 58 237", Glyph: IconBrain }, // violet
  mosque: { rgb: "13 148 136", Glyph: IconMoonStars }, // teal
  book: { rgb: "202 138 4", Glyph: IconBook2 }, // gold
  droplet: { rgb: "219 39 119", Glyph: IconDroplet }, // pink
  meditation: { rgb: "101 163 13", Glyph: IconLeaf }, // lime
  laptop: { rgb: "234 88 12", Glyph: IconDeviceLaptop }, // orange
  dumbbell: { rgb: "225 29 72", Glyph: IconHeartbeat }, // rose
};

function lookFor(row: MonkHabitDay): { rgb: string; glyph: ReactNode } {
  const look = LOOKS[row.habit.icon];
  if (look?.Glyph) {
    return { rgb: look.rgb, glyph: <look.Glyph size={17} stroke={1.75} aria-hidden /> };
  }
  // A habit outside the seven: its own accent, through the theme variable.
  const token = monkAccent(row.habit.accent).token.replace(/^var\((.*)\)$/, "var($1)");
  return { rgb: token, glyph: <MonkIcon name={row.habit.icon} size={17} /> };
}

// The Dashboard's KPI disc (.kpi-mark): a wash of the hue, a lit top edge and
// a halo. --mark-wash-a/-b and the halo strength already switch per theme.
export function MonkMark({
  rgb,
  size = 36,
  children,
}: {
  rgb: string;
  size?: number;
  children: ReactNode;
}) {
  const c = rgb.startsWith("var(") ? rgb : rgb;
  return (
    <span
      className="kpi-mark"
      style={
        {
          width: size,
          height: size,
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

const ACCENT = "var(--c-accent)";

// A card heading: the blue disc, the title, and whatever sits at the right.
export function MonkCardHead({
  icon,
  title,
  sub,
  aside,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <MonkMark rgb={ACCENT} size={32}>
          {icon}
        </MonkMark>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] wide:text-[15px]">{title}</h2>
          {sub && <div className="text-[13px] text-muted wide:text-xs">{sub}</div>}
        </div>
      </div>
      {aside}
    </div>
  );
}

// ─── The challenge bar ─────────────────────────────────────────────────────

export function MonkChallengeBar({ cells, shape }: { cells: MonkDayCell[]; shape: ChallengeProgress }) {
  if (cells.length > 40) {
    const pct = shape.total > 0 ? (shape.elapsed / shape.total) * 100 : 0;
    return (
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-wash shadow-[inset_0_0_0_1px_rgb(var(--c-line))]">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    );
  }
  return (
    <div className="mt-4 flex gap-1" aria-hidden>
      {cells.map((cell) => {
        let cls = "bg-wash shadow-[inset_0_0_0_1px_rgb(var(--c-line))]";
        if (cell.complete) cls = "bg-accent";
        else if (cell.isToday) cls = "bg-accent/25 shadow-[inset_0_0_0_1.5px_rgb(var(--c-accent))]";
        else if (cell.past && cell.completion > 0) cls = "bg-accent/40";
        return (
          <span
            key={cell.key}
            title={`Day ${cell.dayNumber} · ${Math.round(cell.completion * 100)}%`}
            className={`h-2 flex-1 rounded-full ${cls}`}
          />
        );
      })}
    </div>
  );
}

// ─── The habits ────────────────────────────────────────────────────────────

export function MonkHabitList({ rows, day }: { rows: MonkHabitDay[]; day: string }) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted">
        No habits yet. Add your non-negotiables under{" "}
        <Link href="/monk-mode/settings" className="font-medium text-accent hover:underline">
          Habits
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <HabitRow key={row.habit.id} row={row} day={day} />
      ))}
      {/* Fills the odd slot so the grid ends square, and is useful while at it. */}
      {rows.length % 2 === 1 && (
        <Link
          href="/monk-mode/settings"
          className="flex h-[72px] items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[13px] font-medium text-muted transition-colors hover:bg-wash hover:text-ink max-sm:hidden"
        >
          <IconPlus size={16} stroke={1.75} aria-hidden />
          Edit habits
        </Link>
      )}
    </div>
  );
}

function HabitRow({ row, day }: { row: MonkHabitDay; day: string }) {
  const { rgb, glyph } = lookFor(row);
  const done = row.status === "complete";
  const multi = row.target > 1;
  const c = `rgb(${rgb})`;
  const status = done
    ? null
    : multi
      ? `${row.done} of ${row.target}`
      : row.status === "missed"
        ? "Missed"
        : "Not yet";

  return (
    <div
      className="relative flex h-[72px] items-center gap-4 rounded-xl border border-line bg-surface px-4"
      style={
        done
          ? {
              background: `linear-gradient(140deg, rgb(${rgb} / 0.13), rgb(${rgb} / 0.05))`,
              borderColor: `rgb(${rgb} / 0.3)`,
            }
          : undefined
      }
    >
      <MonkMark rgb={rgb}>{glyph}</MonkMark>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold wide:text-[13px]" title={row.habit.description ?? undefined}>
          {row.habit.name}
        </div>
        <div className="mt-0.5 text-[12.5px] text-muted wide:text-xs">
          {done ? <span style={{ color: c }}>Done</span> : status}
        </div>
        {multi && (
          <div className="mt-1.5 flex w-[120px] gap-1">
            {Array.from({ length: row.target }, (_, i) => {
              const n = i + 1;
              const filled = row.done >= n;
              return (
                <form key={n} action={setMonkHabitProgress.bind(null, row.habit.id, day, filled ? n - 1 : n)} className="flex-1">
                  <button
                    type="submit"
                    aria-label={`${row.habit.name}: ${filled ? n - 1 : n} of ${row.target}`}
                    className="block h-1 w-full rounded-full"
                    style={{ background: filled ? c : "rgb(var(--c-line))" }}
                  />
                </form>
              );
            })}
          </div>
        )}
      </div>
      <form action={bumpMonkHabit.bind(null, row.habit.id, day)}>
        <button
          type="submit"
          aria-label={multi ? `${row.habit.name}: ${row.done} of ${row.target}` : `${row.habit.name}: ${done ? "done" : "not yet"}`}
          className={`flex h-[26px] w-[26px] items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
            done ? "text-white" : "border-[1.5px] border-line hover:border-muted"
          }`}
          style={
            done
              ? {
                  background: `linear-gradient(180deg, rgb(${rgb} / 0.85), ${c})`,
                  boxShadow: `0 0 0 3px rgb(var(--c-surface)), 0 0 0 4px rgb(${rgb} / 0.25), 0 3px 8px rgb(${rgb} / 0.35)`,
                }
              : undefined
          }
        >
          {done && <IconCheck size={14} stroke={2.5} aria-hidden />}
        </button>
      </form>
    </div>
  );
}

// ─── Today's progress ─────────────────────────────────────────────────────

// The ring, drawn for this page: a frosted track, a blue arc for what is
// done, a lighter blue run for what is part-done, and the blue glass in the
// middle. Colours come from .monk-ring-* in globals.css, which switch per theme.
export function MonkGlassRing({ done, partial, total }: { done: number; partial: number; total: number }) {
  const S = 152;
  const C = S / 2;
  const R = 58;
  const W = 14;
  const L = 2 * Math.PI * R;
  const pDone = total > 0 ? done / total : 0;
  const pBoth = total > 0 ? (done + partial) / total : 0;
  const ang = -Math.PI / 2 + 2 * Math.PI * pDone;
  const pct = Math.round(pDone * 100);
  return (
    <div className="relative shrink-0" style={{ width: S, height: S }}>
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="absolute inset-0 overflow-visible" role="img" aria-label={`${done} of ${total} done`}>
        <defs>
          <linearGradient id="monk-ring-track" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="monk-ring-track-a" />
            <stop offset="1" className="monk-ring-track-b" />
          </linearGradient>
          <linearGradient id="monk-ring-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="monk-ring-arc-a" />
            <stop offset="1" className="monk-ring-arc-b" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={R} fill="none" stroke="url(#monk-ring-track)" strokeWidth={W} />
        <circle cx={C} cy={C} r={R + W / 2 - 0.5} fill="none" className="monk-ring-edge" strokeWidth={1} />
        <circle cx={C} cy={C} r={R - W / 2 + 0.5} fill="none" className="monk-ring-inner" strokeWidth={1.2} />
        {pBoth > 0 && (
          <circle cx={C} cy={C} r={R} fill="none" className="monk-ring-partial" strokeWidth={W} strokeLinecap="round" strokeDasharray={`${L * pBoth} ${L}`} transform={`rotate(-90 ${C} ${C})`} />
        )}
        {pDone > 0 && (
          <>
            <circle cx={C} cy={C} r={R} fill="none" stroke="url(#monk-ring-arc)" strokeWidth={W} strokeLinecap="round" strokeDasharray={`${L * pDone} ${L}`} transform={`rotate(-90 ${C} ${C})`} className="monk-ring-glow" />
            <circle cx={C + R * Math.cos(ang)} cy={C + R * Math.sin(ang)} r={4.5} className="monk-ring-knob" strokeWidth={1.5} />
          </>
        )}
      </svg>
      <div className="glass-panel absolute flex flex-col items-center justify-center rounded-full border" style={{ inset: C - R + W / 2 + 6 }}>
        <div className="num text-[26px] font-semibold leading-none tracking-[-0.02em]">{pct}%</div>
        <div className="num mt-1 text-[11px] text-muted">
          {done} of {total}
        </div>
      </div>
    </div>
  );
}

export function MonkLegend({ done, partial, notYet }: { done: number; partial: number; notYet: number }) {
  const items: [string, number, string][] = [
    ["Completed", done, "bg-accent"],
    ["In progress", partial, "monk-dot-partial"],
    ["Not yet", notYet, "monk-dot-rest"],
  ];
  return (
    <div className="flex flex-1 flex-col gap-4">
      {items.map(([label, n, dot]) => (
        <div key={label} className="flex items-center justify-between text-[14px] wide:text-[13px]">
          <span className="flex items-center gap-2 text-ink-soft">
            <i className={`h-2 w-2 rounded-full ${dot}`} />
            {label}
          </span>
          <b className="num font-semibold">{n}</b>
        </div>
      ))}
    </div>
  );
}

export function MonkStatTile({ label, value, unit, foot }: { label: string; value: number; unit: string; foot: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-gradient-to-b from-surface to-wash/40 p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]">
        <span className="num">{value}</span>
        <span className="ml-1 text-xs font-normal text-muted">{unit}</span>
      </div>
      {foot}
    </div>
  );
}

export function MonkWeekStrip({ cells }: { cells: MonkDayCell[] }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {cells.map((cell) => (
        <div key={cell.key} className="flex flex-col items-center gap-1.5">
          <i
            className={`block h-2 w-full rounded-full ${
              cell.complete
                ? "bg-accent"
                : cell.isToday
                  ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_rgb(var(--c-accent))]"
                  : cell.past && cell.completion > 0
                    ? "bg-accent/40"
                    : "bg-wash shadow-[inset_0_0_0_1px_rgb(var(--c-line))]"
            }`}
          />
          <span className={`text-[11px] ${cell.isToday ? "font-semibold text-accent" : "text-muted/70"}`}>{cell.label}</span>
        </div>
      ))}
    </div>
  );
}

// The Dashboard's "Now" banner, holding the run's encouragement.
export function MonkNoteBanner({ text }: { text: string }) {
  const cut = text.indexOf(". ");
  const head = cut > 0 ? text.slice(0, cut) : text;
  const rest = cut > 0 ? text.slice(cut + 2) : null;
  return (
    <div className="glass-panel flex items-center gap-4 !rounded-[18px] border p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--glass-chip-strong)] text-accent shadow-[0_1px_2px_rgba(28,27,39,0.07)]">
        <IconSparkles size={18} stroke={1.75} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{head}</span>
        {rest && <span className="mt-0.5 block text-xs text-muted">{rest}</span>}
      </span>
    </div>
  );
}

// ─── The month ─────────────────────────────────────────────────────────────

export function MonkMonthGrid({ month }: { month: MonkMonth }) {
  return (
    <div className="grid grid-cols-7 gap-y-1 text-center">
      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
        <span key={i} className="flex h-6 items-center justify-center text-[11px] font-medium text-muted/70">
          {d}
        </span>
      ))}
      {month.cells.map((cell, i) => {
        const inMonth = month.inMonth[i];
        let cls = "text-ink-soft";
        if (!inMonth) cls = "text-muted/40";
        else if (cell.isToday) cls = "bg-accent font-semibold text-white";
        else if (cell.complete) cls = "bg-accent-soft font-semibold text-accent";
        else if (cell.past && cell.dayNumber !== null && cell.completion > 0) cls = "text-ink-soft underline decoration-accent/50 decoration-2 underline-offset-4";
        return (
          <span
            key={cell.key}
            title={cell.dayNumber !== null ? `Day ${cell.dayNumber} · ${Math.round(cell.completion * 100)}%` : undefined}
            className={`num flex h-8 items-center justify-center rounded-lg text-xs ${cls}`}
          >
            {cell.day.getUTCDate()}
          </span>
        );
      })}
    </div>
  );
}
