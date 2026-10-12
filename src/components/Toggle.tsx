"use client";

// The switch. Built rather than borrowed: the app has checkboxes and segmented
// controls but no toggle, and a row of checkboxes reads as a filter rather than
// as things being on. Same accent as everything else, and it is a real checkbox
// underneath so it posts and keys like one.
//
// Lifted out of the Pipeline settings form when Settings → ICP needed the same
// control for its one-active-at-a-time switch, so the two pages flip the same
// switch rather than two that look alike.
export default function Toggle({
  name,
  checked,
  onChange,
  label,
  disabled = false,
}: {
  name?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex shrink-0 items-center gap-2.5 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <span className="text-xs font-medium text-muted">
        {checked ? "On" : "Off"}
      </span>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={`block h-[24px] w-[42px] rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30 ${
            checked ? "border-accent bg-accent" : "border-line bg-line/70"
          }`}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute top-[3px] h-[18px] w-[18px] rounded-full bg-surface shadow-sm transition-all ${
            checked ? "left-[21px]" : "left-[3px]"
          }`}
        />
      </span>
    </label>
  );
}
