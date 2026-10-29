-- AlterTable
-- Every search logged so far was run for LinkedIn, so the default is what each
-- existing row becomes. No row is deleted and no count or status changes.
ALTER TABLE "ApifySearchLog" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'linkedin';

-- A search is now one row per channel: the same keyword run for email starts
-- its own count rather than adding to the LinkedIn one.
DROP INDEX "ApifySearchLog_type_key_key";
CREATE UNIQUE INDEX "ApifySearchLog_channel_type_key_key" ON "ApifySearchLog"("channel", "type", "key");
