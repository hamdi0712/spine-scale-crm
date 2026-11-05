-- Risky (catch-all) addresses accepted by hand, and the bounce review flag.
ALTER TABLE "Lead" ADD COLUMN "emailRiskyAcceptedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "emailRiskyAcceptedEmail" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailRiskyFlaggedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "emailRiskyFlagReason" TEXT;

-- Sends to accepted risky addresses, and their own daily limit.
ALTER TABLE "EmailSend" ADD COLUMN "risky" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailSettings" ADD COLUMN "riskyDailyLimit" INTEGER NOT NULL DEFAULT 3;
