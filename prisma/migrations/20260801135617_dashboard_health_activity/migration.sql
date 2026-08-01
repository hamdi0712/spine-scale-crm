-- AlterTable
ALTER TABLE "Client" ADD COLUMN "activeSince" DATETIME;
ALTER TABLE "Client" ADD COLUMN "healthChangedAt" DATETIME;
ALTER TABLE "Client" ADD COLUMN "healthOverride" TEXT;
ALTER TABLE "Client" ADD COLUMN "healthStatus" TEXT;

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "clientId" TEXT,
    "leadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChecklistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "completedAt" DATETIME,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChecklistItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ChecklistItem" ("clientId", "completedAt", "createdAt", "id", "notes", "sortOrder", "status", "title", "updatedAt") SELECT "clientId", "completedAt", "createdAt", "id", "notes", "sortOrder", "status", "title", "updatedAt" FROM "ChecklistItem";
DROP TABLE "ChecklistItem";
ALTER TABLE "new_ChecklistItem" RENAME TO "ChecklistItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- Backfill: clients already Active have been active since their contract
-- started (or since the record was created), otherwise health would read
-- Ramping for every existing client until two more weeks were reported.
UPDATE "Client"
SET "activeSince" = COALESCE("contractStart", "createdAt")
WHERE "status" = 'ACTIVE' AND "activeSince" IS NULL;

-- Backfill: flag the standard launch-gating checklist items as blocking.
-- Kept in step with LAUNCH_BLOCKING_CHECKLIST in src/lib/constants.ts.
UPDATE "ChecklistItem"
SET "blocking" = true
WHERE "title" IN (
  'Funnel + embedded calendar built',
  'Speed-to-lead automation live',
  'Meta ad campaign launched',
  'Privacy policy published',
  'Cookie policy published',
  'Consent language present on all forms'
);
