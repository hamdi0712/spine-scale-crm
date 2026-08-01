-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "issuedOn" DATETIME NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "packageName" TEXT,
    "monthlyFee" REAL,
    "contractStart" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "ghlRef" TEXT,
    "metaRef" TEXT,
    "notes" TEXT,
    "leadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "contractStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
    "contractRef" TEXT,
    "kickoffAt" DATETIME,
    CONSTRAINT "Client_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Client" ("clinicName", "contactName", "contractStart", "createdAt", "email", "ghlRef", "id", "leadId", "metaRef", "monthlyFee", "notes", "packageName", "phone", "status", "updatedAt") SELECT "clinicName", "contactName", "contractStart", "createdAt", "email", "ghlRef", "id", "leadId", "metaRef", "monthlyFee", "notes", "packageName", "phone", "status", "updatedAt" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
CREATE UNIQUE INDEX "Client_leadId_key" ON "Client"("leadId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
