-- The contact finder: one status per email lead, a trace of how it got there,
-- and the owner's confidence. Filled for existing leads by the one-time data
-- migration in src/lib/dataMigrations.ts (backup first, nothing moves).
ALTER TABLE "Lead" ADD COLUMN "contactStatus" TEXT;
ALTER TABLE "Lead" ADD COLUMN "contactStatusReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN "contactTrace" TEXT;
ALTER TABLE "Lead" ADD COLUMN "ownerConfidence" TEXT;
ALTER TABLE "Lead" ADD COLUMN "contactProposal" TEXT;
ALTER TABLE "Lead" ADD COLUMN "contactRetryAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "contactFailures" TEXT;

CREATE TABLE "DataMigration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT
);
