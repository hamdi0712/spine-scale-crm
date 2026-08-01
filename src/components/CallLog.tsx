// The calls log — scheduled and held calls for one record. Rendered on both
// the lead detail page and the client detail page; which record a call belongs
// to is decided by the bound add action passed in, so this component never has
// to know.

import {
  CALL_STATUSES,
  CALL_STATUS_LABELS,
  CALL_TYPES,
  CALL_TYPE_LABELS,
  callTypeLabel,
  groupCalls,
  isCallOverdue,
} from "@/lib/calls";
import { deleteCall, setCallStatus } from "@/lib/actions/calls";
import { CallStatusBadge } from "@/components/Badge";
import { LocalDateTime } from "@/components/Clock";
import ConfirmForm from "@/components/ConfirmForm";
import DateTimeField from "@/components/DateTimeField";

export interface CallRow {
  id: string;
  scheduledAt: Date;
  type: string;
  status: string;
  notes: string | null;
}

export default function CallLog({
  calls,
  addAction,
}: {
  calls: CallRow[];
  addAction: (formData: FormData) => Promise<void>;
}) {
  const { upcoming, logged } = groupCalls(calls);

  return (
    <div className="card">
      {calls.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">
          No calls logged yet. Schedule one below — this log sits alongside the
          record&rsquo;s other dates, it doesn&rsquo;t replace them.
        </p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <GroupHeading>On the books</GroupHeading>
              <ul>
                {upcoming.map((call) => (
                  <CallRowItem key={call.id} call={call} />
                ))}
              </ul>
            </>
          )}
          {logged.length > 0 && (
            <>
              <GroupHeading>Past calls</GroupHeading>
              <ul>
                {logged.map((call) => (
                  <CallRowItem key={call.id} call={call} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* Keyed on the row count so the form clears itself once a call lands. */}
      <form
        key={calls.length}
        action={addAction}
        className="grid grid-cols-12 items-end gap-3 border-t border-line/60 p-4"
      >
        <div className="col-span-3">
          <label className="field-label" htmlFor="callScheduledAt">
            Date and time
          </label>
          <DateTimeField id="callScheduledAt" name="scheduledAt" required />
        </div>
        <div className="col-span-2">
          <label className="field-label" htmlFor="callType">
            Type
          </label>
          <select
            id="callType"
            name="type"
            defaultValue="CHECK_IN"
            className="field"
          >
            {CALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {CALL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-5">
          <label className="field-label" htmlFor="callNotes">
            Notes
          </label>
          <input
            id="callNotes"
            name="notes"
            placeholder="Agenda, who's joining, what to cover…"
            className="field"
          />
        </div>
        <div className="col-span-2">
          <button type="submit" className="btn w-full justify-center">
            Add call
          </button>
        </div>
      </form>
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-line/60 bg-wash/50 px-5 py-2 text-xs font-medium tracking-[0.02em] text-muted">
      {children}
    </div>
  );
}

function CallRowItem({ call }: { call: CallRow }) {
  const overdue = isCallOverdue(call);
  return (
    <li className="border-b border-line/60 px-5 py-4 last:border-b-0 hover:bg-wash/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium">{callTypeLabel(call.type)}</span>
        <CallStatusBadge status={call.status} />
        <span className={`text-xs ${overdue ? "text-bad" : "text-muted"}`}>
          <LocalDateTime at={call.scheduledAt.toISOString()} />
          {overdue ? " · overdue" : ""}
        </span>
        <span className="flex-1" />
        <div className="flex shrink-0 overflow-hidden rounded-full border border-line">
          {CALL_STATUSES.map((s) => {
            const active = call.status === s;
            return (
              <form action={setCallStatus.bind(null, call.id, s)} key={s}>
                <button
                  type="submit"
                  className={`h-7 px-3 text-xs font-medium ${
                    active
                      ? s === "COMPLETED"
                        ? "bg-ok-soft text-ok"
                        : s === "NO_SHOW"
                          ? "bg-bad-soft text-bad"
                          : s === "CANCELLED"
                            ? "bg-line/70 text-ink"
                            : "bg-[#E8F0FE] text-accent"
                      : "text-muted/70 hover:bg-wash/70 hover:text-ink"
                  }`}
                >
                  {CALL_STATUS_LABELS[s]}
                </button>
              </form>
            );
          })}
        </div>
        <ConfirmForm
          action={deleteCall.bind(null, call.id)}
          message={`Delete this ${callTypeLabel(call.type).toLowerCase()} call from the log?`}
          className="shrink-0 px-1 text-muted hover:text-bad"
        >
          ×
        </ConfirmForm>
      </div>
      {call.notes && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">
          {call.notes}
        </p>
      )}
    </li>
  );
}
