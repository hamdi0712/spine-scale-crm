-- Search usage tracking: one row per distinct search, and how often it ran.
--
-- One new table and nothing altered. Existing rows everywhere else are
-- untouched, which is exactly why the manual override column exists: every
-- search run before this migration is invisible to the count, and the only
-- record of it is the person who ran it.

-- CreateTable
CREATE TABLE "ApifySearchLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "manualStatusOverride" TEXT,
    "firstRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ApifySearchLog_type_key_key" ON "ApifySearchLog"("type", "key");

-- CreateIndex
CREATE INDEX "ApifySearchLog_lastRunAt_idx" ON "ApifySearchLog"("lastRunAt");
