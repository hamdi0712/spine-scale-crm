-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ConnectorChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tool" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "leadId" TEXT,
    "personaId" TEXT,
    "before" TEXT NOT NULL DEFAULT '{}',
    "after" TEXT NOT NULL DEFAULT '{}',
    "created" TEXT NOT NULL DEFAULT '{}',
    "activityLogId" TEXT,
    "undoneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConnectorChange_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConnectorChange_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ConnectorChange" ("activityLogId", "after", "before", "created", "createdAt", "id", "leadId", "summary", "tool", "undoneAt") SELECT "activityLogId", "after", "before", "created", "createdAt", "id", "leadId", "summary", "tool", "undoneAt" FROM "ConnectorChange";
DROP TABLE "ConnectorChange";
ALTER TABLE "new_ConnectorChange" RENAME TO "ConnectorChange";
CREATE UNIQUE INDEX "ConnectorChange_activityLogId_key" ON "ConnectorChange"("activityLogId");
CREATE INDEX "ConnectorChange_createdAt_idx" ON "ConnectorChange"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

