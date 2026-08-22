-- Clinic-First Discovery: a second discovery pathway alongside the LinkedIn
-- person search. Every column here is additive — existing candidates keep the
-- pathway they actually arrived by (PERSON_FIRST) and every other field.
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "contactTitle" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "discoverySource" TEXT NOT NULL DEFAULT 'PERSON_FIRST';
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "sourceActor" TEXT;
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "sourceQuery" TEXT;

ALTER TABLE "PipelineSettings" ADD COLUMN "clinicDiscoveryEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PipelineSettings" ADD COLUMN "clinicDiscoveryActorId" TEXT NOT NULL DEFAULT 'compass~crawler-google-places';
