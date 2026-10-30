-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "facebookEmailAt" DATETIME;
ALTER TABLE "PipelineSettings" ADD COLUMN "facebookEmailsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PipelineSettings" ADD COLUMN "facebookEmailsActorId" TEXT NOT NULL DEFAULT 'apify~facebook-pages-scraper';
