-- The daily routine's ticks. The routine's items are a constant in
-- src/lib/dailyChecklist.ts, not rows here — this table records only which of
-- them were ticked on which day.
--
-- The unique index is the feature, not an optimisation: a day's rows are seeded
-- on first view, and two views landing at once must leave one row per item
-- rather than two.

-- CreateTable
CREATE TABLE "DailyChecklistEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "item" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyChecklistEntry_date_item_key" ON "DailyChecklistEntry"("date", "item");

-- CreateIndex
CREATE INDEX "DailyChecklistEntry_date_idx" ON "DailyChecklistEntry"("date");
