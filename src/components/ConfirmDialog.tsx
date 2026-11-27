"use client";

// The app's own confirm, in place of the browser's window.confirm / alert —
// which block the page (and any automation driving it) until someone clicks.
//
//   const ask = useConfirm();
//   if (!(await ask({ title: "Mark bounced?", body: "…", confirm: "Mark bounced", danger: true }))) return;
//
// One dialog at a time, drawn by ConfirmProvider (mounted once in AppShell):
// a white card with a thin border on a soft scrim, the shared open/close
// motion, Enter confirms, Escape or the scrim cancels, and focus starts on the
// confirming button and stays inside the card. `notice` is the alert form: one
// button, resolves when it is dismissed.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import useDialogMotion from "@/components/useDialogMotion";

export interface ConfirmOptions {
  title: string;
  // Plain text; line breaks are kept.
  body?: string;
  confirm?: string;
  cancel?: string;
  // A destructive action: the confirming button is drawn as one.
  danger?: boolean;
  // One button only (an alert): resolves true when dismissed.
  notice?: boolean;
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

// Outside a provider (a test render, a page mounted on its own) it falls back
// to the browser's confirm rather than failing.
export function useConfirm(): Ask {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (async (o) => (o.notice ? (window.alert(o.body ?? o.title), true) : window.confirm([o.title, o.body].filter(Boolean).join("\n\n"))));
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback<Ask>((o) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <ConfirmCard
          key={pending.title + (pending.body ?? "")}
          o={pending}
          onDone={(ok) => {
            pending.resolve(ok);
            setPending(null);
          }}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmCard({ o, onDone }: { o: Pending; onDone: (ok: boolean) => void }) {
  const answer = useRef(false);
  const { close, closing, scrimClass, dialogClass } = useDialogMotion(() => onDone(answer.current));
  const okRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const finish = useCallback(
    (ok: boolean) => {
      answer.current = ok;
      close();
    },
    [close],
  );

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (closing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        finish(o.notice === true);
      } else if (e.key === "Enter" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Tab" && cardRef.current) {
        // Focus stays inside the card.
        const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>("button"));
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing, finish, o.notice]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className={`${scrimClass} absolute inset-0 bg-ink/30`} onClick={() => finish(o.notice === true)} aria-hidden />
      <div
        ref={cardRef}
        role={o.notice ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="confirm-title"
        className={`${dialogClass} relative w-full max-w-md rounded-[14px] border border-line bg-surface p-5 shadow-card-hover`}
      >
        <p id="confirm-title" className="text-[15px] font-semibold text-ink">
          {o.title}
        </p>
        {o.body && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{o.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          {!o.notice && (
            <button type="button" className="btn h-9 px-3.5 text-sm" onClick={() => finish(false)}>
              {o.cancel ?? "Cancel"}
            </button>
          )}
          <button ref={okRef} type="button" className={`${o.danger ? "btn-danger" : "btn-primary"} h-9 px-3.5 text-sm`} onClick={() => finish(true)}>
            {o.confirm ?? (o.notice ? "OK" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
