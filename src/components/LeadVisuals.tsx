// The lead page's visual pieces: a section title with its coloured icon
// badge, the header's fact tiles, the score ring (drawn after Monk Mode's
// progress card) and the grouped activity timeline. Server components; every
// colour comes from the theme tokens, so light and dark both hold.

import {
  IconArrowBackUp,
  IconChecklist,
  IconMail,
  IconNote,
  IconPencil,
  IconSparkles,
  IconStarFilled,
  IconUserCheck,
} from "@tabler/icons-react";
import { fmtRelative } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";

export type Tone = "blue" | "indigo" | "teal" | "purple" | "amber" | "pink" | "neutral" | "green";

// Tinted square + coloured glyph, per tone.
export const TONE_BADGE: Record<Tone, string> = {
  blue: "bg-accent-soft text-accent",
  indigo: "bg-indigo-soft text-indigo",
  teal: "bg-teal-soft text-teal",
  purple: "bg-purple-soft text-purple",
  amber: "bg-warn-soft text-warn",
  pink: "bg-pink/15 text-pink",
  neutral: "bg-line/70 text-muted",
  green: "bg-ok-soft text-ok",
};

export function SectionTitle({
  id,
  icon,
  tone,
  children,
  aside,
}: {
  id: string;
  icon: React.ReactNode;
  tone: Tone;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${TONE_BADGE[tone]}`} aria-hidden>
        {icon}
      </span>
      <h2 id={id} className="text-lg font-semibold">
        {children}
      </h2>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  );
}

export function FactTile({ icon, tone, value, label, title }: { icon: React.ReactNode; tone: Tone; value: React.ReactNode; label: string; title?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line/80 bg-wash/60 px-3.5 py-3" title={title}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${TONE_BADGE[tone]}`} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="num truncate text-lg font-bold leading-tight text-ink">{value}</div>
        <div className="truncate text-xs text-muted">{label}</div>
      </div>
    </div>
  );
}

// ─── The score ring ────────────────────────────────────────────────────────

// One line under the ring, from where the points were lost: none lost, the
// fit short, or the signals short. Null for a lead nobody has scored.
export function scoreTip(fit: number, fitMax: number, signals: number, signalsMax: number): string {
  const fitGap = fitMax - fit;
  const sigGap = signalsMax - signals;
  if (fitGap === 0 && sigGap === 0) return "A perfect card — this is the clinic to reach out to first.";
  if (fitGap === 0) return "Perfect fit. Signals are the gap — buying triggers and budget are worth a closer look.";
  if (sigGap <= fitGap) return "Strong signals, a softer fit — check the fit lines on the scorecard before reaching out.";
  return "Some fit and signal points are missing — the scorecard shows which lines.";
}

const RING_TONE: Record<string, { stroke: string; text: string; glow: string }> = {
  A: { stroke: "stroke-teal", text: "text-teal", glow: "shadow-[0_0_40px_rgb(var(--c-teal)/0.18)]" },
  B: { stroke: "stroke-accent", text: "text-accent", glow: "shadow-[0_0_40px_rgb(var(--c-accent)/0.18)]" },
  C: { stroke: "stroke-warn", text: "text-warn", glow: "shadow-[0_0_40px_rgb(var(--c-warn)/0.16)]" },
};

