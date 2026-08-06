-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "enrichedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "websiteUrl" TEXT;
ALTER TABLE "Lead" ADD COLUMN "facebookUrl" TEXT;
ALTER TABLE "Lead" ADD COLUMN "location" TEXT;

-- Leads enriched before this migration have values but no run date. Dating
-- them from the review check is the only honest timestamp on record; a lead
-- with enrichment and no date at all would read as never enriched.
UPDATE "Lead"
SET "enrichedAt" = "reviewsCheckedAt"
WHERE "reviewsCheckedAt" IS NOT NULL;
