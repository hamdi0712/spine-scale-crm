"use client";

// The merged Today's focus list. Ordering and the visible/hidden split both
// live in src/lib/focus.ts — this renders what it is handed and owns nothing
// but the expanded state behind "View all".

import { useEffect, useState } from "react";
import Link from "next/link";
import { FocusItem, FocusTone } from "@/lib/focus";
import { fmtTimeInZone } from "@/lib/timezones";
import Icon from "@/components/Icons";

const TONE: Record<FocusTone, { chip: string; icon: string }> = {
  red: { chip: "bg-bad-soft text-bad", icon: "bg-bad-soft text-bad" },
  amber: { chip: "bg-warn-soft text-warn", icon: "bg-warn-soft text-warn" },
  blue: { chip: "bg-[#E8F0FE] text-accent", icon: "bg-accent/10 text-accent" },
  neutral: { chip: "bg-wash text-muted", icon: "bg-wash text-muted" },
};

// Call times are stored as instants, so the wall-clock reading belongs to
// whoever is looking — and only the browser knows which zone that is. The time
// therefore arrives after mount, like everywhere else times are shown.
function Row({ item, mounted }: { item: FocusItem; mounted: boolean }) {
  const tone = TONE[item.tone];
  const time = item.at && mounted ? fmtTimeInZone(new Date(item.at)) : null;
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 rounded-[10px] px-2 py-2.5 hover:bg-wash/70"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.icon}`}
        >
          <Icon name={item.icon} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
        <span
          className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${tone.chip}`}
        >
          {item.note}
          {time && <span className="num ml-1">· {time}</span>}
        </span>
        <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-muted/70" />
      </Link>
    </li>
  );
}

export default function TodaysFocus({
  visible,
  hidden,
}: {
  visible: FocusItem[];
  hidden: FocusItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (visible.length === 0 && hidden.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted">
        Nothing scheduled, overdue or blocking today.
      </p>
    );
  }

  return (
    <div>
      <ul className="-mx-2">
        {visible.map((item) => (
          <Row key={item.id} item={item} mounted={mounted} />
        ))}
        {expanded &&
          hidden.map((item) => <Row key={item.id} item={item} mounted={mounted} />)}
      </ul>
      {hidden.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent/[0.06]"
        >
          <Icon
            name="chevronDown"
            className={`h-3.5 w-3.5 ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Show less" : `View all (${visible.length + hidden.length})`}
        </button>
      )}
    </div>
  );
}
