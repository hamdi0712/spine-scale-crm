-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "leadSource" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "estValue" REAL,
    "nextFollowUp" DATETIME,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "icpDqSurgicalPractice" BOOLEAN NOT NULL DEFAULT false,
    "icpDqSoloNoStaff" BOOLEAN NOT NULL DEFAULT false,
    "icpDqFranchiseLocked" BOOLEAN NOT NULL DEFAULT false,
    "icpDqSystemComplete" BOOLEAN NOT NULL DEFAULT false,
    "icpDqOutOfRegion" BOOLEAN NOT NULL DEFAULT false,
    "icpDqTriggered" TEXT,
    "icpStaffSize" INTEGER,
    "icpPackageEconomics" INTEGER,
    "icpBudgetSignal" INTEGER,
    "icpGapBooking" BOOLEAN NOT NULL DEFAULT false,
    "icpGapReviews" BOOLEAN NOT NULL DEFAULT false,
    "icpGapRemarketing" BOOLEAN NOT NULL DEFAULT false,
    "icpScoredAt" DATETIME,
    "icpNotes" TEXT
);
INSERT INTO "new_Lead" ("archived", "clinicName", "contactName", "createdAt", "email", "estValue", "id", "leadSource", "nextFollowUp", "phone", "stage", "updatedAt") SELECT "archived", "clinicName", "contactName", "createdAt", "email", "estValue", "id", "leadSource", "nextFollowUp", "phone", "stage", "updatedAt" FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
