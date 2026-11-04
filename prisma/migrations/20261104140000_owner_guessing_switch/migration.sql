-- Find owners: pattern guessing is a switch, off by default.
ALTER TABLE "EmailSettings" ADD COLUMN "guessOwnerPatterns" BOOLEAN NOT NULL DEFAULT false;

-- A label the operator set by hand is never re-labelled automatically.
ALTER TABLE "Lead" ADD COLUMN "emailTypeByHand" BOOLEAN NOT NULL DEFAULT false;
