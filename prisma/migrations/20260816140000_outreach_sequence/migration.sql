-- The outreach hook becomes an outreach sequence: five drafted messages per
-- lead instead of one line, with the two states that gate them.
--
-- Lead.outreachHook is deliberately NOT dropped. Every line in it is copied
-- forward below as a CONNECTION message, and dropping the column in the same
-- migration that copies it would leave the only copy of those drafts in a table
-- one migration old. It is dead weight from here — nothing reads or writes it —
-- and a later migration can remove it once this one has been living a while.

-- AlterTable: the two marks that gate the sequence, and the audit's Loom.
ALTER TABLE "Lead" ADD COLUMN "connectionAcceptedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "repliedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "loomUrl" TEXT;

-- CreateTable
CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "variant" TEXT,
    "content" TEXT NOT NULL,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OutreachMessage_leadId_step_createdAt_idx" ON "OutreachMessage"("leadId", "step", "createdAt");

-- Carry every stored hook forward as the CONNECTION message it was going to
-- become. The old column held the clause in the middle of the note; the note
-- around it was built in the browser and never stored, so it is rebuilt here in
-- exactly the words src/lib/outreachSequence.ts uses — including the
-- "[First Name]" placeholder for a lead with no contact on it, which is the
-- string the panel looks for when it offers to point out the blank.
--
-- The contact name is NOT carried over as written. The old note used whatever
-- was in the field; every template in the sequence uses the first name only,
-- and a migrated draft opening "Hi Dr. Sarah Whitfield, DC" would be the one
-- thing the new templates exist to avoid. Anything with a space or a comma in
-- it therefore becomes the placeholder rather than a wrong guess made in SQL —
-- SQLite has no split, and a name is not worth guessing at.
--
-- id is the lead's own id with a prefix: it is unique because leadId is, it
-- needs no extension to generate, and re-running this on a database that
-- already has the row is a no-op rather than a duplicate.
--
-- sentAt is left null even where connectionRequestSentAt is set. That mark says
-- a request went out; it does not say this draft is the text that went with it,
-- and inventing the connection between the two would put words in somebody's
-- mouth.
INSERT INTO "OutreachMessage" ("id", "leadId", "step", "variant", "content", "sentAt", "createdAt")
SELECT
    'migrated-hook-' || "id",
    "id",
    'CONNECTION',
    NULL,
    'Hi ' || (
            CASE
                WHEN "contactName" IS NULL
                  OR TRIM("contactName") = ''
                  OR TRIM("contactName") LIKE '% %'
                  OR TRIM("contactName") LIKE '%,%'
                THEN '[First Name]'
                ELSE TRIM("contactName")
            END
        )
        || ' — came across ' || TRIM("clinicName")
        || ' while looking into non-surgical spine/disc practices. '
        || TRIM("outreachHook")
        || '. Would love to connect.',
    NULL,
    CURRENT_TIMESTAMP
FROM "Lead"
WHERE "outreachHook" IS NOT NULL
  AND TRIM("outreachHook") <> ''
  AND "id" NOT IN (SELECT "leadId" FROM "OutreachMessage" WHERE "step" = 'CONNECTION');
