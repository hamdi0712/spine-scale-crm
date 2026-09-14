-- Monk Mode: a 21-day personal discipline tracker.
--
-- Five new tables and nothing altered. Nothing here joins to the CRM — no
-- lead, no client, no report — which is the point: it is the same person's app
-- and not the same subject, and the whole feature can be dropped by dropping
-- these five.
--
-- Days are midnight UTC, the same reading every other date-only column in this
-- schema gets. The two day-keyed tables hold "2026-09-14" as their primary
-- key, which is what DailyQuote already does.

-- CreateTable
CREATE TABLE "MonkModeChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startDate" DATETIME NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 21,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MonkModeHabit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'target',
    "accent" TEXT NOT NULL DEFAULT 'accent',
    "dailyTarget" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MonkModeCompletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "habitId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MonkModeCompletion_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "MonkModeHabit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonkModeNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MonkModeQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MonkModeChallenge_startDate_idx" ON "MonkModeChallenge"("startDate");

-- CreateIndex
CREATE INDEX "MonkModeHabit_active_sortOrder_idx" ON "MonkModeHabit"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MonkModeCompletion_habitId_date_key" ON "MonkModeCompletion"("habitId", "date");

-- CreateIndex
CREATE INDEX "MonkModeCompletion_date_idx" ON "MonkModeCompletion"("date");
