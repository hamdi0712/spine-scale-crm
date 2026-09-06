"use server";

// Saving the daily KPI goals — the one write behind the goals form.
//
// Everything crossing this boundary is untrusted and all of it is read through
// readGoal (src/lib/dailyKpi.ts), the same function the stored row is read
// through: a goal is rounded, clamped to the scale it is measured on, and
// falls back to the default when it is not a number at all. There is no path
// from this form to a page that cannot compute a percentage.
//
// It writes goals and nothing else. No count on the page is stored, so moving
// a goal changes what today is measured against and never what happened.

import { revalidatePath } from "next/cache";
import { parseDayKey } from "@/lib/dailyChecklist";
import {
  DAILY_KPI_KEYS,
  DailyKpiGoals,
  DailyKpiKey,
  isSkippable,
  readGoal,
} from "@/lib/dailyKpi";
import {
  saveDailyKpiGoals as write,
  toggleDailyKpiSkip as writeSkip,
} from "@/lib/dailyKpiStore";

export async function saveDailyKpiGoals(formData: FormData): Promise<void> {
  // One field per metric, named for the metric rather than for its timeframe —
  // what the number means is settled by DAILY_KPI_CADENCE, in one place, and
  // the form only has to say which metric it is posting.
  const goals = Object.fromEntries(
    DAILY_KPI_KEYS.map((key) => [key, readGoal(formData.get(`${key}Goal`), key)]),
  ) as Record<DailyKpiKey, number>;

  await write(goals satisfies DailyKpiGoals);

  revalidatePath("/daily-kpi");
}

// "Skip for today", and the way back off it.
//
// Both arguments are bound at render time by the form, so the day being marked
// is the day that was on screen rather than whatever "today" has become by the
// time the request lands — the same reason the checklist's toggle binds its
// day (src/lib/actions/dailyChecklist.ts).
//
// The metric is checked against SKIPPABLE_KPI_KEYS rather than trusted: this
// is a form field, and a skip on a metric the page never offers would lift a
// count to a goal nobody chose to forgive.
export async function toggleDailyKpiSkip(
  dayKey: string,
  metric: string,
): Promise<void> {
  if (!isSkippable(metric as DailyKpiKey)) return;
  const day = parseDayKey(dayKey, new Date());
  await writeSkip(day, metric as DailyKpiKey);

  revalidatePath("/daily-kpi");
}
