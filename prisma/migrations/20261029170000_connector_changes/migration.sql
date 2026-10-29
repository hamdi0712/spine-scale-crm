-- CreateTable: changes Claude made through the connector's write tools, with
-- before and after values so each can be undone.
CREATE TABLE "ConnectorChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tool" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "before" TEXT NOT NULL DEFAULT '{}',
    "after" TEXT NOT NULL DEFAULT '{}',
    "created" TEXT NOT NULL DEFAULT '{}',
    "activityLogId" TEXT,
    "undoneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConnectorChange_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorChange_activityLogId_key" ON "ConnectorChange"("activityLogId");
CREATE INDEX "ConnectorChange_createdAt_idx" ON "ConnectorChange"("createdAt");
