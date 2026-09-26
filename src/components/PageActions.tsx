"use client";

// A page header's row of actions — New lead, Import, Process queue and the
// rest.
//
// From md up this is exactly the div it replaces: the same element with the
// same classes, so a desktop header is untouched. On a phone a row of three or
// four 42px buttons does not fit beside a title, so the row moves into a ⋯
// button in the mobile top bar, which opens a sheet with the actions stacked
// full-width. `mobile="inline"` opts a page out — for a header with a single
// action that fits under the title perfectly well as it is.
//
// The sheet keeps its contents mounted while it is shut. Several of these
// buttons open a dialog of their own, and that dialog's state lives in the
// button's component: unmounting the menu as it closed would unmount the
// dialog with it. The dialogs portal to <body>, so a hidden menu does not
// hide them.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconDots } from "@tabler/icons-react";
import Sheet from "@/components/Sheet";
import { TOPBAR_ACTIONS_ID } from "@/components/MobileNav";
import { useIsPhone } from "@/components/useMediaQuery";

export default function PageActions({
  className = "",
  children,
  mobile = "menu",
  title = "Actions",
}: {
  className?: string;
  children: React.ReactNode;
  mobile?: "menu" | "inline";
  title?: string;
}) {
  const phone = useIsPhone();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSlot(document.getElementById(TOPBAR_ACTIONS_ID));
  }, [phone]);

  if (mobile === "inline" || !phone || !slot) {
    // Server render and desktop. On a phone the row is hidden by CSS until
    // the menu takes over, so it never flashes up under the title first.
    return (
      <div className={`${className} ${mobile === "menu" ? "max-md:hidden" : "page-actions-inline"}`}>
        {children}
      </div>
    );
  }

  return (
    <>
      {createPortal(
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={title}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex h-11 w-11 items-center justify-center rounded-[10px] text-ink-soft active:bg-wash"
        >
          <IconDots size={22} stroke={1.75} />
        </button>,
        slot,
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={title} keepMounted>
        {/* Any tap inside is an action taken, so the menu gets out of the
            way; a dialog the action opens is portalled and stays. The close
            waits a tick so the tap itself lands first. */}
        <div
          className="page-actions-sheet flex flex-col gap-2 pt-1"
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("button, a")) setTimeout(() => setOpen(false), 0);
          }}
        >
          {children}
        </div>
      </Sheet>
    </>
  );
}
