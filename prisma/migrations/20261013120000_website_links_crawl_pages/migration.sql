-- Website links, and how many pages the crawler reads.
--
-- Additive. Existing notes are untouched; links fill in as candidates are
-- re-crawled ("Re-crawl website" in Discovery) or enriched afresh.

-- AlterTable
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "websiteLinks" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "websiteLinks" TEXT;

-- AlterTable
ALTER TABLE "PipelineSettings" ADD COLUMN "websiteCrawlPages" INTEGER NOT NULL DEFAULT 6;
