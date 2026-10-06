import Link from "next/link";

// Says which challenge is open when it is not the current one, with the way
// back to it. Used by the calendar and the journal when they are opened from
// Progress → Past challenges.
export default function MonkPastBanner({ href }: { href: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[10px] bg-wash px-4 py-2.5 text-xs">
      <span className="text-muted">Viewing a finished challenge</span>
      <span className="flex gap-4 font-medium">
        <Link href="/monk-mode/progress" className="text-accent hover:underline">
          All past challenges
        </Link>
        <Link href={href} className="text-accent hover:underline">
          Back to current
        </Link>
      </span>
    </div>
  );
}
