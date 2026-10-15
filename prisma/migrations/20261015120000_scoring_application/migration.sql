-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "scoringApplicationId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "scoringRejectedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "scoringRejectedReason" TEXT;

-- CreateTable
CREATE TABLE "ScoringApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comparisonRunId" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" DATETIME,
    "previousModel" TEXT NOT NULL,
    "promoted" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "flagged" INTEGER NOT NULL,
    "protected" INTEGER NOT NULL,
    "stale" INTEGER NOT NULL,
    "protectedList" TEXT,
    "staleList" TEXT,
    "revertKeptList" TEXT
);

-- CreateTable
CREATE TABLE "ScoringApplicationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "afterUpdatedAt" DATETIME NOT NULL,
    "createdLeadId" TEXT,
    CONSTRAINT "ScoringApplicationItem_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ScoringApplication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScoringApplication_appliedAt_idx" ON "ScoringApplication"("appliedAt");

-- CreateIndex
CREATE INDEX "ScoringApplicationItem_applicationId_idx" ON "ScoringApplicationItem"("applicationId");

-- CreateIndex
CREATE INDEX "Lead_scoringRejectedAt_idx" ON "Lead"("scoringRejectedAt");

