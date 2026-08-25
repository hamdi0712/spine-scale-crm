"use client";

// Back and Forward, drawn as the app's own controls.
//
// The browser has both already, but the two pages that carry this — Discovery
// and Pipeline — are read as a loop: narrow the list, open one, come back,
// open the next. Since the filters now live in the query string
// (src/lib/useUrlState.ts), Back returns to the exact filtered and sorted view
// and Forward re-advances to whatever was open, so the loop is worth a pair of
// buttons in the header rather than a trip to the browser chrome.
//
// A segmented pair rather than two buttons, because they are one control with
// two directions — the same shape the Table/Board toggle wears.

import { useRouter } from "next/navigation";
import Icon from "@/components/Icons";

export default function HistoryNav() {
  const router = useRouter();
  return (
    <div className="segment" role="group" aria-label="History">
      <button
        type="button"
        onClick={() => router.back()}
        title="Back — returns to the previous view, filters and sort included"
        aria-label="Back"
        className="segment-item"
      >
        <Icon name="chevronLeft" className="h-4 w-4" />
        Back
      </button>
      <button
        type="button"
        onClick={() => router.forward()}
        title="Forward"
        aria-label="Forward"
        className="segment-item"
      >
        Forward
        <Icon name="chevronRight" className="h-4 w-4" />
      </button>
    </div>
  );
}
