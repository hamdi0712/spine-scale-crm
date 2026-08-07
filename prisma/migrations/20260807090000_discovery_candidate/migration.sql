-- CreateTable
CREATE TABLE "DiscoveryCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "linkedinUrl" TEXT,
    "companyLinkedinUrl" TEXT,
    "websiteUrl" TEXT,
    "facebookUrl" TEXT,
    "location" TEXT,
    "timeZone" TEXT,
    "source" TEXT,
    "staffCountRaw" INTEGER,
    "estValue" REAL,
    "metaAdsSignal" TEXT,
    "reviewCount" INTEGER,
    "websiteNotes" TEXT,
    "enrichedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "icpTotal" INTEGER,
    "icpTier" TEXT,
    "icpBreakdown" TEXT,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "disqualifiedReason" TEXT,
    "promotedLeadId" TEXT,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscoveryCandidate_promotedLeadId_fkey" FOREIGN KEY ("promotedLeadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCandidate_promotedLeadId_key" ON "DiscoveryCandidate"("promotedLeadId");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_status_idx" ON "DiscoveryCandidate"("status");
