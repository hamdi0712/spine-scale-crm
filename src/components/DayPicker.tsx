"use client";

// A date picker that navigates. It posts nothing and holds nothing: choosing a
// day replaces the ?date= on the page you are already on, which is the same
// address the back and forward arrows beside it produce.
//
// Client-side for one reason — a native date input has no submit of its own,
// and a "Go" button beside a calendar is a second press for something the
// browser already treats as a choice.

import { useRouter } from "next/navigation";

export default function DayPicker({
  value,
  max,
  basePath,
  label = "Choose a day",
}: {
  value: string; // yyyy-mm-dd
  max: string; // no day past this one — the future has no actuals
  basePath: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <input
      type="date"
      value={value}
      max={max}
      aria-label={label}
      onChange={(e) => {
        const next = e.target.value;
        if (!next) return;
        router.push(`${basePath}?date=${next}`);
      }}
      className="field num h-[42px] w-auto py-0"
    />
  );
}
