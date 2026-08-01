-- AlterTable
-- Existing clients are assumed symptom-agnostic (Path A): that is the default
-- posture, and switching one to Path B is a deliberate act that also seeds the
-- HIPAA add-on + BAA checklist item.
ALTER TABLE "Client" ADD COLUMN "phiApproach" TEXT NOT NULL DEFAULT 'PATH_A';
