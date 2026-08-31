-- The dashboard's daily motivational line, cached one row per day.
--
-- One new table and nothing altered: there was no quote before this, so there
-- is nothing to carry across. The day itself is the primary key, which is what
-- makes "today's quote" a lookup rather than a query with a date range on it.
-- CreateTable
CREATE TABLE "DailyQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
