-- Decision-maker enrichment: a stage that runs after a clinic-first candidate
-- has qualified. Every column is additive; existing rows read as never having
-- been looked at (not_started) and keep every field they already had.
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "decisionMakerStatus" TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "decisionMakerConfidence" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "decisionMakerEvidence" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "decisionMakerLog" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "decisionMakerAt" DATETIME;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "contactSocialUrls" TEXT;

-- What a promoted lead carries across from that stage.
ALTER TABLE "Lead" ADD COLUMN "contactTitle" TEXT;
ALTER TABLE "Lead" ADD COLUMN "contactSocialUrls" TEXT;

ALTER TABLE "PipelineSettings" ADD COLUMN "decisionMakerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PipelineSettings" ADD COLUMN "decisionMakerActorId" TEXT NOT NULL DEFAULT 'harvestapi~linkedin-profile-search';
