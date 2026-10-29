"use client";

import { useEffect } from "react";
import { isPro } from "@/lib/displayMode";

// What makes a folded .helper-text an ⓘ you can press, in Pro.
//
// The folding itself is CSS (globals.css, "Display mode"): in Pro each
// .helper-text draws as a small ⓘ where the text was. This adds the rest,
// once, for the whole app — a press opens that one explanation in full and a
// second press on the open text folds it again, and while Pro is on every
// folded explanation is a focusable button for the keyboard and for a screen
// reader. Nothing here touches what React renders: it toggles one class
// (helper-open) and a few attributes React does not own.
//
// Inside a [data-guided-scope] — a dialog with a Pro summary line — the
// explanations are not individual ⓘs; the scope has one InfoToggle that
// opens all of them together (below).
const INTERACTIVE = "a, button, input, select, textarea, label, summary";

function folded(el: Element): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.classList.contains("helper-text") &&
    !el.closest("[data-guided-scope]")
  );
}

export function HelperInfoController() {
  useEffect(() => {
    const root = document.documentElement;

    const mark = () => {
      const pro = isPro();
      document.querySelectorAll<HTMLElement>(".helper-text").forEach((el) => {
        if (pro && folded(el)) {
          const open = el.classList.contains("helper-open");
          if (!el.hasAttribute("data-info")) {
            el.setAttribute("data-info", "");
            el.tabIndex = 0;
            el.setAttribute("role", "button");
          }
          el.setAttribute("aria-expanded", String(open));
          el.title = open ? "" : "Show the explanation";
        } else if (el.hasAttribute("data-info")) {
          el.removeAttribute("data-info");
          el.removeAttribute("tabindex");
          el.removeAttribute("role");
          el.removeAttribute("aria-expanded");
          el.removeAttribute("title");
          el.classList.remove("helper-open");
        }
      });
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(mark);
    };

    const toggle = (el: HTMLElement, target: Element | null) => {
      const open = el.classList.contains("helper-open");
      // A link or button inside an open explanation does its own thing.
      if (open && target && target !== el && target.closest(INTERACTIVE)) return false;
      el.classList.toggle("helper-open", !open);
      mark();
      return true;
    };

    const onClick = (e: MouseEvent) => {
      if (!isPro()) return;
      const target = e.target as Element | null;
      const el = target?.closest(".helper-text");
      if (!el || !folded(el)) return;
      const wasOpen = el.classList.contains("helper-open");
      if (toggle(el, target) && !wasOpen) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isPro() || (e.key !== "Enter" && e.key !== " ")) return;
      const el = e.target as Element | null;
      if (!el || !el.classList?.contains("helper-text") || !folded(el)) return;
      e.preventDefault();
      toggle(el, el);
    };

    mark();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    const modeObserver = new MutationObserver(mark);
    modeObserver.observe(root, { attributes: true, attributeFilter: ["data-mode"] });
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      modeObserver.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return null;
}

// The one ⓘ of a [data-guided-scope]: in Pro, the end of the summary line,
// and pressing it brings back every explanation in the scope — the Guided
// dialog, in full. Invisible in Guided, where there is nothing folded.
export function InfoToggle({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      className={`info-toggle ${className}`}
      aria-label="Show the full explanation"
      title="Show the full explanation"
      onClick={(e) => {
        const scope = e.currentTarget.closest("[data-guided-scope]");
        if (!scope) return;
        const open = scope.classList.toggle("show-guided");
        e.currentTarget.setAttribute("aria-expanded", String(open));
      }}
      aria-expanded="false"
    >
      ⓘ
    </button>
  );
}
