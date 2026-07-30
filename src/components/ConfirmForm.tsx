"use client";

// Wraps a server action in a form whose submit asks for confirmation first.
export default function ConfirmForm({
  action,
  message,
  className,
  children,
}: {
  action: () => Promise<void>;
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
      className="inline"
    >
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
