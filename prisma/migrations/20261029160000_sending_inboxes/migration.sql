-- CreateTable
CREATE TABLE "SendingInbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "dailyLimit" INTEGER NOT NULL DEFAULT 10,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SendingInbox_address_key" ON "SendingInbox"("address");

-- The two inboxes to start with, 10 a day each. Addresses and display names
-- are edited in Settings -> Email.
INSERT INTO "SendingInbox" ("id", "address", "displayName", "dailyLimit", "position", "createdAt") VALUES
  ('inbox_hamdi', 'hamdi@spinescale.co', '', 10, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('inbox_team', 'team@spinescale.co', '', 10, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

-- AlterTable: which inbox a lead is emailed from, and which sent each email.
ALTER TABLE "Lead" ADD COLUMN "sendingInboxId" TEXT REFERENCES "SendingInbox" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailSend" ADD COLUMN "inboxId" TEXT REFERENCES "SendingInbox" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailSend" ADD COLUMN "fromEmail" TEXT;

-- CreateIndex
CREATE INDEX "EmailSend_inboxId_sentAt_idx" ON "EmailSend"("inboxId", "sentAt");
