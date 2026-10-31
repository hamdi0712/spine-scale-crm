// The look of the items in a DropdownMenu (src/components/DropdownMenu.tsx),
// for a button or a form's submit button. Its own plain module so server
// pages can read them: a value exported from a "use client" file reaches a
// server component as a reference, not as the string.

// A label with a line under it.
export const MENU_ITEM =
  "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-wash focus:outline-none focus-visible:bg-wash disabled:cursor-not-allowed disabled:opacity-50";

// An icon, then a label with a line under it.
export const MENU_ROW =
  "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-wash focus:outline-none focus-visible:bg-wash disabled:cursor-not-allowed disabled:opacity-50";

// The same, destructive: red, with a red wash on hover.
export const MENU_ROW_DANGER =
  "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-bad transition-colors hover:bg-bad-soft focus:outline-none focus-visible:bg-bad-soft";
