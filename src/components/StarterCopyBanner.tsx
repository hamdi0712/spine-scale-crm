import Link from "next/link";
import { STARTER_COPY_BANNER } from "@/lib/emailWorkflow";

// Shown while any email template still holds the starter copy it shipped
// with, on the Email view and on the Email panel. It goes once every template
// has been edited.
export default function StarterCopyBanner({ remaining, className = "" }: { remaining: string[]; className?: string }) {
  return (
    <div className={`rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3 ${className}`}>
      <p className="text-sm font-medium">
        <Link href="/settings/email" className="hover:underline">
          {STARTER_COPY_BANNER}
        </Link>
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">Still starter copy: {remaining.join(", ")}.</p>
    </div>
  );
}
