-- Which mechanism an outreach message was written by, recorded at generation
-- time so observation-led and curiosity-led openers can be compared later.
--
-- One nullable column and nothing else. Existing rows stay null on purpose:
-- every message written before this column existed was observation-led by
-- construction, but writing that in would be a backfill claiming something
-- nobody actually recorded, and the reporting reads null as unlabelled.

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN "messageMechanism" TEXT;
