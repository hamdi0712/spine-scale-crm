-- The operator's standing description of the business, prepended to the AI
-- Copilot's system prompt on every conversation.
--
-- One row, fixed id "singleton", the same shape PipelineSettings and AppSecrets
-- use. Nothing is seeded: a fresh install has no row, which reads as nothing
-- written yet, and the copilot's prompt is what it was before this table.

-- CreateTable
CREATE TABLE "BusinessContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
