-- AlterTable
-- Every lead that exists today was worked on LinkedIn, so the default is what
-- each existing row becomes. No other column is touched.
ALTER TABLE "Lead" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'linkedin';

-- One-time move: Clinic-first leads nobody ever approached on LinkedIn — no
-- connection request marked sent, still at New or No Contact — belong to the
-- email channel they were found for. Everything else stays linkedin.
--
-- The count is written to the activity feed first, from the same condition,
-- so how many moved is on record once this has run.
INSERT INTO "ActivityLog" ("id", "kind", "summary", "createdAt")
SELECT
  lower(hex(randomblob(12))),
  'LEADS_MOVED_TO_EMAIL',
  COUNT(*) || ' Clinic-first lead' || CASE WHEN COUNT(*) = 1 THEN '' ELSE 's' END
    || ' never contacted on LinkedIn moved to email',
  -- Milliseconds since the epoch, the way Prisma stores a DateTime here, so
  -- the feed sorts it among the rest rather than above all of them.
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "Lead" l
JOIN "DiscoveryCandidate" c ON c."promotedLeadId" = l."id"
WHERE c."discoverySource" = 'CLINIC_FIRST'
  AND l."connectionRequestSentAt" IS NULL
  AND l."stage" IN ('NEW', 'NO_CONTACT');

UPDATE "Lead" SET "channel" = 'email'
WHERE "connectionRequestSentAt" IS NULL
  AND "stage" IN ('NEW', 'NO_CONTACT')
  AND "id" IN (
    SELECT "promotedLeadId" FROM "DiscoveryCandidate"
    WHERE "discoverySource" = 'CLINIC_FIRST' AND "promotedLeadId" IS NOT NULL
  );
