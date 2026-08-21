"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { TaskStatus, isTaskStatus } from "@/lib/tasks";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function date(formData: FormData, key: string): Date | null {
  const v = str(formData, key);
  if (v === null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The form offers one "linked record" select carrying values like "lead:abc"
// or "client:xyz", because a task is about one thing or nothing — two separate
// pickers would let somebody choose both and mean neither.
function link(formData: FormData): { leadId: string | null; clientId: string | null } {
  const value = str(formData, "linkedRecord");
  if (value === null) return { leadId: null, clientId: null };
  const [kind, id] = value.split(":");
  if (!id) return { leadId: null, clientId: null };
  if (kind === "lead") return { leadId: id, clientId: null };
  if (kind === "client") return { leadId: null, clientId: id };
  return { leadId: null, clientId: null };
}

export async function createTask(formData: FormData) {
  const title = str(formData, "title");
  if (!title) return;
  await prisma.task.create({
    data: {
      title,
      description: str(formData, "description"),
      dueDate: date(formData, "dueDate"),
      ...link(formData),
    },
  });
  revalidatePath("/activities");
  // The dashboard's focus list counts open tasks, so a new one is news there
  // as well as here.
  revalidatePath("/");
}

// Moving a card between columns. completedAt is derived from where it lands
// rather than sent by the board: Done stamps it, anything else clears it, so
// the two can never disagree about whether the task is finished.
export async function moveTaskStatus(taskId: string, status: string) {
  if (!isTaskStatus(status)) return;
  const next = status as TaskStatus;
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: next,
      completedAt: next === "DONE" ? new Date() : null,
    },
  });
  revalidatePath("/activities");
  revalidatePath("/");
}

export async function deleteTask(taskId: string) {
  await prisma.task.delete({ where: { id: taskId } });
  revalidatePath("/activities");
  revalidatePath("/");
}
