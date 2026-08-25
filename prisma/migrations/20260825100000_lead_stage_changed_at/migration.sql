-- When a lead's stage last actually changed.
--
-- The date-based stage metrics — Messages Sent, and the stage half of meetings
-- booked — read updatedAt until now, because there was nothing else to read.
-- updatedAt moves for a fixed typo in a phone number, so a lead approached
-- three weeks ago and edited this morning filed its approach under this
-- morning. This column moves only when the stage value is different from the
-- one already stored (src/lib/leadStage.ts).
--
-- The table is rebuilt rather than altered in place because SQLite cannot add
-- a NOT NULL column with a non-constant default. Existing rows are carried
-- across with stageChangedAt set from createdAt rather than left to the
-- CURRENT_TIMESTAMP default: creation is the only instant about them the
-- database can honestly claim, updatedAt would carry the very approximation
-- this column exists to end, and the default would file every lead in the
-- pipeline as having moved stage on the day of the deploy.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "leadSource" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "stageChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estValue" REAL,
    "nextFollowUp" DATETIME,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "linkedinUrl" TEXT,
    "companyLinkedinUrl" TEXT,
    "websiteUrl" TEXT,
    "facebookUrl" TEXT,
    "location" TEXT,
    "contactTitle" TEXT,
    "contactSocialUrls" TEXT,
    "timeZone" TEXT,
    "connectionRequestSentAt" DATETIME,
    "staffCountRaw" INTEGER,
    "metaAdsSignal" TEXT,
    "reviewCount" INTEGER,
    "websiteNotes" TEXT,
    "enrichedAt" DATETIME,
    "reviewsCheckedAt" DATETIME,
    "outreachHook" TEXT,
    "connectionAcceptedAt" DATETIME,
    "repliedAt" DATETIME,
    "replyText" TEXT,
    "loomUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "icpDqSurgicalPractice" BOOLEAN NOT NULL DEFAULT false,
    "icpDqSoloNoStaff" BOOLEAN NOT NULL DEFAULT false,
    "icpDqFranchiseLocked" BOOLEAN NOT NULL DEFAULT false,
    "icpDqSystemComplete" BOOLEAN NOT NULL DEFAULT false,
    "icpDqOutOfRegion" BOOLEAN NOT NULL DEFAULT false,
    "icpDqTriggered" TEXT,
    "icpStaffSize" INTEGER,
    "icpPackageEconomics" INTEGER,
    "icpBudgetSignal" INTEGER,
    "icpGapBooking" BOOLEAN NOT NULL DEFAULT false,
    "icpGapReviews" BOOLEAN NOT NULL DEFAULT false,
    "icpGapRemarketing" BOOLEAN NOT NULL DEFAULT false,
    "icpScoredAt" DATETIME,
    "icpNotes" TEXT
);
INSERT INTO "new_Lead" ("stageChangedAt", "archived", "clinicName", "companyLinkedinUrl", "connectionAcceptedAt", "connectionRequestSentAt", "contactName", "contactSocialUrls", "contactTitle", "createdAt", "email", "enrichedAt", "estValue", "facebookUrl", "icpBudgetSignal", "icpDqFranchiseLocked", "icpDqOutOfRegion", "icpDqSoloNoStaff", "icpDqSurgicalPractice", "icpDqSystemComplete", "icpDqTriggered", "icpGapBooking", "icpGapRemarketing", "icpGapReviews", "icpNotes", "icpPackageEconomics", "icpScoredAt", "icpStaffSize", "id", "leadSource", "linkedinUrl", "location", "loomUrl", "metaAdsSignal", "nextFollowUp", "outreachHook", "phone", "repliedAt", "replyText", "reviewCount", "reviewsCheckedAt", "staffCountRaw", "stage", "timeZone", "updatedAt", "websiteNotes", "websiteUrl") SELECT "createdAt", "archived", "clinicName", "companyLinkedinUrl", "connectionAcceptedAt", "connectionRequestSentAt", "contactName", "contactSocialUrls", "contactTitle", "createdAt", "email", "enrichedAt", "estValue", "facebookUrl", "icpBudgetSignal", "icpDqFranchiseLocked", "icpDqOutOfRegion", "icpDqSoloNoStaff", "icpDqSurgicalPractice", "icpDqSystemComplete", "icpDqTriggered", "icpGapBooking", "icpGapRemarketing", "icpGapReviews", "icpNotes", "icpPackageEconomics", "icpScoredAt", "icpStaffSize", "id", "leadSource", "linkedinUrl", "location", "loomUrl", "metaAdsSignal", "nextFollowUp", "outreachHook", "phone", "repliedAt", "replyText", "reviewCount", "reviewsCheckedAt", "staffCountRaw", "stage", "timeZone", "updatedAt", "websiteNotes", "websiteUrl" FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

