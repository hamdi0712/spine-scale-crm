-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "emailOpener" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailOpenerNote" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailOpenerMechanism" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailVersion" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailSubject" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailBody" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailApprovedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "contactConfirmedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "emailRepliedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "emailReplyText" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailReplyType" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailUnsubscribedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "suppressedAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "suppressedReason" TEXT;

-- CreateTable
CREATE TABLE "EmailSend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailSend_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "domain" TEXT,
    "clinicName" TEXT NOT NULL,
    "leadId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectTemplate" TEXT NOT NULL,
    "ownerBodyTemplate" TEXT NOT NULL,
    "frontDeskTemplate" TEXT NOT NULL,
    "optOutLine" TEXT NOT NULL,
    "followUpTemplates" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT '',
    "followUpDelayDays" INTEGER NOT NULL DEFAULT 3,
    "dailyLimit" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSend_leadId_step_key" ON "EmailSend"("leadId", "step");
CREATE INDEX "EmailSend_sentAt_idx" ON "EmailSend"("sentAt");
CREATE INDEX "Suppression_email_idx" ON "Suppression"("email");
CREATE INDEX "Suppression_domain_idx" ON "Suppression"("domain");
