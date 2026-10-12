-- ICP Definition and the new scoring model.
--
-- Additive only. Nothing is dropped, renamed or rewritten: every candidate and
-- lead scored under the old 10-point scorecard keeps its total, tier, answers
-- and breakdown exactly as they were, and the queue goes on scoring with that
-- model until somebody presses "Apply new scoring" after a dry run.

-- Which framework wrote a candidate's verdict. Every row that already carries
-- one was written by the old model, so it is stamped "v1" here — that is what
-- tells a reader its total is out of 10.
-- AlterTable
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "scoringModel" TEXT;
UPDATE "DiscoveryCandidate"
   SET "scoringModel" = 'v1'
 WHERE "icpBreakdown" IS NOT NULL OR "icpTotal" IS NOT NULL;

-- The new model's scorecard on a lead, beside the old answer columns (which
-- stay, read-only, as "Scored under the old model").
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "icpBreakdown" TEXT;
ALTER TABLE "Lead" ADD COLUMN "icpBreakdownAt" DATETIME;

-- The switch, off, and the new model's own bar out of 100.
-- AlterTable
ALTER TABLE "PipelineSettings" ADD COLUMN "scoringModel" TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE "PipelineSettings" ADD COLUMN "promotionThresholdV2" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "IcpDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "targetTitles" TEXT NOT NULL DEFAULT '[]',
    "coreServices" TEXT NOT NULL DEFAULT '[]',
    "adjacentServices" TEXT NOT NULL DEFAULT '[]',
    "targetLocations" TEXT NOT NULL DEFAULT '[]',
    "sizeMin" INTEGER,
    "sizeMax" INTEGER,
    "painPoints" TEXT NOT NULL DEFAULT '',
    "buyingTriggers" TEXT NOT NULL DEFAULT '',
    "disqualifiers" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScoringComparisonRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "icpDefinitionId" TEXT,
    "icpName" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "subjects" INTEGER NOT NULL,
    "estimatedUsd" REAL NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ScoringComparison" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "oldScore" INTEGER,
    "oldMax" INTEGER,
    "oldTier" TEXT,
    "newStatus" TEXT NOT NULL,
    "newScore" INTEGER,
    "newTier" TEXT,
    "outcome" TEXT NOT NULL,
    "flipReason" TEXT,
    "breakdown" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoringComparison_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScoringComparisonRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "IcpDefinition_isActive_idx" ON "IcpDefinition"("isActive");

-- CreateIndex
CREATE INDEX "ScoringComparison_runId_outcome_idx" ON "ScoringComparison"("runId", "outcome");

-- The seed: Primary ICP, active. Tags are stored already normalised (trimmed,
-- lowercased, de-duplicated), which is the form src/lib/icpDefinition.ts
-- writes them in. Pain points and buying triggers are left blank on purpose,
-- for the operator to write.
INSERT INTO "IcpDefinition" (
    "id", "name", "description", "isActive",
    "targetTitles", "coreServices", "adjacentServices", "targetLocations",
    "sizeMin", "sizeMax", "painPoints", "buyingTriggers", "disqualifiers",
    "createdAt", "updatedAt"
) VALUES (
    'primary-icp',
    'Primary ICP',
    'Independent, patient-facing US clinics built around non-surgical spine, disc and back-pain care, small enough (1–9 locations) that the owner or clinic director still decides on marketing.',
    true,
    '["owner","clinic director","practice manager","medical director","dc"]',
    '["non-surgical spine care","spinal decompression","disc treatment","back pain program"]',
    '["chiropractic","physical therapy","non-surgical pain management"]',
    '["united states"]',
    1,
    9,
    '',
    '',
    'Primarily surgical practice
Hospital-owned or health-system affiliated
PI/lien-based clinic
Not a patient-facing clinic (education, training, products, biotech, devices)
Outside the US
Insurance-billing-only, with no cash-pay or package option
10+ locations, or a private-equity/MSO-backed group with centralized marketing
Franchise location where the franchisor controls marketing
Single provider: the website or listing shows exactly one provider and no other clinical or front-desk staff
Main offer is stem cell or regenerative injections marketed as a cure or surgery alternative
No website, confirmed by a Google Maps listing that exists and shows no site',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
