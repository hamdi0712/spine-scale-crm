-- AlterTable
ALTER TABLE "AppSecrets" ADD COLUMN "instantlyApiKey" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN "checkCreditBudget" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "EmailSettings" ADD COLUMN "creditsPerCheck" REAL NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "EmailCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT,
    "email" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "catchAll" TEXT,
    "status" TEXT NOT NULL,
    "creditsUsed" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EmailCheck_createdAt_idx" ON "EmailCheck"("createdAt");
CREATE INDEX "EmailCheck_email_idx" ON "EmailCheck"("email");
