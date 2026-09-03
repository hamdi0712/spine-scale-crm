-- "Skip for today" on a daily KPI: one row per skipped metric per day.
--
-- One new table and nothing altered. The surplus rollover this replaces was
-- computed on read and stored nothing, so there is no ledger to carry across —
-- the days it used to credit simply read as their raw counts again, and a day
-- that should not count against the goal is now said so explicitly here.
--
-- Presence is the flag: a row means skipped, no row means not skipped.
-- CreateTable
CREATE TABLE "DailyKpiSkip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "metric" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyKpiSkip_date_metric_key" ON "DailyKpiSkip"("date", "metric");

-- CreateIndex
CREATE INDEX "DailyKpiSkip_date_idx" ON "DailyKpiSkip"("date");
