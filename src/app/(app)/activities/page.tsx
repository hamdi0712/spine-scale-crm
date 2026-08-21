import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  addDays,
  dayKey as toDayKey,
  parseDayKey,
  readDay,
  toChecklistDay,
} from "@/lib/dailyChecklist";
import { ensureDay, readDayRows } from "@/lib/dailyChecklistStore";
import { loadDailyNumbers } from "@/lib/dailyNumbers";
import { fmtDate } from "@/lib/format";
import DailyChecklist from "@/components/DailyChecklist";
import DailyNumbers from "@/components/DailyNumbers";
import Icon from "@/components/Icons";
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
  const view = searchParams.view === "checklist" ? "checklist" : "board";

  if (view === "checklist") {
    const today = toChecklistDay(new Date());
    const day = parseDayKey(searchParams.date, new Date());
    const isToday = day.getTime() === today.getTime();
    // Today gets seeded on view — that write is the whole of the daily reset.
    // A past day is read without writing, so opening the history never
    // backfills rows onto a day the routine was not run on.
    const rows = isToday ? await ensureDay(day) : await readDayRows(day);
    const numbers = await loadDailyNumbers(day);
    const checked = readDay(rows);
    const key = toDayKey(day);

    return (
      <div>
        <Header view={view} />
        {/* Day navigation. Forward stops at today: the routine is a record of
            days that have happened, and offering tomorrow would invite ticking
            work nobody has done. */}
        <div className="mt-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href={`/activities?view=checklist&date=${toDayKey(addDays(day, -1))}`}
              className="btn"
              aria-label="Previous day"
            >
              <Icon name="chevronLeft" className="h-4 w-4" />
            </Link>
            <span className="num text-sm font-medium">
              {isToday ? `Today — ${fmtDate(day)}` : fmtDate(day)}
            </span>
            {isToday ? (
              <span className="btn pointer-events-none opacity-40" aria-hidden>
                <Icon name="chevronRight" className="h-4 w-4" />
              </span>
            ) : (
              <Link
                href={`/activities?view=checklist&date=${toDayKey(addDays(day, 1))}`}
                className="btn"
                aria-label="Next day"
              >
                <Icon name="chevronRight" className="h-4 w-4" />
              </Link>
            )}
          </div>
          {!isToday && (
            <Link href="/activities?view=checklist" className="btn">
              Back to today
            </Link>
          )}
        </div>

        <div className="mt-6 space-y-6">
          <DailyNumbers numbers={numbers} dayLabel={fmtDate(day)} isToday={isToday} />
          <DailyChecklist
            dayKey={key}
            checked={checked}
            readOnly={!isToday}
          />
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
function Header({ view }: { view: "board" | "checklist" }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <h1 className="display text-[32px] font-semibold">Activities</h1>
        <p className="mt-1.5 text-sm text-muted">
          {view === "checklist"
            ? "The fixed daily routine, and what the records say actually happened"
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
          href="/activities?view=checklist"
          className={`segment-item ${view === "checklist" ? "segment-item-on" : ""}`}
        >
          Daily checklist
        </Link>
      </div>
    </div>
  );
}
