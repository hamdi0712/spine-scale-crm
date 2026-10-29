-- AlterTable
-- Every candidate that exists today was found for LinkedIn — including the
-- Clinic-first ones — so the default is what each existing row becomes. No
-- other column is touched.
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'linkedin';
ALTER TABLE "DiscoveryCandidate" ADD COLUMN "linkedinConflictLeadId" TEXT;

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_channel_idx" ON "DiscoveryCandidate"("channel");

-- One-time move: the email channel starts fresh. Every lead on it goes back to
-- linkedin; nothing else on any lead changes, and nothing is deleted.
--
-- The count is written to the activity feed first, from the same condition,
-- so how many moved is on record once this has run.
INSERT INTO "ActivityLog" ("id", "kind", "summary", "createdAt")
SELECT
  lower(hex(randomblob(12))),
  'LEADS_MOVED_TO_LINKEDIN',
  COUNT(*) || ' email-channel lead' || CASE WHEN COUNT(*) = 1 THEN '' ELSE 's' END
    || ' moved back to LinkedIn — the email pipeline starts fresh',
  -- Milliseconds since the epoch, the way Prisma stores a DateTime here.
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "Lead"
WHERE "channel" = 'email';

UPDATE "Lead" SET "channel" = 'linkedin' WHERE "channel" = 'email';
