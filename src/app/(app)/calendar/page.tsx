import { prisma } from "@/lib/prisma";
import { buildCalendarEvents, dayKeyUtc } from "@/lib/calendar";
import CalendarMonth from "@/components/CalendarMonth";

export const dynamic = "force-dynamic";

// Every dated thing in the app on one grid. Read-only by design — the dates
// belong to the records they came from, so changing one means going to that
// record, which is exactly what every row here links to.
export default async function CalendarPage() {
  const [calls, leads, invoices] = await Promise.all([
    prisma.call.findMany({
      include: {
        lead: { select: { clinicName: true } },
        client: { select: { clinicName: true } },
      },
    }),
    // Archived leads are out for the same reason they are out of the pipeline:
    // they have been closed out, and their last follow-up date is history.
    prisma.lead.findMany({
      where: { archived: false, nextFollowUp: { not: null } },
    }),
    prisma.invoice.findMany({
      where: { dueDate: { not: null } },
      include: { client: { select: { clinicName: true } } },
    }),
  ]);

  const now = new Date();

  return (
    <div>
      <h1 className="display text-[32px] font-semibold">Calendar</h1>
      <p className="mt-1.5 text-sm text-muted">
        Calls, lead follow-ups and invoice due dates on one month. Click a day
        to see what is on it.
      </p>

      <div className="mt-8">
        <CalendarMonth
          events={buildCalendarEvents({ calls, leads, invoices })}
          serverToday={dayKeyUtc(now)}
          serverNow={now.toISOString()}
        />
      </div>
    </div>
  );
}
