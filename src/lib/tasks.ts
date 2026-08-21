// The three states a task can be in, and the column each one is.
//
// Kept here rather than in src/lib/constants.ts for the same reason the call
// and discovery vocabularies live in their own files: the board, the form, the
// action and the focus list all read from one place, and that place is small
// enough to hold the whole rule.
//
// The order is the order of the columns, left to right. Nothing else decides
// it — the board maps this array.
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

// The two statuses that are still work. Today's focus reads exactly these —
// a finished task is history, and history is not a thing to do today.
export const OPEN_TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS"];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}
