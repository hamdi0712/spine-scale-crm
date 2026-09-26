"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import { MobileTabBar, MobileTopBar } from "@/components/MobileNav";
import useMediaQuery from "@/components/useMediaQuery";

// Three shells for three widths, and the desktop one is the app as it always
// was:
//
//   ≥1024  the sidebar, collapsible, beside the page at its full padding.
//   768–   the sidebar held to its 64px icon rail — the expanded 224px would
//   1023   leave a tablet's page too narrow for most of its tables — with the
//          page's gutters drawn in to match.
//   <768   no sidebar at all: a sticky top bar and a bottom tab bar
//          (MobileNav), 16px gutters, and room at the foot of the page for the
//          tab bar so nothing ends up underneath it.
//
// Every class that changes a narrow layout is behind max-md: or md:max-lg:, so
// the desktop classes are the ones that were here before, unconditionally.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const tablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  return (
    <div>
      <Sidebar collapsed={collapsed || tablet} onToggle={() => setCollapsed((c) => !c)} />
      <MobileTopBar />
      <main
        className={`min-h-dvh transition-[margin] max-md:ml-0 md:max-lg:ml-16 ${collapsed ? "ml-16" : "ml-56"}`}
      >
        <div className="mx-auto max-w-6xl px-10 py-10 max-md:px-4 max-md:pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+24px)] max-md:pt-4 md:max-lg:px-6 md:max-lg:py-8">
          {children}
        </div>
      </main>
      <MobileTabBar />
    </div>
  );
}
