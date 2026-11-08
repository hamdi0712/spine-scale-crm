import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { addDays, dayKey as toDayKey, parseDayKey, toChecklistDay } from "@/lib/dailyChecklist";
import { OS_WEEKDAYS, osBlocks } from "@/lib/dailyOs";
import { fmtDate } from "@/lib/format";
import DailyOs, { OsDay } from "@/components/DailyOs";
import TaskBoard, { BoardTask, TaskLinkOption } from "@/components/TaskBoard";

export const dynamic = "force-dynamic";

// The board is what loads, on the same reasoning the pipeline's table does: it
// is the view that answers "what is outstanding", and it reads at forty cards
// as well as at four. The routine is a press away and is a thing you go to
// once a morning rather than something to be looked past all day.
export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: { view?: string; date?: string };
}) {
  // "checklist" is the old daily checklist's address; it opens the Daily OS
  // that replaced it.
  const view = searchParams.view === "os" || searchParams.view === "checklist" ? "os" : "board";

  if (view === "os") {
    const now = new Date();
    const today = toChecklistDay(now);
    // This week, Monday to Friday. A weekend opens on the nearest weekday:
    // Sunday on Monday, Saturday on Friday.
    const dow = (today.getUTCDay() + 6) % 7; // Mon 0 … Sun 6
    const monday = addDays(today, -dow);
    const days: OsDay[] = OS_WEEKDAYS.map((label, i) => {
      const d = addDays(monday, i);
      return {
        key: toDayKey(d),
        label,
        date: fmtDate(d),
        future: d.getTime() > today.getTime(),
        isToday: d.getTime() === today.getTime(),
      };
    });
    const asked = searchParams.date ? toDayKey(toChecklistDay(parseDayKey(searchParams.date, now))) : null;
    const fallback = days[Math.min(dow, 4)];
    const day = days.find((d) => d.key === asked) ?? fallback;
    const weekday = days.indexOf(day);
    const date = toChecklistDay(parseDayKey(day.key, now));
    const rows = await prisma.dailyChecklistEntry.findMany({
      where: { date, item: { startsWith: "os:" }, checked: true },
      select: { item: true },
    });

    return (
      <div>
        <Header view={view} />
        <div className="mt-8 wide:mt-4">
          <DailyOs blocks={osBlocks(weekday)} days={days} day={day} checked={new Set(rows.map((r) => r.item))} />
        </div>
      </div>
    );
  }

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
      <Header view={view} />
      <div className="mt-8">
        <TaskBoard tasks={serialized} linkOptions={linkOptions} />
      </div>
    </div>
  );
}

// The page title and the view toggle, shared by both views so the switch does
// not move when it is used. Same .segment control the pipeline's Table/Board
// pair wears.
function Header({ view }: { view: "board" | "os" }) {
  return (
    <div className="flex items-end justify-between max-md:flex-col max-md:items-stretch max-md:gap-4">
      <div>
        <h1 className="display text-[32px] font-semibold">Tasks</h1>
        <p className="helper-text mt-1.5 text-sm text-muted">
          {view === "os"
            ? "4 hours. Email first. Prep in the Manila morning, send into the US window at night."
            : "Everything that wants doing and is not a call, a follow-up or an onboarding step"}
        </p>
      </div>
      <div className="segment">
        <Link
          href="/activities"
          className={`segment-item ${view === "board" ? "segment-item-on" : ""}`}
        >
          Board
        </Link>
        <Link
          href="/activities?view=os"
          className={`segment-item ${view === "os" ? "segment-item-on" : ""}`}
        >
          Daily OS
        </Link>
      </div>
    </div>
  );
}
