"use client";

// The Activities board. Deliberately the same machine as the pipeline's
// KanbanBoard — native HTML5 drag, an optimistic override so a drop paints
// before the round trip, and the same column and card shells — because the two
// boards should feel like one control that happens to be pointed at two
// different things. What is different is only what a card carries.

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { TASK_STATUSES, TASK_STATUS_LABELS, TaskStatus } from "@/lib/tasks";
import { createTask, moveTaskStatus } from "@/lib/actions/tasks";
import { fmtDate } from "@/lib/format";
import Icon from "@/components/Icons";

export interface BoardTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null; // ISO, read in UTC like every other date-only field
  completedAt: string | null;
  // The linked record, resolved to something a card can draw: a name and the
  // page it lives on. Null when the task is about nothing in particular.
  link: { label: string; href: string } | null;
}

// The two sides a task can be linked to, flattened into one list for the
// form's single picker. Values are "lead:<id>" / "client:<id>" — see link() in
// src/lib/actions/tasks.ts, which is the only thing that reads them.
export interface TaskLinkOption {
  value: string;
  label: string;
  group: "Leads" | "Clients";
}

// Overdue is read against the start of today in UTC, matching the UTC reading
// every other date-only column in the app gets. A task due today is not late.
function isOverdue(dueDate: string, status: string): boolean {
  if (status === "DONE") return false;
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return new Date(dueDate).getTime() < todayUtc;
}

export default function TaskBoard({
  tasks,
  linkOptions,
}: {
  tasks: BoardTask[];
  linkOptions: TaskLinkOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<string | null>(null);
  // Local optimistic overrides so a drop paints instantly.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);

  const statusOf = (t: BoardTask) => moved[t.id] ?? t.status;

  function handleDrop(status: TaskStatus) {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    setOverStatus(null);
    // No-op drops still cost a write otherwise, and a card dropped back where
    // it came from should not restamp completedAt.
    const task = tasks.find((t) => t.id === id);
    if (task && statusOf(task) === status) return;
    setMoved((m) => ({ ...m, [id]: status }));
    startTransition(async () => {
      await moveTaskStatus(id, status);
      router.refresh();
    });
  }

  const leads = linkOptions.filter((o) => o.group === "Leads");
  const clients = linkOptions.filter((o) => o.group === "Clients");

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setFormOpen((o) => !o)}
          className={formOpen ? "btn" : "btn-primary"}
        >
          {formOpen ? "Cancel" : "New task"}
        </button>
      </div>

      {/* The form is the same .card / .field shell every other form in the app
          wears; it sits above the board rather than over it so the columns it
          is about stay in view while it is being filled in. */}
      {formOpen && (
        <form
          action={async (formData) => {
            await createTask(formData);
            setFormOpen(false);
            router.refresh();
          }}
          className="card mb-6 max-w-xl space-y-5 p-6"
        >
          <div>
            <label className="field-label" htmlFor="title">
              Title
            </label>
            <input id="title" name="title" required className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              className="field"
            />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <label className="field-label" htmlFor="dueDate">
                Due date
              </label>
              <input
                id="dueDate"
                name="dueDate"
                type="date"
                className="field num"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="linkedRecord">
                Linked record
              </label>
              <select
                id="linkedRecord"
                name="linkedRecord"
                defaultValue=""
                className="field"
              >
                <option value="">None</option>
                {leads.length > 0 && (
                  <optgroup label="Leads">
                    {leads.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {clients.length > 0 && (
                  <optgroup label="Clients">
                    {clients.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-line/60 pt-5">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create task
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-4 overflow-x-auto pb-1">
        {TASK_STATUSES.map((status) => {
          const column = tasks.filter((t) => statusOf(t) === status);
          return (
            <div
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStatus(status);
              }}
              onDragLeave={() => setOverStatus(null)}
              onDrop={() => handleDrop(status)}
              className={`flex min-h-[420px] w-72 shrink-0 flex-col rounded-2xl border ${
                overStatus === status
                  ? "border-accent/50 bg-accent/5"
                  : "border-line bg-panel"
              }`}
            >
              <div className="border-b border-line/60 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium">
                    {TASK_STATUS_LABELS[status]}
                  </span>
                  <span className="num text-xs text-muted">{column.length}</span>
                </div>
              </div>
              <div className="flex-1 space-y-2.5 p-3">
                {column.map((task) => {
                  const overdue =
                    task.dueDate !== null && isOverdue(task.dueDate, status);
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStatus(null);
                      }}
                      className={`cursor-grab rounded-xl border border-line bg-surface px-3.5 py-3 shadow-card hover:border-accent/50 ${
                        dragId === task.id ? "opacity-40" : ""
                      }`}
                    >
                      <div className="text-sm font-medium">{task.title}</div>
                      {task.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-muted">
                          {task.description}
                        </div>
                      )}
                      {/* The chip is a link out of the board, so it is not
                          draggable — grabbing it should not start a drag the
                          click was never going to finish. */}
                      {task.link && (
                        <div className="mt-1.5">
                          <Link
                            href={task.link.href}
                            draggable={false}
                            className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#E8F0FE] px-2 py-0.5 text-xs font-medium text-accent hover:underline"
                          >
                            <Icon name="tag" className="h-3 w-3 shrink-0" />
                            <span className="truncate">{task.link.label}</span>
                          </Link>
                        </div>
                      )}
                      {task.dueDate && (
                        <div
                          className={`num mt-1.5 text-xs ${
                            overdue ? "text-bad" : "text-muted"
                          }`}
                        >
                          {overdue ? "Overdue · " : "Due "}
                          {fmtDate(task.dueDate)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {column.length === 0 && <div className="h-full" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
