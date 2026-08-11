"use client";

import { useState } from "react";
import CopilotPanel from "@/components/CopilotPanel";
import Sidebar from "@/components/Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  // Whether the copilot is showing. The conversation itself lives inside the
  // panel, which stays mounted either way — closing it puts it away rather
  // than throwing the thread out.
  const [copilotOpen, setCopilotOpen] = useState(false);
  return (
    <div>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onOpenCopilot={() => setCopilotOpen(true)}
      />
      <main
        className={`min-h-screen transition-[margin] ${collapsed ? "ml-16" : "ml-56"}`}
      >
        <div className="mx-auto max-w-6xl px-10 py-10">{children}</div>
      </main>
      {/* Docked over the page rather than beside it: the copilot is consulted
          about whatever is on screen, so pushing that screen sideways every
          time it opens would be the wrong trade. */}
      <CopilotPanel
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
      />
    </div>
  );
}
