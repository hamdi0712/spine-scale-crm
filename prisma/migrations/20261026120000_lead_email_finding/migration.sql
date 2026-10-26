-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "emailType" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailStatus" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailSource" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailCheckedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "emailAlternates" TEXT;

-- Every address already on a lead arrived with an import or a promotion out
-- of Discovery: imported, so Find emails verifies it but never replaces it.
UPDATE "Lead" SET "emailSource" = 'imported' WHERE "email" IS NOT NULL AND TRIM("email") <> '';

-- AlterTable
ALTER TABLE "PipelineSettings" ADD COLUMN "emailExtractorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PipelineSettings" ADD COLUMN "emailExtractorActorId" TEXT NOT NULL DEFAULT 'vdrmota~contact-info-scraper';
ALTER TABLE "PipelineSettings" ADD COLUMN "emailVerifierEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PipelineSettings" ADD COLUMN "emailVerifierActorId" TEXT NOT NULL DEFAULT 'andok~email-verifier';
