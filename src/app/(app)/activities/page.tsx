import { prisma } from "@/lib/prisma";
import TaskBoard, { BoardTask, TaskLinkOption } from "@/components/TaskBoard";

export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  const [tasks, leads, clients] = await Promise.all([
    // Newest first within a column, with a due date pulling a card up: the top
    // of a column should be the thing that wants doing next, not the thing
    // that happened to be typed first.
    prisma.task.findMany({
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        lead: { select: { clinicName: true } },
        client: { select: { clinicName: true } },
      },
    }),
    prisma.lead.findMany({
      where: { archived: false },
      select: { id: true, clinicName: true },
      orderBy: { clinicName: "asc" },
    }),
    prisma.client.findMany({
      where: { status: { not: "CHURNED" } },
      select: { id: true, clinicName: true },
      orderBy: { clinicName: "asc" },
    }),
  ]);

  // The link is resolved here rather than on the card, so the board stays
  // presentational in the way the pipeline's does.
  const serialized: BoardTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    link: t.lead
      ? { label: t.lead.clinicName, href: `/pipeline/${t.leadId}` }
      : t.client
        ? { label: t.client.clinicName, href: `/clients/${t.clientId}` }
        : null,
  }));

  const linkOptions: TaskLinkOption[] = [
    ...leads.map((l) => ({
      value: `lead:${l.id}`,
      label: l.clinicName,
      group: "Leads" as const,
    })),
    ...clients.map((c) => ({
      value: `client:${c.id}`,
      label: c.clinicName,
      group: "Clients" as const,
    })),
  ];

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="display text-[32px] font-semibold">Activities</h1>
          <p className="mt-1.5 text-sm text-muted">
            Everything that wants doing and is not a call, a follow-up or an
            onboarding step
          </p>
        </div>
      </div>

      <div className="mt-8">
        <TaskBoard tasks={serialized} linkOptions={linkOptions} />
      </div>
    </div>
  );
}
