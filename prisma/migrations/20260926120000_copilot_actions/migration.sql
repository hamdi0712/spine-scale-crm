-- Iman's proposed actions: the confirm-before-execute gate.
--
-- A proposal is written here by the server when the model asks for one, and the
-- browser is handed only its id. Confirming reads the row back and applies what
-- it says, so nothing the page sends decides what changes.
CREATE TABLE "CopilotAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "summary" TEXT NOT NULL,
    "reason" TEXT,
    "leadId" TEXT,
    "candidateId" TEXT,
    "params" TEXT NOT NULL DEFAULT '{}',
    "askedFor" TEXT,
    "messageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "executedAt" DATETIME,
    "error" TEXT,
    CONSTRAINT "CopilotAction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CopilotAction_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "DiscoveryCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CopilotAction_messageId_key" ON "CopilotAction"("messageId");
CREATE INDEX "CopilotAction_status_createdAt_idx" ON "CopilotAction"("status", "createdAt");

-- Which turn proposed it, so reopening a conversation draws the card back in
-- place with whatever became of it.
ALTER TABLE "CopilotMessage" ADD COLUMN "copilotActionId" TEXT;
