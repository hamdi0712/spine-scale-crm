-- A contact name set by hand is never cleared or renamed by the re-clean.
ALTER TABLE "Lead" ADD COLUMN "contactNameByHand" BOOLEAN NOT NULL DEFAULT false;

-- Backfill what is on record as set by hand: an owner picked by hand, and a
-- contact set through the assistant (not since undone) that still stands.
UPDATE "Lead" SET "contactNameByHand" = true
WHERE "contactName" IS NOT NULL AND (
  "ownerSource" = 'manual'
  OR "id" IN (SELECT "leadId" FROM "ConnectorChange" WHERE "tool" = 'setContactName' AND "undoneAt" IS NULL)
);