export function ScoreRingCard({
  total,
  max,
  tier,
  parts,
  tip,
}: {
  total: number | null;
  max: number;
  tier: string | null;
  // The legend: each part's points against its maximum, and a dot colour.
  parts: { label: string; value: number; max?: number; dot: string }[];
  tip: string | null;
}) {
  const r = 76;
  const c = 2 * Math.PI * r;
  const pct = total === null || max <= 0 ? 0 : Math.max(0, Math.min(1, total / max));
  const tone = RING_TONE[tier ?? ""] ?? { stroke: "stroke-muted", text: "text-muted", glow: "" };
  return (
    <section aria-labelledby="icp-score" className="card card-sheen space-y-5 p-6 max-md:p-4">
      <div className="flex items-center gap-2.5">
        <IconStarFilled size={18} className={tone.text} aria-hidden />
        <h2 id="icp-score" className="text-lg font-bold">ICP score</h2>
        {tier && (
          <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-bold ${TONE_BADGE[tier === "A" ? "teal" : tier === "B" ? "blue" : "amber"]}`}>
            {tier}-tier
          </span>
        )}
      </div>
      <div className="flex justify-center">
        <div className={`relative h-44 w-44 rounded-full ${tone.glow}`}>
          <svg viewBox="0 0 176 176" className="h-44 w-44" role="img" aria-label={total === null ? "Not scored" : `${total} out of ${max}`}>
            <circle cx="88" cy="88" r={r} fill="none" className="stroke-line" strokeWidth="14" />
            {pct > 0 && (
              <circle
                cx="88"
                cy="88"
                r={r}
                fill="none"
                className={tone.stroke}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${pct * c} ${c}`}
                transform="rotate(-90 88 88)"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="num text-[40px] font-bold leading-none tracking-tight text-ink">{total ?? "—"}</span>
            <span className="num mt-1 text-sm text-muted">{total === null ? "Not scored" : `/ ${max}`}</span>
          </div>
        </div>
      </div>
      {parts.length > 0 && (
        <>
          <div className="h-px bg-line" />
          <ul className="space-y-3 text-[15px]">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full ${p.dot}`} aria-hidden />
                <span className="text-ink-soft">{p.label}</span>
                <span className="num ml-auto font-semibold text-ink">
                  {p.value}
                  {p.max !== undefined && <span className="font-normal text-muted"> / {p.max}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {tip && (
        <div className="flex items-center gap-3.5 rounded-2xl border border-accent/25 bg-accent-soft/50 px-4 py-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent-soft text-accent" aria-hidden>
            <IconStarFilled size={17} />
          </span>
          <p className="text-sm leading-snug text-ink-soft">{tip}</p>
        </div>
      )}
      <a href="#scorecard" className="inline-block text-sm font-medium text-accent hover:underline">
        Open scorecard →
      </a>
    </section>
  );
}

// ─── The timeline ──────────────────────────────────────────────────────────

export interface TimelineItem {
  id: string;
  kind: string; // an ActivityLog kind, or "NOTE"
  text: string;
  at: Date;
}

const KIND_ICON: Record<string, { icon: React.ReactNode; tone: Tone }> = {
  NOTE: { icon: <IconNote size={14} stroke={2} />, tone: "neutral" },
  CONTACT_FORM_SENT: { icon: <IconChecklist size={14} stroke={2} />, tone: "green" },
  CONNECTOR_CHANGE: { icon: <IconSparkles size={14} stroke={2} />, tone: "purple" },
  COPILOT_ACTION: { icon: <IconSparkles size={14} stroke={2} />, tone: "purple" },
  LEAD_CONVERTED: { icon: <IconUserCheck size={14} stroke={2} />, tone: "teal" },
};

function iconFor(item: TimelineItem) {
  if (KIND_ICON[item.kind]) return KIND_ICON[item.kind];
  if (/^undid/i.test(item.text)) return { icon: <IconArrowBackUp size={14} stroke={2} />, tone: "blue" as Tone };
  if (/email/i.test(item.text)) return { icon: <IconMail size={14} stroke={2} />, tone: "blue" as Tone };
  return { icon: <IconPencil size={14} stroke={2} />, tone: "neutral" as Tone };
}

function dayGroup(at: Date, now: Date): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return "Earlier";
}

export function Timeline({ items, now = new Date() }: { items: TimelineItem[]; now?: Date }) {
  const groups: { label: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const label = dayGroup(item.at, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label}</p>
          <ul className="relative space-y-4">
            <span className="absolute bottom-3 left-[13px] top-3 w-0.5 bg-line" aria-hidden />
            {g.items.map((item) => {
              const { icon, tone } = iconFor(item);
              return (
                <li key={item.id} className="relative flex gap-3">
                  <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-surface ring-4 ring-surface ${TONE_BADGE[tone]}`} aria-hidden>
                    {icon}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="whitespace-pre-wrap break-words text-sm text-ink">{item.text}</p>
                    <p className="num text-xs text-muted" title={fmtDateTime(item.at)}>{fmtRelative(item.at, now)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
