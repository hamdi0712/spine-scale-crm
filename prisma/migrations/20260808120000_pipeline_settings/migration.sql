-- CreateTable
CREATE TABLE "PipelineSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyDetailsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "companyDetailsActorId" TEXT NOT NULL DEFAULT 'harvestapi~linkedin-company',
    "facebookLookupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "facebookLookupActorId" TEXT NOT NULL DEFAULT 'apify~google-search-scraper',
    "facebookAdsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "facebookAdsActorId" TEXT NOT NULL DEFAULT 'apify~facebook-ads-scraper',
    "websiteContentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "websiteContentActorId" TEXT NOT NULL DEFAULT 'apify~website-content-crawler',
    "googleReviewsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "googleReviewsActorId" TEXT NOT NULL DEFAULT 'compass~crawler-google-places',
    "promotionThreshold" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" DATETIME NOT NULL
);
