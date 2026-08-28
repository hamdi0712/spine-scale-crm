-- Saved conversations with the copilot, for the /copilot page.
--
-- Two new tables and nothing altered: the copilot could not store a thread
-- before this, so there is nothing to carry across. A cascade on the message's
-- foreign key is what makes deleting a conversation from the history list one
-- statement rather than two.
-- CreateTable
CREATE TABLE "CopilotConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CopilotMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolsUsed" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CopilotMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CopilotConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CopilotConversation_updatedAt_idx" ON "CopilotConversation"("updatedAt");

-- CreateIndex
CREATE INDEX "CopilotMessage_conversationId_position_idx" ON "CopilotMessage"("conversationId", "position");
