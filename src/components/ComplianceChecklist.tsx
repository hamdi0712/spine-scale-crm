// The compliance gate, on a creative's record. Same checklist-item row as the
// client onboarding checklist — a toggle on the left, the item filling the
// row — with a checkbox in place of the three-state control, because an item
// has either been looked at or it has not.
//
// Every toggle is its own form posting to a server action, so the gate works
// with no client JavaScript at all.

import {
  AD_COMPLIANCE_RULE,
  complianceCheckedCount,
  compliancePassed,
} from "@/lib/adhub";
import { toggleComplianceItem } from "@/lib/actions/adhub";
import { fmtDate } from "@/lib/format";
import Icon from "@/components/Icons";

export interface ComplianceRow {
  id: string;
  item: string;
  checked: boolean;
  checkedAt: Date | null;
}

export default function ComplianceChecklist({
  items,
}: {
  items: ComplianceRow[];
}) {
  const passed = compliancePassed(items);
  const checked = complianceCheckedCount(items);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Icon
              name="shield"
              className={`h-4 w-4 ${passed ? "text-ok" : "text-muted"}`}
            />
            Compliance check
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {AD_COMPLIANCE_RULE}
          </p>
        </div>
        <span
          className={`num shrink-0 text-xs font-medium ${
            passed ? "text-ok" : "text-muted"
          }`}
        >
          {checked} / {items.length}
        </span>
      </div>

      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className="row-hover min-h-[56px] border-b border-line/60 px-4 py-3 last:border-b-0 hover:bg-wash/60"
          >
            <div className="flex items-center gap-3">
              <form action={toggleComplianceItem.bind(null, item.id)}>
                <button
                  type="submit"
                  title={
                    item.checked ? "Checked — click to clear" : "Mark as checked"
                  }
                  className={`check-box flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${
                    item.checked
                      ? "border-ok bg-ok-soft text-ok"
                      : "border-line text-transparent hover:bg-wash hover:text-muted/40"
                  }`}
                >
                  <Icon name="check" className="h-3 w-3" />
                  <span className="sr-only">
                    {item.checked ? "Checked" : "Not checked"}
                  </span>
                </button>
              </form>
              <span
                className={`check-label min-w-0 flex-1 text-sm ${
                  item.checked ? "text-muted" : ""
                }`}
              >
                {item.item}
              </span>
              {item.checkedAt && (
                <span className="num shrink-0 text-xs text-muted">
                  {fmtDate(item.checkedAt)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div
        className={`border-t px-6 py-3 ${
          passed
            ? "border-ok/30 bg-ok-soft/60"
            : "border-warn/30 bg-warn-soft/60"
        }`}
      >
        <p
          className={`text-sm font-medium ${passed ? "text-ok" : "text-warn"}`}
        >
          {passed ? "Cleared for launch" : "Not cleared — Ready is blocked"}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {passed
            ? "Every item has been checked, so Ready is available in the status dropdown."
            : `${items.length - checked} item${
                items.length - checked === 1 ? "" : "s"
              } still to check. Ready stays out of the status dropdown until they are.`}
        </p>
      </div>
    </div>
  );
}
