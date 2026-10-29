"use client";

import { confirmText } from "@/lib/displayMode";

// Wraps a server action in a form whose submit asks for confirmation first.
// proMessage is the one-line wording for Pro mode; left out, Pro asks with
// the full message (which is the right call when it is already short).
export default function ConfirmForm({
  action,
  message,
  proMessage,
  className,
  children,
}: {
  action: () => Promise<void>;
  message: string;
  proMessage?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(proMessage ? confirmText(message, proMessage) : message)) e.preventDefault();
      }}
      className="inline"
    >
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
