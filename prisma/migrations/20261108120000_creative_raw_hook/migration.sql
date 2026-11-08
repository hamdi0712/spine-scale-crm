-- The hook as first written, kept beside the compliant version that goes live.
-- Existing creatives keep their current conceptHeadline as the compliant one.
ALTER TABLE "Creative" ADD COLUMN "rawHook" TEXT NOT NULL DEFAULT '';
