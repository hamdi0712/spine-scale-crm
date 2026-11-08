"use client";

// The sidebar's search box and the ⌘K palette it opens: jump to any page, or
// to a clinic anywhere in the app (clients, pipeline leads, Discovery
// candidates — /api/search). Arrow keys move, Enter opens, Escape closes.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IconCornerDownLeft, IconSearch } from "@tabler/icons-react";
import { DASHBOARD, NAV_GROUPS, SETTINGS } from "@/components/navConfig";

interface Hit {
  kind: string;
  title: string;
  sub?: string;
  href: string;
}

const PAGES: Hit[] = [
  { kind: "Page", title: DASHBOARD.label, href: DASHBOARD.href },
  ...NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ kind: "Page", title: i.label, sub: g.headless ? undefined : g.label, href: i.href }))),
  { kind: "Page", title: "Ask Iman", href: "/copilot" },
  { kind: "Page", title: SETTINGS.label, href: SETTINGS.href },
];

export default function CommandSearch({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(true);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={collapsed ? "Search" : undefined}
        aria-label="Search"
        className={`flex h-8 w-full items-center gap-2 rounded-[9px] border border-line bg-surface text-[13px] text-muted transition-colors hover:border-muted/40 hover:text-ink ${
          collapsed ? "w-10 justify-center px-0" : "px-2.5"
        }`}
      >
        <IconSearch size={15} stroke={1.75} aria-hidden />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded-[5px] border border-line px-1.5 text-[10.5px] font-medium">{mac ? "⌘K" : "Ctrl K"}</kbd>
          </>
        )}
      </button>
      {/* Portalled to <body>: drawn inside the fixed sidebar it would sit
          under the page's own stacked cards. */}
      {open && createPortal(<Palette onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  // Clinics, a beat after typing stops.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRemote([]);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setRemote(d.results ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages = term ? PAGES.filter((p) => p.title.toLowerCase().includes(term)) : PAGES;
    return [...pages, ...remote];
  }, [q, remote]);

  useEffect(() => setSel(0), [q, remote]);

  function go(hit: Hit | undefined) {
    if (!hit) return;
    onClose();
    router.push(hit.href);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/25 px-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Search"
        className="card w-full max-w-xl overflow-hidden p-0 shadow-card-hover"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line/70 px-4">
          <IconSearch size={17} stroke={1.75} className="text-muted" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") go(hits[sel]);
            }}
            placeholder="Search pages, clinics, leads, clients…"
            className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
          />
          <kbd className="rounded-[5px] border border-line px-1.5 text-[10.5px] font-medium text-muted">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.href}`}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => go(h)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${i === sel ? "bg-accent-soft" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{h.title}</span>
                  {h.sub && <span className="block truncate text-[11.5px] text-muted">{h.sub}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[10.5px] font-medium text-muted">{h.kind}</span>
                {i === sel && <IconCornerDownLeft size={14} stroke={1.75} className="shrink-0 text-accent" aria-hidden />}
              </button>
            </li>
          ))}
          {hits.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-muted">{loading ? "Searching…" : "Nothing matches that."}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
