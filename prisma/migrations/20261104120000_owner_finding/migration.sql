-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "npiNumber" TEXT;
ALTER TABLE "Lead" ADD COLUMN "npiOfficialName" TEXT;
ALTER TABLE "Lead" ADD COLUMN "npiOfficialTitle" TEXT;
ALTER TABLE "Lead" ADD COLUMN "ownerStatus" TEXT;
ALTER TABLE "Lead" ADD COLUMN "ownerSource" TEXT;
ALTER TABLE "Lead" ADD COLUMN "ownerSiteNames" TEXT;
ALTER TABLE "Lead" ADD COLUMN "ownerCheckedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "ownerEmailAt" DATETIME;
ALTER TABLE "EmailSettings" ADD COLUMN "hunterCreditBudget" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "AppSecrets" ADD COLUMN "hunterApiKey" TEXT;

-- CreateTable
CREATE TABLE "HunterCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT,
    "endpoint" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "result" TEXT,
    "creditsUsed" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "HunterCall_createdAt_idx" ON "HunterCall"("createdAt");
