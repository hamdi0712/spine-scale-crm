-- AlterTable
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "batchLabel" TEXT;

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_batchLabel_idx" ON "DiscoveryCandidate"("batchLabel");
