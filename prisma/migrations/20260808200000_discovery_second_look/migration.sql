-- AlterTable
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "secondLookFlagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "secondLookReason" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "secondLookSource" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "secondLookAt" DATETIME;
